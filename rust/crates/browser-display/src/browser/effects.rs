use super::*;
use js_sys::{Array, Uint8Array};
use wasm_bindgen_futures::JsFuture;
pub(super) struct WorkerSlot {
    pub(super) queue: Rc<queue::Queue>,
    worker: Worker,
    message: Closure<dyn FnMut(MessageEvent)>,
    failure: Closure<dyn FnMut(ErrorEvent)>,
}
impl Drop for WorkerSlot {
    fn drop(&mut self) {
        let _ = self.queue.close();
        self.worker.set_onmessage(None);
        self.worker.set_onerror(None);
        self.worker.terminate();
        let _ = (&self.message, &self.failure);
    }
}
impl Browser {
    fn api(
        self: &Rc<Self>,
        effect: &Value,
        operation: &str,
        ok: bool,
        extra: Value,
    ) -> Result<Value, JsValue> {
        let mut result = json!({"type":"api","operation":operation,"ok":ok});
        for key in ["generation", "request"] {
            if let Some(value) = effect.get(key) {
                result[key] = value.clone();
            }
        }
        for (key, value) in extra.as_object().into_iter().flatten() {
            result[key] = value.clone();
        }
        self.dispatch(result)
    }
    fn completed(self: &Rc<Self>, effect: &Value, operation: &str, result: Result<Value, JsValue>) {
        let response = match result {
            Ok(extra) => self.api(effect, operation, true, extra),
            Err(e) => self.api(effect, operation, false, json!({"error":values::error_message(&e)})),
        };
        if let Err(e) = response {
            error(e);
        }
    }
    fn position(input: &HtmlInputElement, rect: &Value) -> Result<(), JsValue> {
        for (name, key) in [("left", "x"), ("top", "y"), ("width", "w"), ("height", "h")] {
            input
                .style()
                .set_property(name, &format!("{}px", number(&rect[key])))?;
        }
        Ok(())
    }
    fn focus(input: &HtmlElement) -> Result<(), JsValue> {
        let options = FocusOptions::new();
        options.set_prevent_scroll(true);
        input.focus_with_options(&options)
    }
    fn start_worker(self: &Rc<Self>, effect: &Value) -> Result<(), JsValue> {
        let queue = Rc::new(queue::Queue::new(None, number(&effect["capacity"]) as u32)?);
        let worker = Worker::new("/web/worker.js")?;
        let generation = effect["generation"].clone();
        let start = js(
            &json!({"type":"start","capacity":queue.capacity,"seed":effect["seed"],"name":effect["name"],"locale":effect["locale"],"trace":effect["trace"],"message_paging":effect["message_paging"]}),
        )?;
        Reflect::set(&start, &JsValue::from_str("queue"), &queue.buffer)?;
        let transfers = Array::new();
        if effect["restore"].as_bool() == Some(true) {
            let bytes = self.saved.borrow();
            let bytes = bytes
                .as_ref()
                .ok_or_else(|| JsValue::from_str("No accepted restore bytes"))?;
            let restore = Uint8Array::from(bytes.as_slice());
            transfers.push(&restore.buffer());
            Reflect::set(&start, &JsValue::from_str("restore"), &restore)?;
        }
        let weak = Rc::downgrade(self);
        let endpoint = worker.clone();
        let message = Closure::new(move |event: MessageEvent| {
            let result = (|| -> Result<(), JsValue> {
                if let Some(host) = weak.upgrade() {
                    let data = event.data();
                    let kind = Reflect::get(&data, &JsValue::from_str("type"))?
                        .as_string()
                        .unwrap_or_default();
                    if kind == "host-ready" {
                        endpoint.post_message_with_transfer(&start, &transfers)?;
                        return Ok(());
                    }
                    let mut message = if kind == "save" { json!({"type":"save"}) } else { value(&data)? };
                    if kind == "save" {
                        message["bytes"] = json!(
                            Uint8Array::new(&Reflect::get(&data, &JsValue::from_str("bytes"))?)
                                .to_vec()
                        );
                    }
                    host.dispatch(json!({"type":"worker","generation":generation,"data":message}))?;
                }
                Ok(())
            })();
            if let Err(e) = result {
                error(e);
            }
        });
        let weak = Rc::downgrade(self);
        let generation = effect["generation"].clone();
        let failure = Closure::new(move |event: ErrorEvent| {
            if let Some(host) = weak.upgrade() {
                if let Err(e)=host.dispatch(json!({"type":"worker","generation":generation,"data":{"type":"error","text":event.message()}})){error(e);}
            }
        });
        worker.set_onmessage(Some(message.as_ref().unchecked_ref()));
        worker.set_onerror(Some(failure.as_ref().unchecked_ref()));
        *self.worker.borrow_mut() = Some(WorkerSlot {
            queue,
            worker,
            message,
            failure,
        });
        Ok(())
    }
    pub(super) fn effect(self: &Rc<Self>, effect: &Value) -> Result<Option<Value>, JsValue> {
        match text(&effect["kind"]) {
            "timer" => {
                if let Some((id, _)) = self.blink.borrow_mut().take() {
                    self.window.clear_interval_with_handle(id);
                }
                let weak = Rc::downgrade(self);
                let callback = Closure::new(move || {
                    if let Some(host) = weak.upgrade() {
                        if let Err(e) = host.invalidate() {
                            error(e);
                        }
                    }
                });
                let id = self
                    .window
                    .set_interval_with_callback_and_timeout_and_arguments_0(
                        callback.as_ref().unchecked_ref(),
                        number(&effect["interval"]) as i32,
                    )?;
                *self.blink.borrow_mut() = Some((id, callback));
            }
            "animation-frame" => self.invalidate()?,
            "hold-timer" => {
                if let Some((id, _)) = self.hold.borrow_mut().take() {
                    self.window.clear_timeout_with_handle(id);
                }
                let weak = Rc::downgrade(self);
                let pointer = effect["id"].clone();
                let callback = Closure::new(move || {
                    if let Some(host) = weak.upgrade() {
                        if let Err(e) = host.event(json!({"type":"hold-tick","id":pointer}), None) {
                            error(e);
                        }
                    }
                });
                let id = self
                    .window
                    .set_timeout_with_callback_and_timeout_and_arguments_0(
                        callback.as_ref().unchecked_ref(),
                        number(&effect["delay"]) as i32,
                    )?;
                *self.hold.borrow_mut() = Some((id, callback));
            }
            "field" => {
                let input = self
                    .inputs
                    .get(text(&effect["id"]))
                    .ok_or_else(|| JsValue::from_str("Unknown native field"))?;
                for (key, value) in effect["properties"].as_object().into_iter().flatten() {
                    Reflect::set(input, &JsValue::from_str(key), &js(value)?)?;
                }
            }
            "native-position" | "focus" => {
                let input = self
                    .inputs
                    .get(text(&effect["id"]))
                    .ok_or_else(|| JsValue::from_str("Unknown native field"))?;
                Self::position(input, &effect["rect"])?;
                if text(&effect["kind"]) == "focus" {
                    Self::focus(input)?;
                }
            }
            "native-focus" => {
                if let Some(input) = self.inputs.get(text(&effect["id"])) {
                    Self::focus(input)?;
                }
            }
            "native-blur" => {
                if let Some(input) = self.inputs.get(text(&effect["id"])) {
                    input.blur()?;
                }
            }
            "canvas-focus" => Self::focus(&self.canvas)?,
            "capture" => {
                let id = number(&effect["id"]) as i32;
                self.canvas.set_pointer_capture(id)?;
                self.captured.borrow_mut().insert(id);
            }
            "release" => {
                let id = number(&effect["id"]) as i32;
                self.captured.borrow_mut().remove(&id);
                if self.canvas.has_pointer_capture(id) {
                    self.canvas.release_pointer_capture(id)?;
                }
            }
            "cursor" => self
                .canvas
                .style()
                .set_property("cursor", text(&effect["value"]))?,
            "worker-stop" => {
                self.worker.borrow_mut().take();
            }
            "queue-close" => {
                if let Some(slot) = self.worker.borrow().as_ref() {
                    slot.queue.close()?;
                }
            }
            "worker-start" => self.start_worker(effect)?,
            "queue" => {
                let events: Vec<_> = effect["events"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|v| v.as_i64().unwrap_or(0) as i32)
                    .collect();
                let ok = match self.worker.borrow().as_ref() {
                    Some(slot) => slot.queue.push_many(&events)?,
                    None => false,
                };
                return self
                    .api(
                        effect,
                        "queue",
                        ok,
                        json!({"after":effect["after"],"request":effect["request"]}),
                    )
                    .map(Some);
            }
            "save-read" | "save-write" => {
                let effect = effect.clone();
                let host = self.clone();
                let operation = if text(&effect["kind"]) == "save-read" {
                    text(&effect["operation"]).to_string()
                } else {
                    "save-write".to_string()
                };
                let bytes = if operation == "save-write" {
                    Some(
                        effect["bytes"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .map(|v| v.as_u64().unwrap_or(0) as u8)
                            .collect(),
                    )
                } else {
                    None
                };
                wasm_bindgen_futures::spawn_local(async move {
                    let result = host.save_io(bytes).await.map(|bytes| {
                        let length = bytes.as_ref().map_or(0, Vec::len);
                        let extra = if operation == "save-write" {
                            json!({"length":length})
                        } else {
                            json!({"bytes":bytes,"length":length})
                        };
                        host.candidates
                            .borrow_mut()
                            .insert(effect["request"].as_u64().unwrap_or(0), bytes);
                        extra
                    });
                    host.completed(&effect, &operation, result);
                });
            }
            "save-import" => {
                let picker = saves::Picker::new(&self.document)?;
                let host = self.clone();
                let effect = effect.clone();
                wasm_bindgen_futures::spawn_local(async move {
                    let result = picker.read().await;
                    match result {
                        Ok(bytes) => {
                            let cancelled = bytes.is_none();
                            host.candidates
                                .borrow_mut()
                                .insert(effect["request"].as_u64().unwrap_or(0), bytes.clone());
                            if let Err(e) = host.api(
                                &effect,
                                "import",
                                !cancelled,
                                json!({"cancelled":cancelled,"bytes":bytes}),
                            ) {
                                error(e);
                            }
                        }
                        Err(e) => host.completed(&effect, "import", Err(e)),
                    }
                });
            }
            "save-accept" => {
                let candidate = self
                    .candidates
                    .borrow_mut()
                    .remove(&effect["request"].as_u64().unwrap_or(0))
                    .ok_or_else(|| JsValue::from_str("Missing accepted save candidate"))?;
                *self.saved.borrow_mut() = candidate;
            }
            "save-discard" => {
                self.candidates
                    .borrow_mut()
                    .remove(&effect["request"].as_u64().unwrap_or(0));
            }
            "assets" => {
                let effect = effect.clone();
                let host = self.clone();
                wasm_bindgen_futures::spawn_local(async move {
                    let result = images::load(&effect)
                        .await
                        .map(|(tiles, dimensions)| {
                            host.tiles
                                .borrow_mut()
                                .insert(text(&effect["set"]).to_string(), tiles);
                            json!({"set":effect["set"],"images":dimensions})
                        });
                    match result {
                        Ok(extra) => host.completed(&effect, "assets", Ok(extra)),
                        Err(e) => {
                            if let Err(e) = host.api(
                                &effect,
                                "assets",
                                false,
                                json!({"set":effect["set"],"error":values::error_message(&e)}),
                            ) {
                                error(e);
                            }
                        }
                    }
                });
            }
            "storage-write" => {
                let result = self
                    .window
                    .local_storage()?
                    .ok_or_else(|| JsValue::from_str("Local storage unavailable"))?
                    .set_item(text(&effect["key"]), text(&effect["value"]));
                if let Err(e) = result {
                    self.completed(effect, "storage-write", Err(e));
                }
            }
            "random" => {
                let mut bytes = [0u8; 4];
                self.window
                    .crypto()?
                    .get_random_values_with_u8_array(&mut bytes)?;
                return self
                    .api(
                        effect,
                        "random",
                        true,
                        json!({"id":effect["id"],"value":u32::from_le_bytes(bytes)}),
                    )
                    .map(Some);
            }
            "fullscreen" => {
                let enter = effect["enter"].as_bool() == Some(true);
                // Fullscreen must be requested while user activation is still live.
                // This IDL's fullscreen signatures erase Promise; preserve the actual API result.
                let promise = if enter {
                    let stage = self
                        .document
                        .get_element_by_id("canvas-stage")
                        .ok_or_else(|| JsValue::from_str("Canvas stage"))?;
                    call(&stage, "requestFullscreen", &Array::new())
                } else {
                    call(&self.document, "exitFullscreen", &Array::new())
                };
                match promise.and_then(|p| p.dyn_into::<js_sys::Promise>()) {
                    Ok(promise) => {
                        let host = self.clone();
                        let effect = effect.clone();
                        wasm_bindgen_futures::spawn_local(async move {
                            let result = JsFuture::from(promise).await.map(|_| json!({}));
                            if result.is_ok() && enter {
                                host.lock_portrait();
                            }
                            host.completed(&effect, "fullscreen", result);
                        });
                    }
                    Err(e) => self.completed(effect, "fullscreen", Err(e)),
                }
            }
            "download" => self.download(effect)?,
            "open" => {
                self.window.open_with_url_and_target_and_features(
                    text(&effect["url"]),
                    "_blank",
                    "noopener",
                )?;
            }
            "document" => {
                if let Some(root) = self.document.document_element() {
                    root.set_attribute("lang", text(&effect["language"]))?;
                }
                self.document.set_title(text(&effect["title"]));
                if let Some(heading) = self.document.get_element_by_id("app-heading") {
                    heading.set_text_content(Some(text(&effect["heading"])));
                }
            }
            "console" => {
                if text(&effect["level"]) == "error" {
                    console::error_1(&JsValue::from_str(text(&effect["text"])));
                } else {
                    console::log_1(&JsValue::from_str(text(&effect["text"])));
                }
            }
            other => {
                return Err(JsValue::from_str(&format!(
                    "Unknown browser effect: {other}"
                )));
            }
        }
        Ok(None)
    }
}
