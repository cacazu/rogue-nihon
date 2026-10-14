//! Browser resources and their lifetime belong to Rust. JS only boots this instance.
mod effects;
mod images;
mod paint;
mod queue;
mod saves;
mod worker;
use js_sys::{Function, JSON, Reflect};
use rogue_display::widgets::TextSize;
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
};
use wasm_bindgen::{JsCast, prelude::*};
use web_sys::*;
type AnimationCallback = Closure<dyn FnMut(f64)>;
type Timer = (i32, Closure<dyn FnMut()>);
type CanvasObserver = (ResizeObserver, Closure<dyn FnMut()>);

thread_local! {
    static HOST: RefCell<Option<Rc<Browser>>> = const { RefCell::new(None) };
}
pub(super) fn js(value: &Value) -> Result<JsValue, JsValue> {
    JSON::parse(&value.to_string())
}
pub(super) fn value(value: &JsValue) -> Result<Value, JsValue> {
    serde_json::from_str(&JSON::stringify(value)?.as_string().unwrap_or_default())
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
pub(super) fn error(error: JsValue) {
    console::error_2(&JsValue::from_str("Rust browser host"), &error);
}
fn number(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.)
}
fn text(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
pub(super) fn call(object: &JsValue, name: &str, args: &js_sys::Array) -> Result<JsValue, JsValue> {
    Reflect::get(object, &JsValue::from_str(name))?
        .dyn_into::<Function>()?
        .apply(object, args)
}
pub(super) struct Listener {
    target: EventTarget,
    name: String,
    capture: bool,
    callback: Closure<dyn FnMut(Event)>,
}
impl Drop for Listener {
    fn drop(&mut self) {
        let _ = self.target.remove_event_listener_with_callback_and_bool(
            &self.name,
            self.callback.as_ref().unchecked_ref(),
            self.capture,
        );
    }
}
pub(super) struct Browser {
    window: Window,
    document: Document,
    canvas: HtmlCanvasElement,
    context: CanvasRenderingContext2d,
    surface: HtmlElement,
    controls: HtmlElement,
    description: HtmlElement,
    inputs: BTreeMap<String, HtmlInputElement>,
    listeners: RefCell<Vec<Listener>>,
    observer: RefCell<Option<CanvasObserver>>,
    frame_callback: RefCell<Option<AnimationCallback>>,
    frame_id: Cell<Option<i32>>,
    pending: Cell<bool>,
    rotated: Cell<bool>,
    reversed: Cell<bool>,
    captured: RefCell<BTreeSet<i32>>,
    scene: RefCell<Value>,
    state: RefCell<Value>,
    commands: RefCell<Value>,
    metrics: RefCell<BTreeMap<String, TextSize>>,
    buttons: RefCell<BTreeMap<String, HtmlButtonElement>>,
    tiles: RefCell<BTreeMap<String, images::Tiles>>,
    draw_count: Cell<u32>,
    worker: RefCell<Option<effects::WorkerSlot>>,
    saved: RefCell<Option<Vec<u8>>>,
    candidates: RefCell<BTreeMap<u64, Option<Vec<u8>>>>,
    database: RefCell<Option<js_sys::Promise>>,
    connection: RefCell<Option<IdbDatabase>>,
    hold: RefCell<Option<Timer>>,
    blink: RefCell<Option<Timer>>,
}
impl Drop for Browser {
    fn drop(&mut self) {
        if let Some(id) = self.frame_id.take() { let _ = self.window.cancel_animation_frame(id); }
        if let Some((id,_)) = self.hold.get_mut().take() { self.window.clear_timeout_with_handle(id); }
        if let Some((id,_)) = self.blink.get_mut().take() { self.window.clear_interval_with_handle(id); }
        if let Some((observer,_)) = self.observer.get_mut().take() { observer.disconnect(); }
        if let Some(database) = self.connection.get_mut().take() { database.close(); }
    }
}
#[wasm_bindgen]
pub fn browser_start() -> Result<(), JsValue> {
    let window = web_sys::window().ok_or_else(|| JsValue::from_str("Main window unavailable"))?;
    let document = window
        .document()
        .ok_or_else(|| JsValue::from_str("Document unavailable"))?;
    let element = |id: &str| {
        document
            .get_element_by_id(id)
            .ok_or_else(|| JsValue::from_str(id))
    };
    let canvas: HtmlCanvasElement = element("rogue-canvas")?.dyn_into()?;
    let options = js(&json!({"alpha":false}))?;
    let context = canvas
        .get_context_with_context_options("2d", &options)?
        .ok_or_else(|| JsValue::from_str("Canvas2D unavailable"))?
        .dyn_into()?;
    let surface: HtmlElement = element("canvas-surface")?.dyn_into()?;
    let controls: HtmlElement = document.create_element("div")?.dyn_into()?;
    controls.set_id("canvas-controls");
    controls
        .style()
        .set_css_text("position:absolute;inset:0;pointer-events:none");
    let description: HtmlElement = document.create_element("pre")?.dyn_into()?;
    description.set_id("rogue-observation");
    description.style().set_css_text("position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);pointer-events:none");
    surface.append_child(&controls)?;
    surface.append_child(&description)?;
    let mut inputs = BTreeMap::new();
    for id in ["name", "seed", "prompt-text", "command-key", "repeat-count"] {
        inputs.insert(id.to_string(), element(id)?.dyn_into()?);
    }
    let host = Rc::new(Browser {
        window,
        document,
        canvas,
        context,
        surface,
        controls,
        description,
        inputs,
        listeners: RefCell::new(Vec::new()),
        observer: RefCell::new(None),
        frame_callback: RefCell::new(None),
        frame_id: Cell::new(None),
        pending: Cell::new(false),
        rotated: Cell::new(false),
        reversed: Cell::new(false),
        captured: RefCell::new(BTreeSet::new()),
        scene: RefCell::new(json!({})),
        state: RefCell::new(json!({})),
        commands: RefCell::new(json!([])),
        metrics: RefCell::new(BTreeMap::new()),
        buttons: RefCell::new(BTreeMap::new()),
        tiles: RefCell::new(BTreeMap::new()),
        draw_count: Cell::new(0),
        worker: RefCell::new(None),
        saved: RefCell::new(None),
        candidates: RefCell::new(BTreeMap::new()),
        database: RefCell::new(None),
        connection: RefCell::new(None),
        hold: RefCell::new(None),
        blink: RefCell::new(None),
    });
    HOST.with(|slot| *slot.borrow_mut() = Some(host.clone()));
    host.connect()?;
    host.lock_portrait();
    let storage = host.window.local_storage().ok().flatten();
    let preference = storage
        .as_ref()
        .and_then(|s| s.get_item("rogue-map-display-v1").ok().flatten());
    let inventory = storage
        .as_ref()
        .and_then(|s| s.get_item("rogue-inventory-view-v1").ok().flatten());
    let parameters = UrlSearchParams::new_with_str(&host.window.location().search()?)?;
    let parameters = js_sys::Object::from_entries(&parameters)?;
    let isolated = Reflect::get(&host.window, &JsValue::from_str("crossOriginIsolated"))?
        .as_bool()
        .unwrap_or(false)
        && !Reflect::get(&host.window, &JsValue::from_str("SharedArrayBuffer"))?.is_undefined();
    host.dispatch(json!({"type":"boot","preference":preference,"inventoryPreference":inventory,"environment":{"parameters":value(&parameters)?,"isolated":isolated}}))?;
    Ok(())
}
// The same policy ABI serves headless consumers; no browser resources are needed.
#[cfg(feature = "browser-test")]
#[wasm_bindgen]
pub fn policy_request(input: &str) -> Result<String, JsValue> {
    let request = serde_json::from_str(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(super::request(request).to_string())
}
/// UI host ABI. Includes browser effects, unlike the platform-independent policy ABI.
#[cfg(feature = "browser-test")]
#[wasm_bindgen]
pub fn browser_request(input: &str) -> Result<String, JsValue> {
    let request = serde_json::from_str(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let host = HOST
        .with(|slot| slot.borrow().clone())
        .ok_or_else(|| JsValue::from_str("Browser not started"))?;
    Ok(host.dispatch(request)?.to_string())
}
#[cfg(feature = "browser-test")]
#[wasm_bindgen]
pub fn browser_snapshot() -> Result<String, JsValue> {
    let host = HOST
        .with(|slot| slot.borrow().clone())
        .ok_or_else(|| JsValue::from_str("Browser not started"))?;
    let pending = host
        .worker
        .borrow()
        .as_ref()
        .map(|slot| slot.queue.pending())
        .transpose()?
        .unwrap_or(0);
    Ok(json!({"diagnostics":*host.scene.borrow(),"state":*host.state.borrow(),"commands":*host.commands.borrow(),"queuePending":pending,"drawCount":host.draw_count.get()}).to_string())
}
pub fn measure(text: &str, size: f64, bold: bool, mono: bool) -> TextSize {
    let host = HOST.with(|slot| slot.borrow().clone());
    let Some(host) = host else {
        return TextSize {
            width: text.chars().count() as f64 * size * 0.6,
            ascent: 0.,
            descent: size,
        };
    };
    let key = format!("{bold}:{mono}:{size}:{text}");
    if let Some(metric) = host.metrics.borrow().get(&key) {
        return *metric;
    }
    host.font(size, bold, mono);
    let result = host
        .context
        .measure_text(text)
        .map(|m| TextSize {
            width: m.width(),
            ascent: m.actual_bounding_box_ascent(),
            descent: m.actual_bounding_box_descent(),
        })
        .unwrap_or(TextSize {
            width: 0.,
            ascent: 0.,
            descent: size,
        });
    let mut metrics = host.metrics.borrow_mut();
    if metrics.len() > 20000 {
        metrics.clear();
    }
    metrics.insert(key, result);
    result
}
impl Browser {
    fn coarse(&self) -> bool {
        self.window
            .match_media("(pointer: coarse)")
            .ok()
            .flatten()
            .is_some_and(|m| m.matches())
    }
    fn orientation(&self) -> Result<(), JsValue> {
        let screen = self.window.screen()?;
        let rotated = self.coarse() && screen.width()? > screen.height()?;
        let reversed = rotated && screen.orientation().angle()? == 270;
        self.rotated.set(rotated);
        self.reversed.set(reversed);
        let classes = self
            .document
            .document_element()
            .ok_or_else(|| JsValue::from_str("Document root"))?
            .class_list();
        classes.toggle_with_force("portrait-rotated", rotated)?;
        classes.toggle_with_force("portrait-reversed", reversed)?;
        Ok(())
    }
    fn lock_portrait(&self) {
        if self.coarse() {
            if let Ok(orientation) = self.window.screen().map(|s| s.orientation()) {
                if let Ok(promise) = orientation.lock(OrientationLockType::Portrait) {
                    wasm_bindgen_futures::spawn_local(async move {
                        let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
                    });
                }
            }
        }
    }
    fn listen(
        self: &Rc<Self>,
        target: &EventTarget,
        name: &str,
        capture: bool,
        callback: impl Fn(&Rc<Self>, Event) -> Result<(), JsValue> + 'static,
    ) -> Result<(), JsValue> {
        let weak = Rc::downgrade(self);
        let callback = Closure::new(move |event| {
            if let Some(host) = weak.upgrade() {
                if let Err(e) = callback(&host, event) {
                    error(e);
                }
            }
        });
        let options = AddEventListenerOptions::new();
        options.set_capture(capture);
        options.set_passive(false);
        target.add_event_listener_with_callback_and_add_event_listener_options(
            name,
            callback.as_ref().unchecked_ref(),
            &options,
        )?;
        self.listeners.borrow_mut().push(Listener {
            target: target.clone(),
            name: name.to_string(),
            capture,
            callback,
        });
        Ok(())
    }
    fn connect(self: &Rc<Self>) -> Result<(), JsValue> {
        self.orientation()?;
        let weak = Rc::downgrade(self);
        let frame = Closure::new(move |_| {
            if let Some(host) = weak.upgrade() {
                host.pending.set(false);
                host.frame_id.set(None);
                if let Err(e) = host.paint() {
                    error(e);
                }
            }
        });
        *self.frame_callback.borrow_mut() = Some(frame);
        for (id, input) in &self.inputs {
            let id = id.clone();
            self.listen(input.as_ref(), "input", false, move |host, _| {
                host.event(json!({"type":"native-input","id":id}), None)?;
                Ok(())
            })?;
            for event in ["keyup", "focus", "blur", "compositionupdate"] {
                self.listen(input.as_ref(), event, false, |host, _| host.invalidate())?;
            }
        }
        for name in ["compositionstart", "compositionend"] {
            self.listen(self.document.as_ref(), name, false, move |host, e| {
                host.event(json!({"type":name}), Some(e))?;
                Ok(())
            })?;
        }
        for target in [self.canvas.as_ref(), self.controls.as_ref()] {
            for (native, kind) in [
                ("pointerdown", "down"),
                ("pointermove", "move"),
                ("pointerup", "up"),
            ] {
                self.listen(target, native, false, move |host, e| {
                    let p: PointerEvent = e.clone().dyn_into()?;
                    host.event(host.pointer(&p, kind), Some(e))?;
                    Ok(())
                })?;
            }
            for name in ["pointercancel", "lostpointercapture"] {
                self.listen(target, name, false, |host, e| {
                    let p: PointerEvent = e.dyn_into()?;
                    host.event(json!({"type":"cancel","id":p.pointer_id()}), None)?;
                    Ok(())
                })?;
            }
            self.listen(target, "wheel", false, |host, e| {
                let w: WheelEvent = e.clone().dyn_into()?; let (x,y) = host.point(w.client_x() as f64, w.client_y() as f64);
                let sign = if host.reversed.get() {-1.} else {1.};
                host.event(json!({"type":"wheel","x":x,"y":y,"dx":if host.rotated.get(){sign*w.delta_y()}else{w.delta_x()},"dy":if host.rotated.get(){-sign*w.delta_x()}else{w.delta_y()},"deltaMode":w.delta_mode()}), Some(e))?; Ok(())
            })?;
            for name in ["touchstart", "contextmenu"] {
                self.listen(target, name, false, move |host, e| {
                    host.event(json!({"type":name}), Some(e))?;
                    Ok(())
                })?;
            }
        }
        self.listen(self.canvas.as_ref(), "pointerleave", false, |host, _| {
            host.event(json!({"type":"leave"}), None)?;
            Ok(())
        })?;
        self.listen(self.document.as_ref(), "keydown", true, |host, e| {
            let k: KeyboardEvent = e.clone().dyn_into()?;
            host.event(json!({"type":"key","key":k.key(),"shift":k.shift_key(),"shiftKey":k.shift_key(),"ctrlKey":k.ctrl_key(),"altKey":k.alt_key(),"metaKey":k.meta_key(),"repeat":k.repeat(),"native":host.document.active_element().map(|e| e.id()),"composing":k.is_composing(),"keyCode":k.key_code()}), Some(e))?; Ok(())
        })?;
        for name in ["blur", "pagehide"] {
            self.listen(self.window.as_ref(), name, false, move |host, _| {
                host.event(json!({"type":name}), None)?;
                Ok(())
            })?;
        }
        self.listen(
            self.document.as_ref(),
            "visibilitychange",
            false,
            |host, _| {
                host.event(
                    json!({"type":"visibilitychange","hidden":host.document.hidden()}),
                    None,
                )?;
                Ok(())
            },
        )?;
        self.listen(
            self.document.as_ref(),
            "selectionchange",
            false,
            |host, _| host.invalidate(),
        )?;
        for (target, name, reason) in [
            (self.window.as_ref(), "resize", "resize"),
            (self.document.as_ref(), "fullscreenchange", "fullscreen"),
        ] {
            self.listen(target, name, false, move |host, _| {
                host.orientation()?;
                host.event(json!({"type":"surface-change","reason":reason}), None)?;
                Ok(())
            })?;
        }
        if let Ok(orientation) = self.window.screen().map(|s| s.orientation()) {
            self.listen(orientation.as_ref(), "change", false, |host, _| {
                host.orientation()?;
                host.event(json!({"type":"surface-change","reason":"resize"}), None)?;
                Ok(())
            })?;
        }
        let weak = Rc::downgrade(self);
        let callback = Closure::new(move || {
            if let Some(host) = weak.upgrade() {
                if let Err(e) = host.invalidate() {
                    error(e);
                }
            }
        });
        let observer = ResizeObserver::new(callback.as_ref().unchecked_ref())?;
        observer.observe(&self.surface);
        *self.observer.borrow_mut() = Some((observer, callback));
        Ok(())
    }
    fn point(&self, x: f64, y: f64) -> (f64, f64) {
        let bounds = self.canvas.get_bounding_client_rect();
        let scene = self.scene.borrow();
        let w = number(&scene["width"]);
        let h = number(&scene["height"]);
        if self.reversed.get() {
            (
                (bounds.bottom() - y) * w / bounds.height(),
                (x - bounds.left()) * h / bounds.width(),
            )
        } else if self.rotated.get() {
            (
                (y - bounds.top()) * w / bounds.height(),
                (bounds.right() - x) * h / bounds.width(),
            )
        } else {
            (
                (x - bounds.left()) * w / bounds.width(),
                (y - bounds.top()) * h / bounds.height(),
            )
        }
    }
    fn pointer(&self, p: &PointerEvent, kind: &str) -> Value {
        let (x, y) = self.point(p.client_x() as f64, p.client_y() as f64);
        let captures: Vec<_> = self
            .captured
            .borrow()
            .iter()
            .copied()
            .filter(|id| self.canvas.has_pointer_capture(*id))
            .collect();
        json!({"type":kind,"id":p.pointer_id(),"x":x,"y":y,"pointerType":p.pointer_type(),"button":p.button(),"buttons":p.buttons(),"primary":p.is_primary(),"captures":captures,"hasCapture":self.canvas.has_pointer_capture(p.pointer_id())})
    }
    fn observations(&self) -> Value {
        let active = self.document.active_element();
        let mut inputs = serde_json::Map::new();
        for (id, input) in &self.inputs {
            inputs.insert(id.clone(), json!({"value":input.value(),"placeholder":input.placeholder(),"start":input.selection_start().ok().flatten(),"end":input.selection_end().ok().flatten(),"active":active.as_ref().is_some_and(|a| a == input.as_ref())}));
        }
        json!({"inputs":inputs,"environment":{"fullscreen":self.document.fullscreen_element().is_some()}})
    }
    fn request(&self, request: Value) -> Value {
        let mut observed = self.observations();
        if let Some(object) = request.as_object() {
            for (key, value) in object {
                observed[key] = value.clone();
            }
        }
        let response = super::request(observed);
        if !response["diagnostics"].is_null() {
            *self.scene.borrow_mut() = response["diagnostics"].clone();
        }
        if !response["state"].is_null() {
            *self.state.borrow_mut() = response["state"].clone();
        }
        if !response["commands"].is_null() {
            *self.commands.borrow_mut() = response["commands"].clone();
        }
        response
    }
    fn dispatch(self: &Rc<Self>, request: Value) -> Result<Value, JsValue> {
        let mut response = self.request(request);
        let mut accepted = false;
        for effect in response["effects"].as_array().into_iter().flatten() {
            if let Some(nested) = self.effect(effect)? {
                if nested["accepted"].as_bool() == Some(true) {
                    accepted = true;
                }
            }
        }
        if accepted {
            response["accepted"] = json!(true);
        }
        self.invalidate()?;
        Ok(response)
    }
    fn event(self: &Rc<Self>, event: Value, native: Option<Event>) -> Result<Value, JsValue> {
        let result = self.dispatch(json!({"type":"event","event":event}))?;
        if let Some(native) = native {
            if result["consumed"].as_bool() == Some(true) {
                native.prevent_default();
            }
            if result["stopPropagation"].as_bool() == Some(true) {
                native.stop_immediate_propagation();
            }
        }
        Ok(result)
    }
    fn invalidate(&self) -> Result<(), JsValue> {
        if !self.pending.replace(true) {
            if let Some(callback) = self.frame_callback.borrow().as_ref() {
                match self.window.request_animation_frame(callback.as_ref().unchecked_ref()) {
                    Ok(id)=>self.frame_id.set(Some(id)),
                    Err(e)=>{self.pending.set(false);return Err(e);}
                }
            }
        }
        Ok(())
    }
}
