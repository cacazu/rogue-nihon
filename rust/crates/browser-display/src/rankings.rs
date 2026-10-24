//! Browser-local personal scores. C owns every awarded point and ending reason.
use serde_json::Value;
#[derive(Clone,Debug,PartialEq,Eq)]
pub(crate) struct Score {
    pub adventure:String,
    pub score:i32,
    pub flags:u8,
    pub name:String,
    pub level:i32,
    pub monster:u8,
}
impl Score {
    pub fn value(&self)->Value {serde_json::json!({"adventure":self.adventure,"score":self.score,"flags":self.flags,"name":self.name,"level":self.level,"monster":self.monster})}
    fn stored(value:&Value)->Option<Self> {
        if value.as_object()?.len()!=6 {return None;}
        let mut source=value.clone();source["eligible"]=Value::Bool(true);
        Self::from_result(&source,value["adventure"].as_str()?)
    }
    pub fn valid(&self)->bool {
        valid_id(&self.adventure) && self.score>=0 && self.flags<=3 && self.level>0
            && crate::policies::valid_text(&self.name,49,false)
    }
    pub fn from_result(value:&Value,adventure:&str)->Option<Self> {
        if value["eligible"]!=true {return None;}
        let result=Self {adventure:adventure.into(),score:i32::try_from(value["score"].as_i64()?).ok()?,
            flags:u8::try_from(value["flags"].as_u64()?).ok()?,name:value["name"].as_str()?.into(),
            level:i32::try_from(value["level"].as_i64()?).ok()?,monster:u8::try_from(value["monster"].as_u64()?).ok()?};
        result.valid().then_some(result)
    }
}
pub(crate) fn valid_id(id:&str)->bool {!id.is_empty() && id.len()<=160 && !id.chars().any(char::is_control)}
#[derive(Clone,Debug,PartialEq,Eq)]
pub(crate) struct Book {pub version:u32,pub entries:Vec<Score>}
impl Default for Book {fn default()->Self {Self{version:1,entries:Vec::new()}}}
impl Book {
    pub fn parse(raw:Option<&str>)->Result<Self,String> {
        let Some(raw)=raw else {return Ok(Self::default());};
        let value:Value=serde_json::from_str(raw).map_err(|_|"Invalid rankings".to_string())?;
        if value.as_object().is_none_or(|o|o.len()!=2) || value["version"]!=1 {return Err("Invalid rankings".into());}
        let rows=value["entries"].as_array().ok_or("Invalid rankings")?;
        let entries=rows.iter().map(Score::stored).collect::<Option<Vec<_>>>().ok_or("Invalid rankings")?;
        let book=Self{version:1,entries};
        let mut ids=std::collections::BTreeSet::new();
        if book.version!=1 || book.entries.len()>10 || book.entries.iter().any(|e|!e.valid() || !ids.insert(e.adventure.clone()))
            || book.entries.windows(2).any(|p|p[0].score<p[1].score) {return Err("Invalid rankings".into());}
        Ok(book)
    }
    pub fn value(&self)->Value {serde_json::json!({"version":1,"entries":self.entries.iter().map(Score::value).collect::<Vec<_>>()})}
    pub fn merge(&self,score:Score)->Result<Self,String> {
        if !score.valid() {return Err("Invalid score".into());}
        if self.entries.iter().any(|entry|entry.adventure==score.adventure) {return Ok(self.clone());}
        let mut next=self.clone();next.entries.push(score);next.entries.sort_by(|a,b|b.score.cmp(&a.score));next.entries.truncate(10);Ok(next)
    }
}
pub(crate) fn restored_id(sidecar:&Value)->Option<String> {
    if sidecar["version"]==1 {
        if let Some(id)=sidecar["adventure"].as_str().filter(|id|valid_id(id)) {return Some(id.into());}
        if let Some(token)=sidecar["token"].as_str().filter(|id|valid_id(id)) {
            let id=format!("legacy:{token}");if valid_id(&id) {return Some(id);}
        }
    }
    sidecar["legacyDigest"].as_str().filter(|id|id.len()==64 && id.bytes().all(|c|c.is_ascii_hexdigit())).map(|id|format!("legacy:{id}"))
}
#[cfg(test)]
mod tests {
 use super::*;
 fn score(id:&str,points:i32)->Score {Score{adventure:id.into(),score:points,flags:1,name:"Player".into(),level:1,monster:0}}
 #[test] fn rankings_keep_zero_stable_ties_and_only_ten_adventures() {
    let mut book=Book::default();for (id,n) in [("zero",0),("early",20),("late",20)] {book=book.merge(score(id,n)).unwrap();}
    assert_eq!(book.entries.iter().map(|s|s.adventure.as_str()).collect::<Vec<_>>(),vec!["early","late","zero"]);
    for n in 0..20 {book=book.merge(score(&format!("game{n}"),n)).unwrap();}
    assert_eq!(book.entries.len(),10);assert_eq!(book.entries[0].adventure,"early");assert_eq!(book.entries[1].adventure,"late");
    let original=book.clone();assert_eq!(book.merge(score("early",999)).unwrap(),original,"An already finalized adventure cannot be counted twice or rewritten");
 }
 #[test] fn rankings_reject_invalid_or_future_storage_without_overwriting_it() {
    assert_eq!(Book::parse(None).unwrap(),Book::default());assert!(Book::parse(Some(r#"{"version":2,"entries":[]}"#)).is_err());
    assert!(Book::parse(Some("broken")).is_err());let mut record=score("A",1);record.name="bad\nname".into();assert!(Book::default().merge(record).is_err());
    let raw=serde_json::json!({"version":1,"entries":[score("A",2).value(),score("A",1).value()]}).to_string();assert!(Book::parse(Some(&raw)).is_err());
 }
 #[test] fn rankings_use_c_result_eligibility_and_stable_saved_adventure_identity() {
    let base=serde_json::json!({"score":0,"flags":1,"name":"Player","level":1,"monster":0,"eligible":true});assert_eq!(Score::from_result(&base,"A").unwrap().score,0);
    for change in [serde_json::json!({"eligible":false}),serde_json::json!({"flags":-1}),serde_json::json!({"score":-1})] {let mut v=base.clone();for (k,value) in change.as_object().unwrap(){v[k]=value.clone();}assert!(Score::from_result(&v,"A").is_none());}
    assert_eq!(restored_id(&serde_json::json!({"version":1,"adventure":"same-A","token":"new-save-token"})).as_deref(),Some("same-A"));
    assert_eq!(restored_id(&serde_json::json!({"version":1,"token":"old-save-token"})).as_deref(),Some("legacy:old-save-token"));
    let digest="a".repeat(64);assert_eq!(restored_id(&serde_json::json!({"legacyDigest":digest})),Some(format!("legacy:{digest}")));
 }
}
