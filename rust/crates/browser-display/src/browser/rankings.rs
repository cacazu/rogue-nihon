//! Atomic browser-local ranking storage; no game commands or score arithmetic.
use super::*;
use wasm_bindgen_futures::JsFuture;
impl Browser {
    pub(super) async fn rankings_io(self:&Rc<Self>,score:Option<crate::rankings::Score>)->Result<Value,JsValue> {
        let database:IdbDatabase=JsFuture::from(self.database()?).await?.dyn_into()?;
        let transaction=database.transaction_with_str_and_mode("saves",if score.is_some(){IdbTransactionMode::Readwrite}else{IdbTransactionMode::Readonly})?;
        let store=transaction.object_store("saves")?;let key=JsValue::from_str("personal-rankings-v1");let request=store.get(&key)?;
        let output:Rc<RefCell<Option<Value>>>=Rc::new(RefCell::new(None));let output_read=output.clone();let read=request.clone();let tx=transaction.clone();
        let read_success:Closure<dyn FnMut(Event)>=Closure::new(move|_:Event| {
            let result=(||->Result<(),JsValue>{
                let value=read.result()?;let raw=if value.is_undefined()||value.is_null(){None}else{Some(value.as_string().ok_or_else(||JsValue::from_str("Invalid rankings"))?)};
                let mut book=crate::rankings::Book::parse(raw.as_deref()).map_err(|e|JsValue::from_str(&e))?;
                if let Some(score)=&score {book=book.merge(score.clone()).map_err(|e|JsValue::from_str(&e))?;store.put_with_key(&JsValue::from_str(&book.value().to_string()),&key)?;}
                *output_read.borrow_mut()=Some(book.value());Ok(())
            })();
            if result.is_err() {let _=tx.abort();}
        });
        request.set_onsuccess(Some(read_success.as_ref().unchecked_ref()));
        let mut callbacks:Option<(Closure<dyn FnMut(Event)>,Closure<dyn FnMut(Event)>)>=None;
        let wait=js_sys::Promise::new(&mut|resolve,reject| {
            let ok=Closure::new(move|_:Event|{let _=resolve.call0(&JsValue::NULL);});
            let tx=transaction.clone();let no=Closure::new(move|_:Event|{let error=tx.error().map(Into::into).unwrap_or_else(||JsValue::from_str("Ranking transaction aborted"));let _=reject.call1(&JsValue::NULL,&error);});
            transaction.set_oncomplete(Some(ok.as_ref().unchecked_ref()));transaction.set_onabort(Some(no.as_ref().unchecked_ref()));transaction.set_onerror(Some(no.as_ref().unchecked_ref()));callbacks=Some((ok,no));
        });
        let result=JsFuture::from(wait).await;request.set_onsuccess(None);transaction.set_oncomplete(None);transaction.set_onabort(None);transaction.set_onerror(None);drop(read_success);drop(callbacks);result?;
        let result=output.borrow_mut().take().ok_or_else(||JsValue::from_str("Ranking result unavailable"));result
    }
}
