//! Inventory view lifetime follows the active adventure and the one durable save slot.
use serde_json::{Value,json};
#[derive(Default)]
pub(crate) struct InventoryLifetime {
    saved: Option<Value>,
    legacy: Option<Value>,
    owner: Option<Owner>,
    restore: Option<(Option<String>,Option<Value>)>,
}
enum Owner { Saved(String), Legacy }
fn metadata(value:&Value)->Option<Value> {
    let token=value["token"].as_str().filter(|token|!token.is_empty() && token.len()<=128)?;
    (value["version"]==1 && value["view"]["version"]==1).then(||json!({"version":1,"token":token,"view":value["view"]}))
}
impl InventoryLifetime {
    pub fn load(raw:&str)->(Self,Option<Value>) {
        let value=serde_json::from_str::<Value>(raw).unwrap_or(Value::Null);
        if value["version"]==2 {
            let active=(value["active"]["version"]==1).then(||value["active"].clone());
            let legacy=(value["legacy"]["version"]==1).then(||value["legacy"].clone());
            (Self{saved:metadata(&value["saved"]),legacy,..Default::default()},active)
        } else if value["version"]==1 {
            (Self{legacy:Some(value.clone()),..Default::default()},Some(value))
        } else {(Self::default(),None)}
    }
    pub fn storage(&self,active:Value)->Value {json!({"version":2,"active":active,"saved":self.saved,"legacy":self.legacy})}
    pub fn start(&mut self,restore:bool) {self.owner=None;if !restore {self.restore=None;}}
    pub fn cancel_restore(&mut self) {self.restore=None;}
    pub fn stage_restore(&mut self,slot:&Value) {
        if let Some(slot)=metadata(slot) {
            let token=slot["token"].as_str().unwrap().to_owned();
            if !self.saved.as_ref().is_some_and(|saved|saved["token"]==token) {self.saved=Some(slot);}
            self.restore=Some((Some(token),Some(self.saved.as_ref().unwrap()["view"].clone())));
        } else {self.restore=Some((None,self.legacy.clone()));}
    }
    pub fn restored(&mut self)->Option<Value> {
        let (token,view)=self.restore.take()?;
        self.owner=Some(match token {Some(token)=>Owner::Saved(token),None=>Owner::Legacy});
        view
    }
    pub fn committed(&mut self,slot:&Value) {
        if let Some(slot)=metadata(slot) {self.owner=Some(Owner::Saved(slot["token"].as_str().unwrap().to_owned()));self.saved=Some(slot);self.legacy=None;}
    }
    pub fn observe(&mut self,active:&Value) {
        match &self.owner {
            Some(Owner::Saved(token))=>{if let Some(saved)=self.saved.as_mut().filter(|saved|saved["token"]==*token) {saved["view"]=active.clone();}},
            Some(Owner::Legacy)=>self.legacy=Some(active.clone()),
            None=>{},
        }
    }
    pub fn deleted(&mut self) {self.saved=None;self.legacy=None;self.owner=None;}
}
