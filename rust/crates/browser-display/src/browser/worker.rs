//! Fresh Worker, fresh C stack. The blocking read never suspends or rewrites the original game.
use super::*;
use js_sys::{Array, Object, Promise, SharedArrayBuffer, Uint8Array};
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
    locate: Closure<dyn FnMut(String) -> String>,
    print: Closure<dyn FnMut(String)>,
    abort: Closure<dyn FnMut(JsValue)>,
}
fn scope() -> DedicatedWorkerGlobalScope {
    js_sys::global().unchecked_into()
}
fn post(message: Value) -> Result<(), JsValue> {
    scope().post_message(&js(&message)?)
}
fn queue() -> Result<Rc<queue::Queue>, JsValue> {
    QUEUE
        .with(|slot| slot.borrow().clone())
        .ok_or_else(|| JsValue::from_str("Worker queue unavailable"))
}
fn borrowed_bytes(pointer: u32, length: u32) -> Result<Vec<u8>, JsValue> {
    let module = GAME
        .with(|slot| slot.borrow().clone())
        .ok_or_else(|| JsValue::from_str("Game memory unavailable"))?;
    // Fetch the current view on every call: Emscripten replaces it after memory growth.
    let heap: Uint8Array = Reflect::get(&module, &JsValue::from_str("HEAPU8"))?.dyn_into()?;
    let end = pointer
        .checked_add(length)
        .filter(|end| *end <= heap.length())
        .ok_or_else(|| JsValue::from_str("Game buffer outside memory"))?;
    // Copy synchronously, while the game-side Rust slice is still borrowed.
    Ok(heap.subarray(pointer, end).to_vec())
}
#[wasm_bindgen]
pub fn worker_boot() -> Result<(), JsValue> {
    let mut started = false;
    let callback = Closure::new(move |event: MessageEvent| {
        if started {
            return;
        }
        started = true;
        wasm_bindgen_futures::spawn_local(async move {
            if let Err(e) = run(event.data()).await {
                let _ = post(json!({"type":"error","text":format!("{e:?}")}));
            }
        });
    });
    scope().set_onmessage(Some(callback.as_ref().unchecked_ref()));
    MESSAGE.with(|slot| *slot.borrow_mut() = Some(callback));
    post(json!({"type":"host-ready"}))
}
async fn run(start: JsValue) -> Result<(), JsValue> {
    let shared: SharedArrayBuffer =
        Reflect::get(&start, &JsValue::from_str("queue"))?.dyn_into()?;
    let capacity = Reflect::get(&start, &JsValue::from_str("capacity"))?
        .as_f64()
        .unwrap_or(0.) as u32;
    let transport = Rc::new(queue::Queue::new(Some(shared), capacity)?);
    QUEUE.with(|slot| *slot.borrow_mut() = Some(transport));
    let callbacks = Callbacks {
        read: Closure::new(|| {
            post(json!({"type":"input-request"}))?;
            queue()?.take()
        }),
        flush: Closure::new(|| {
            let events = queue()?.discard()?;
            if !events.is_empty() {
                post(json!({"type":"input-flush","count":events.len(),"events":events}))?;
            }
            Ok(())
        }),
        present: Closure::new(|pointer, length| {
            let payload: Value = serde_json::from_slice(&borrowed_bytes(pointer, length)?)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            post(payload)
        }),
        store: Closure::new(|pointer, length| {
            let bytes = Uint8Array::from(borrowed_bytes(pointer, length)?.as_slice());
            let message = js(&json!({"type":"save"}))?;
            Reflect::set(&message, &JsValue::from_str("bytes"), &bytes)?;
            let transfer = Array::new();
            transfer.push(&bytes.buffer());
            scope().post_message_with_transfer(&message, &transfer)
        }),
        outcome: Closure::new(|code, pointer, length| {
            let text = String::from_utf8(borrowed_bytes(pointer, length)?)
                .map_err(|e| JsValue::from_str(&e.to_string()))?;
            post(json!({"type":"outcome","code":code,"text":text}))
        }),
        locate: Closure::new(|name: String| format!("/build/{name}")),
        print: Closure::new(|text: String| {
            let _ = post(json!({"type":"log","text":text}));
        }),
        abort: Closure::new(|text: JsValue| {
            let _ = post(json!({"type":"error","text":format!("{text:?}")}));
        }),
    };
    let host = Object::new();
    for (name, function) in [
        ("readEvent", callbacks.read.as_ref()),
        ("flushInput", callbacks.flush.as_ref()),
        ("present", callbacks.present.as_ref()),
        ("store", callbacks.store.as_ref()),
        ("outcome", callbacks.outcome.as_ref()),
    ] {
        Reflect::set(&host, &JsValue::from_str(name), function)?;
    }
    Reflect::set(&js_sys::global(), &JsValue::from_str("RogueHost"), &host)?;
    let options = Object::new();
    Reflect::set(&options, &JsValue::from_str("noInitialRun"), &JsValue::TRUE)?;
    for (name, function) in [
        ("locateFile", callbacks.locate.as_ref()),
        ("print", callbacks.print.as_ref()),
        ("printErr", callbacks.print.as_ref()),
        ("onAbort", callbacks.abort.as_ref()),
    ] {
        Reflect::set(&options, &JsValue::from_str(name), function)?;
    }
    CALLBACKS.with(|slot| *slot.borrow_mut() = Some(callbacks));
    scope().import_scripts_1("/build/game.js")?;
    let constructor: Function =
        Reflect::get(&js_sys::global(), &JsValue::from_str("createRogueModule"))?.dyn_into()?;
    let promise: Promise = constructor.call1(&JsValue::NULL, &options)?.dyn_into()?;
    let module = JsFuture::from(promise).await?;
    GAME.with(|slot| *slot.borrow_mut() = Some(module.clone()));
    let fs = Reflect::get(&module, &JsValue::from_str("FS"))?;
    let write = |path: &str, bytes: &JsValue| -> Result<(), JsValue> {
        let args = Array::new();
        args.push(&JsValue::from_str(path));
        args.push(bytes);
        call(&fs, "writeFile", &args)?;
        Ok(())
    };
    let restore = Reflect::get(&start, &JsValue::from_str("restore"))?;
    if !restore.is_undefined() && !restore.is_null() {
        write("/restore.json", &restore)?;
    }
    let files = Array::from(&Reflect::get(&start, &JsValue::from_str("files"))?);
    for pair in files.iter() {
        let pair = Array::from(&pair);
        write(&pair.get(0).as_string().unwrap_or_default(), &pair.get(1))?;
    }
    write(
        "/locale.txt",
        &Reflect::get(&start, &JsValue::from_str("locale"))?,
    )?;
    post(json!({"type":"ready"}))?;
    let args = Array::new();
    args.push(&JsValue::from_str("rg_run"));
    args.push(&JsValue::from_str("number"));
    args.push(&js(&json!(["number", "string"]))?);
    let parameters = Array::new();
    parameters.push(&Reflect::get(&start, &JsValue::from_str("seed"))?);
    parameters.push(&Reflect::get(&start, &JsValue::from_str("name"))?);
    args.push(&parameters);
    let code = call(&module, "ccall", &args)?;
    post(json!({"type":"exit","code":code.as_f64()}))
}
