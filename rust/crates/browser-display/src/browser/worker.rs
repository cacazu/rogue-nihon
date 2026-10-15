//! Fresh Worker, fresh C stack. Rust owns imports, startup buffers and their lifetime.
use super::*;
use js_sys::{Array, Object, SharedArrayBuffer, Uint8Array, WebAssembly};
use wasm_bindgen_futures::JsFuture;

type MessageCallback = Closure<dyn FnMut(MessageEvent)>;
thread_local! {
    static QUEUE: RefCell<Option<Rc<queue::Queue>>> = const { RefCell::new(None) };
    static CALLBACKS: RefCell<Option<Callbacks>> = const { RefCell::new(None) };
    static MESSAGE: RefCell<Option<MessageCallback>> = const { RefCell::new(None) };
    static GAME: RefCell<Option<JsValue>> = const { RefCell::new(None) };
}
struct Callbacks {
    read: Closure<dyn FnMut() -> Result<i32, JsValue>>,
    flush: Closure<dyn FnMut() -> Result<(), JsValue>>,
    present: Closure<dyn FnMut(u32, u32) -> Result<(), JsValue>>,
    store: Closure<dyn FnMut(u32, u32) -> Result<(), JsValue>>,
    outcome: Closure<dyn FnMut(i32, u32, u32) -> Result<(), JsValue>>,
    clock: Closure<dyn FnMut() -> f64>,
    year: Closure<dyn FnMut() -> i32>,
    diagnostic: Closure<dyn FnMut(u32, u32) -> Result<(), JsValue>>,
    exit: Closure<dyn FnMut(i32) -> Result<(), JsValue>>,
}
fn scope() -> DedicatedWorkerGlobalScope {
    js_sys::global().unchecked_into()
}
fn post(message: Value) -> Result<(), JsValue> {
    scope().post_message(&js(&message)?)
}
fn queue() -> Result<Rc<queue::Queue>, JsValue> {
    QUEUE.with(|slot| slot.borrow().clone())
        .ok_or_else(|| JsValue::from_str("Worker queue unavailable"))
}
fn heap(exports: &JsValue) -> Result<Uint8Array, JsValue> {
    let memory: WebAssembly::Memory =
        Reflect::get(exports, &JsValue::from_str("memory"))?.dyn_into()?;
    // The buffer changes on memory growth. Never cache a borrowed memory view.
    Ok(Uint8Array::new(&memory.buffer()))
}
fn borrowed_bytes(pointer: u32, length: u32) -> Result<Vec<u8>, JsValue> {
    let exports = GAME.with(|slot| slot.borrow().clone())
        .ok_or_else(|| JsValue::from_str("Game memory unavailable"))?;
    let heap = heap(&exports)?;
    let end = pointer.checked_add(length).filter(|end| *end <= heap.length())
        .ok_or_else(|| JsValue::from_str("Game buffer outside memory"))?;
    // Copy before returning to C/Rust, while the originating slice is still borrowed.
    Ok(heap.subarray(pointer, end).to_vec())
}
fn arguments(numbers: &[u32]) -> Array {
    numbers.iter().map(|number| JsValue::from_f64(*number as f64)).collect()
}
struct Transfer {
    exports: JsValue,
    pointer: u32,
    length: u32,
}
impl Transfer {
    fn new(exports: &JsValue, bytes: &[u8]) -> Result<Self, JsValue> {
        let length = u32::try_from(bytes.len()).map_err(|_| JsValue::from_str("Transfer too large"))?;
        let allocated = call(exports, "rg_alloc", &arguments(&[length]))?;
        let pointer = allocated.as_f64().unwrap_or(0.) as u32;
        if pointer == 0 {
            return Err(JsValue::from_str("Game transfer allocation failed"));
        }
        let owned = Self { exports: exports.clone(), pointer, length };
        let heap = heap(exports)?;
        let end = pointer.checked_add(length).filter(|end| *end <= heap.length())
            .ok_or_else(|| JsValue::from_str("Game transfer outside memory"))?;
        heap.subarray(pointer, end).copy_from(bytes);
        Ok(owned)
    }
}
impl Drop for Transfer {
    fn drop(&mut self) {
        let _ = call(&self.exports, "rg_dealloc", &arguments(&[self.pointer, self.length]));
    }
}
#[wasm_bindgen]
pub fn worker_boot() -> Result<(), JsValue> {
    let mut started = false;
    let callback = Closure::new(move |event: MessageEvent| {
        if started { return; }
        started = true;
        wasm_bindgen_futures::spawn_local(async move {
            if let Err(e) = run(event.data()).await {
                let _ = post(json!({"type":"error","text":values::error_message(&e)}));
            }
        });
    });
    scope().set_onmessage(Some(callback.as_ref().unchecked_ref()));
    MESSAGE.with(|slot| *slot.borrow_mut() = Some(callback));
    post(json!({"type":"host-ready"}))
}
async fn run(start: JsValue) -> Result<(), JsValue> {
    let shared: SharedArrayBuffer = Reflect::get(&start, &JsValue::from_str("queue"))?.dyn_into()?;
    let capacity = Reflect::get(&start, &JsValue::from_str("capacity"))?.as_f64().unwrap_or(0.) as u32;
    let transport = Rc::new(queue::Queue::new(Some(shared), capacity)?);
    QUEUE.with(|slot| *slot.borrow_mut() = Some(transport));
    let callbacks = Callbacks {
        read: Closure::new(|| { post(json!({"type":"input-request"}))?; queue()?.take() }),
        flush: Closure::new(|| {
            let events = queue()?.discard()?;
            if !events.is_empty() { post(json!({"type":"input-flush","count":events.len(),"events":events}))?; }
            Ok(())
        }),
        present: Closure::new(|pointer, length| {
            let payload = serde_json::from_slice(&borrowed_bytes(pointer, length)?)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            post(payload)
        }),
        store: Closure::new(|pointer, length| {
            let bytes = Uint8Array::from(borrowed_bytes(pointer, length)?.as_slice());
            let message = js(&json!({"type":"save"}))?;
            Reflect::set(&message, &JsValue::from_str("bytes"), &bytes)?;
            let transfer = Array::new(); transfer.push(&bytes.buffer());
            scope().post_message_with_transfer(&message, &transfer)
        }),
        outcome: Closure::new(|code, pointer, length| {
            let text = String::from_utf8(borrowed_bytes(pointer, length)?)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            post(json!({"type":"outcome","code":code,"text":text}))
        }),
        clock: Closure::new(js_sys::Date::now),
        year: Closure::new(|| js_sys::Date::new_0().get_full_year() as i32),
        diagnostic: Closure::new(|pointer, length| {
            let bytes = borrowed_bytes(pointer, length)?;
            post(json!({"type":"log","text":String::from_utf8_lossy(&bytes)}))
        }),
        exit: Closure::new(|code| Err(JsValue::from_str(&format!("Game runtime exited unexpectedly: {code}")))),
    };
    let host = Object::new();
    for (name, function) in [
        ("read_event", callbacks.read.as_ref()), ("flush_input", callbacks.flush.as_ref()),
        ("present", callbacks.present.as_ref()), ("store", callbacks.store.as_ref()),
        ("outcome", callbacks.outcome.as_ref()), ("clock_milliseconds", callbacks.clock.as_ref()),
        ("diagnostic", callbacks.diagnostic.as_ref()), ("calendar_year", callbacks.year.as_ref()),
    ] { Reflect::set(&host, &JsValue::from_str(name), function)?; }
    let wasi = Object::new();
    Reflect::set(&wasi, &JsValue::from_str("proc_exit"), callbacks.exit.as_ref())?;
    let imports = Object::new();
    Reflect::set(&imports, &JsValue::from_str("rogue"), &host)?;
    Reflect::set(&imports, &JsValue::from_str("wasi_snapshot_preview1"), &wasi)?;
    CALLBACKS.with(|slot| *slot.borrow_mut() = Some(callbacks));
    let bytes = fetch_bytes("/build/game.wasm").await?;
    let module: WebAssembly::Module = JsFuture::from(WebAssembly::compile(&Uint8Array::from(bytes.as_slice()))).await?.dyn_into()?;
    let exports: JsValue = WebAssembly::Instance::new(&module, &imports)?.exports().into();
    GAME.with(|slot| *slot.borrow_mut() = Some(exports.clone()));
    call(&exports, "_initialize", &Array::new())?;

    let restore = Reflect::get(&start, &JsValue::from_str("restore"))?;
    let restore = if restore.is_null() || restore.is_undefined() { None } else {
        Some(String::from_utf8(Uint8Array::new(&restore).to_vec()).map_err(|e| JsValue::from_str(&e.to_string()))?)
    };
    let mut configuration = json!({
        "locale":Reflect::get(&start, &JsValue::from_str("locale"))?.as_string().unwrap_or_default(),
        "trace":Reflect::get(&start, &JsValue::from_str("trace"))?.as_bool().unwrap_or(false),
        "message_paging":Reflect::get(&start, &JsValue::from_str("message_paging"))?.as_string().unwrap_or_else(|| "classic".into()),
        "restore":restore
    });
    let fixture = Reflect::get(&start, &JsValue::from_str("fixture"))?;
    if !fixture.is_null() && !fixture.is_undefined() {
        configuration["fixture"] = json!(fixture.as_string().ok_or_else(|| JsValue::from_str("Invalid regression fixture"))?);
    }
    let config = Transfer::new(&exports, &serde_json::to_vec(&configuration).map_err(|e| JsValue::from_str(&e.to_string()))?)?;
    let accepted = call(&exports, "rg_configure", &arguments(&[config.pointer, config.length]))?;
    drop(config);
    if accepted.as_f64() != Some(0.) { return Err(JsValue::from_str("Game rejected startup configuration")); }
    let mut name = Reflect::get(&start, &JsValue::from_str("name"))?.as_string().unwrap_or_default().into_bytes();
    name.push(0);
    let name = Transfer::new(&exports, &name)?;
    let seed = Reflect::get(&start, &JsValue::from_str("seed"))?.as_f64().unwrap_or(0.) as u32;
    post(json!({"type":"ready"}))?;
    let code = call(&exports, "rg_run", &arguments(&[seed, name.pointer]))?;
    post(json!({"type":"exit","code":code.as_f64()}))
}
