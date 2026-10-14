//! Save bytes, native picker and IndexedDB transaction completion are Rust resources.
use super::*;
use js_sys::{Array, Promise, Uint8Array};
use wasm_bindgen_futures::{JsFuture, future_to_promise};
type Callback = Closure<dyn FnMut(Event)>;
impl Browser {
    fn database(&self) -> Result<Promise, JsValue> {
        if let Some(promise) = self.database.borrow().as_ref() {
            return Ok(promise.clone());
        }
        let factory = self
            .window
            .indexed_db()?
            .ok_or_else(|| JsValue::from_str("IndexedDB unavailable"))?;
        let request = factory.open_with_u32("original-rogue-web", 1)?;
        let promise = future_to_promise(async move {
            let mut callbacks: Option<(Callback, Callback, Callback)> = None;
            let wait = Promise::new(&mut |resolve, reject| {
                let rq = request.clone();
                let ok = Closure::new(move |_: Event| match rq.result() {
                    Ok(result) => {
                        let _ = resolve.call1(&JsValue::NULL, &result);
                    }
                    Err(e) => error(e),
                });
                let fail = reject.clone();
                let rq = request.clone();
                let no = Closure::new(move |_: Event| {
                    let e: JsValue = rq
                        .error()
                        .ok()
                        .flatten()
                        .map(Into::into)
                        .unwrap_or_else(|| JsValue::from_str("Save database blocked"));
                    let _ = fail.call1(&JsValue::NULL, &e);
                });
                let rq = request.clone();
                let upgrade = Closure::new(move |_: Event| {
                    let result = rq
                        .result()
                        .and_then(|v| v.dyn_into::<IdbDatabase>())
                        .and_then(|db| db.create_object_store("saves").map(|_| ()));
                    if let Err(e) = result {
                        let _ = reject.call1(&JsValue::NULL, &e);
                    }
                });
                request.set_onsuccess(Some(ok.as_ref().unchecked_ref()));
                request.set_onerror(Some(no.as_ref().unchecked_ref()));
                request.set_onblocked(Some(no.as_ref().unchecked_ref()));
                request.set_onupgradeneeded(Some(upgrade.as_ref().unchecked_ref()));
                callbacks = Some((ok, no, upgrade));
            });
            let result = JsFuture::from(wait).await;
            request.set_onsuccess(None);
            request.set_onerror(None);
            request.set_onblocked(None);
            request.set_onupgradeneeded(None);
            drop(callbacks);
            result
        });
        *self.database.borrow_mut() = Some(promise.clone());
        Ok(promise)
    }
    pub(super) async fn save_io(
        self: &Rc<Self>,
        bytes: Option<Vec<u8>>,
    ) -> Result<Option<Vec<u8>>, JsValue> {
        let database: IdbDatabase = JsFuture::from(self.database()?).await?.dyn_into()?;
        *self.connection.borrow_mut() = Some(database.clone());
        let mode = if bytes.is_some() {
            IdbTransactionMode::Readwrite
        } else {
            IdbTransactionMode::Readonly
        };
        let transaction = database.transaction_with_str_and_mode("saves", mode)?;
        let store = transaction.object_store("saves")?;
        let request = if let Some(bytes) = &bytes {
            store.put_with_key(
                &Uint8Array::from(bytes.as_slice()),
                &JsValue::from_str("manual"),
            )?
        } else {
            store.get(&JsValue::from_str("manual"))?
        };
        let mut callbacks: Option<(Callback, Callback)> = None;
        let wait = Promise::new(&mut |resolve, reject| {
            let ok = Closure::new(move |_: Event| {
                let _ = resolve.call0(&JsValue::NULL);
            });
            let tx = transaction.clone();
            let no = Closure::new(move |_: Event| {
                let e: JsValue = tx
                    .error()
                    .map(Into::into)
                    .unwrap_or_else(|| JsValue::from_str("Save transaction aborted"));
                let _ = reject.call1(&JsValue::NULL, &e);
            });
            transaction.set_oncomplete(Some(ok.as_ref().unchecked_ref()));
            transaction.set_onerror(Some(no.as_ref().unchecked_ref()));
            transaction.set_onabort(Some(no.as_ref().unchecked_ref()));
            callbacks = Some((ok, no));
        });
        // Request success is not durability. Report success only after the transaction commits.
        let result = JsFuture::from(wait).await;
        transaction.set_oncomplete(None);
        transaction.set_onerror(None);
        transaction.set_onabort(None);
        drop(callbacks);
        result?;
        if bytes.is_some() {
            return Ok(bytes);
        }
        let stored = request.result()?;
        Ok(if stored.is_undefined() || stored.is_null() {
            None
        } else {
            Some(Uint8Array::new(&stored).to_vec())
        })
    }
    pub(super) fn download(&self, effect: &Value) -> Result<(), JsValue> {
        let bytes = self.saved.borrow();
        let bytes = bytes
            .as_ref()
            .ok_or_else(|| JsValue::from_str("No accepted save"))?;
        let parts = Array::new();
        parts.push(&Uint8Array::from(bytes.as_slice()));
        let options = BlobPropertyBag::new();
        options.set_type(text(&effect["mime"]));
        let blob = Blob::new_with_u8_array_sequence_and_options(&parts, &options)?;
        let url = Url::create_object_url_with_blob(&blob)?;
        let link: HtmlAnchorElement = self.document.create_element("a")?.dyn_into()?;
        link.set_href(&url);
        link.set_download(text(&effect["filename"]));
        link.click();
        let callback = Closure::once_into_js(move || {
            let _ = Url::revoke_object_url(&url);
        });
        self.window
            .set_timeout_with_callback_and_timeout_and_arguments_0(
                callback.unchecked_ref(),
                number(&effect["revokeAfter"]) as i32,
            )?;
        Ok(())
    }
}
pub(super) struct Picker {
    input: HtmlInputElement,
    promise: Promise,
    change: Callback,
    cancel: Callback,
}
impl Picker {
    // Construct and click synchronously in the user event; await only the result.
    pub(super) fn new(document: &Document) -> Result<Self, JsValue> {
        let input: HtmlInputElement = document.create_element("input")?.dyn_into()?;
        input.set_type("file");
        input.set_accept(".json,application/json");
        input.set_hidden(true);
        let mut callbacks = None;
        let promise = Promise::new(&mut |resolve, _reject| {
            let picker = input.clone();
            let ok = resolve.clone();
            let change = Closure::new(move |_: Event| {
                let file: JsValue = picker
                    .files()
                    .and_then(|files| files.get(0))
                    .map(Into::into)
                    .unwrap_or(JsValue::NULL);
                let _ = ok.call1(&JsValue::NULL, &file);
            });
            let cancel = Closure::new(move |_: Event| {
                let _ = resolve.call1(&JsValue::NULL, &JsValue::NULL);
            });
            input.set_onchange(Some(change.as_ref().unchecked_ref()));
            // `cancel` is a standard picker event, exposed via EventTarget rather than an IDL property.
            let _ =
                input.add_event_listener_with_callback("cancel", cancel.as_ref().unchecked_ref());
            callbacks = Some((change, cancel));
        });
        let (change, cancel) = callbacks.expect("Promise executor is synchronous");
        let picker = Self {
            input,
            promise,
            change,
            cancel,
        };
        document
            .body()
            .ok_or_else(|| JsValue::from_str("Document body"))?
            .append_child(&picker.input)?;
        picker.input.click();
        Ok(picker)
    }
    pub(super) async fn read(self) -> Result<Option<Vec<u8>>, JsValue> {
        let file = JsFuture::from(self.promise.clone()).await?;
        if file.is_null() {
            return Ok(None);
        }
        let file: File = file.dyn_into()?;
        if file.size() > 16. * 1024. * 1024. {
            return Err(JsValue::from_str("Save file is too large"));
        }
        let bytes = Uint8Array::new(&JsFuture::from(file.array_buffer()).await?).to_vec();
        Ok(Some(bytes))
    }
}
impl Drop for Picker {
    fn drop(&mut self) {
        self.input.set_onchange(None);
        let _ = self
            .input
            .remove_event_listener_with_callback("cancel", self.cancel.as_ref().unchecked_ref());
        self.input.remove();
        let _ = &self.change;
    }
}
