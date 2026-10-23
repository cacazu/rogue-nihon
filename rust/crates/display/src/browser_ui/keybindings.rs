//! PC command bindings are preferences; they never alter C input semantics.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct KeyBinding {
    pub key: String,
    #[serde(default)] pub ctrl: bool,
    #[serde(default)] pub alt: bool,
    #[serde(default)] pub shift: bool,
}

use super::*;
impl KeyBinding {
    pub fn plain(key:&str)->Self {Self {key:key.into(),ctrl:false,alt:false,shift:false}}
    pub fn from_event(e:&Value)->Option<Self> {
        if b(&e["composing"]) || b(&e["metaKey"]) || n(&e["keyCode"])==229. {return None;}
        let source=s(&e["key"]);
        let key=if s(&e["code"]).starts_with("Numpad") && matches!(&s(&e["code"])[6..],"1"|"2"|"3"|"4"|"5"|"6"|"7"|"8"|"9") {s(&e["code"])} else {source};
        if key.is_empty() || matches!(key,"Shift"|"Control"|"Alt"|"Meta"|"AltGraph"|"Unidentified"|"Dead"|"Process"|"CapsLock"|"NumLock"|"ScrollLock") {return None;}
        if key.chars().count()!=1 && !matches!(key,"ArrowUp"|"ArrowDown"|"ArrowLeft"|"ArrowRight"|"Home"|"End"|"PageUp"|"PageDown"|"Enter"|"Tab"|"Backspace"|"Delete"|"Insert"|"Escape"|"Numpad1"|"Numpad2"|"Numpad3"|"Numpad4"|"Numpad5"|"Numpad6"|"Numpad7"|"Numpad8"|"Numpad9") && !(key.starts_with('F') && key[1..].parse::<u8>().is_ok_and(|v|(1..=24).contains(&v))) {return None;}
        let ctrl=b(&e["ctrlKey"]);let alt=b(&e["altKey"]);
        // Printable event.key already contains Shift's case or punctuation.
        // Ctrl letters have the same original ASCII control code in either case.
        let normalized=if ctrl && key.len()==1 && key.as_bytes()[0].is_ascii_alphabetic() {key.to_ascii_lowercase()} else {key.into()};
        Some(Self {key:normalized,ctrl,alt,shift:(ctrl || alt || key.chars().count()!=1) && b(&e["shiftKey"])})
    }
    pub fn valid(&self)->bool {
        self.key!="Escape" && Self::from_event(&json!({"key":self.key,"ctrlKey":self.ctrl,"altKey":self.alt,"shiftKey":self.shift})).as_ref()==Some(self)
    }
    pub fn label(&self)->String {
        let key=match self.key.as_str() {" "=>"Space",other=>other};
        format!("{}{}{}{key}",if self.ctrl {"Ctrl+"} else {""},if self.alt {"Alt+"} else {""},if self.shift {"Shift+"} else {""})
    }
}
fn direction_aliases(key:u32)->Vec<KeyBinding> {
    let (letter,arrow,pad)=match key {104=>("h","ArrowLeft","Numpad4"),106=>("j","ArrowDown","Numpad2"),107=>("k","ArrowUp","Numpad8"),108=>("l","ArrowRight","Numpad6"),121=>("y","Home","Numpad7"),117=>("u","PageUp","Numpad9"),98=>("b","End","Numpad1"),110=>("n","PageDown","Numpad3"),_=>return Vec::new()};
    [letter,arrow,pad].into_iter().map(KeyBinding::plain).collect()
}
pub(super) fn default_bindings()->BTreeMap<String,Vec<KeyBinding>> {
    use commands::CommandAction;
    commands::all_commands().into_iter().map(|c| {
        let keys=match c.action {
            CommandAction::Web(action)=>vec![KeyBinding::plain(web_command(action).key)],
            CommandAction::Context=>Vec::new(),
            CommandAction::Direction(key)=>direction_aliases(key),
            CommandAction::Key(key) if c.id.starts_with("game.run-")=>{
                let ctrl=key<32;let letter=if ctrl {key+96} else {key+32};
                let mut aliases=direction_aliases(letter);
                for alias in &mut aliases {if ctrl {alias.ctrl=true;}else if alias.key.len()==1 {alias.key=alias.key.to_ascii_uppercase();}else {alias.shift=true;}}
                aliases
            },
            CommandAction::Key(key) if key<32=>vec![KeyBinding {key:char::from_u32(key+96).unwrap().to_string(),ctrl:true,alt:false,shift:false}],
            CommandAction::Key(46)=>vec![KeyBinding::plain("."),KeyBinding::plain("Numpad5")],
            CommandAction::Key(key)=>vec![KeyBinding::plain(&char::from_u32(key).unwrap().to_string())],
        };(c.id.into(),keys)
    }).collect()
}
pub(super) fn sanitize_bindings(value:&Value)->BTreeMap<String,Vec<KeyBinding>> {
    let defaults=default_bindings();let mut out=defaults.clone();
    if let Some(values)=value.as_object() {
        for (id,value) in values {
            if !out.contains_key(id) {continue;}
            if let Ok(keys)=serde_json::from_value::<Vec<KeyBinding>>(value.clone()) {
                if keys.len()<=8 && keys.iter().all(KeyBinding::valid) {out.insert(id.clone(),keys);}
            }
        }
    }
    let mut used=std::collections::BTreeSet::new();
    if out.values().flatten().any(|key|!used.insert(key.clone())) {defaults} else {out}
}
#[derive(Clone)]
pub(super) struct BindingCapture {pub command:String,pub index:usize,pub candidate:Option<KeyBinding>,pub error:Option<String>}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn capture_preserves_case_ctrl_alt_and_physical_keypad_but_not_ime_or_modifier_only() {
        assert_eq!(KeyBinding::from_event(&json!({"key":"S","shiftKey":true})),Some(KeyBinding::plain("S")));
        let ctrl=KeyBinding::from_event(&json!({"key":"s","ctrlKey":true})).unwrap();
        assert_eq!(ctrl.label(),"Ctrl+s");
        let shifted=KeyBinding::from_event(&json!({"key":"S","ctrlKey":true,"shiftKey":true})).unwrap();
        assert_eq!(shifted.label(),"Ctrl+Shift+s");assert_ne!(shifted,ctrl);
        let alt=KeyBinding::from_event(&json!({"key":"s","altKey":true})).unwrap();
        assert_eq!(alt.label(),"Alt+s");assert_ne!(ctrl,alt);
        assert_eq!(KeyBinding::from_event(&json!({"key":"4","code":"Numpad4"})),Some(KeyBinding::plain("Numpad4")));
        for event in [json!({"key":"Control"}),json!({"key":"s","metaKey":true}),json!({"key":"あ","composing":true})] {assert!(KeyBinding::from_event(&event).is_none());}
    }
    #[test]
    fn preference_keeps_defaults_for_old_data_and_sanitizes_unknown_ids_and_duplicate_keys() {
        let defaults=default_bindings();assert!(!defaults.is_empty());
        assert_eq!(sanitize_bindings(&json!({})),defaults);
        let mut changed=serde_json::to_value(&defaults).unwrap();
        changed["game.search"]=json!([{"key":"s","ctrl":true}]);
        changed["unknown.command"]=json!([{"key":"x"}]);
        let restored=sanitize_bindings(&changed);
        assert_eq!(restored["game.search"],vec![KeyBinding {key:"s".into(),ctrl:true,alt:false,shift:false}]);
        assert!(!restored.contains_key("unknown.command"));
        changed["game.inventory"]=changed["game.search"].clone();
        assert_eq!(sanitize_bindings(&changed),defaults,"Invalid persisted collisions recover to usable defaults");
    }
}

impl BrowserUi {
    pub(super) fn open_binding_capture(&mut self,id:&str,index:usize) {
        if b(&self.view["coarse"]) || commands::command(id).is_none() {return;}
        self.binding_capture=Some(BindingCapture {command:id.into(),index,candidate:None,error:None});
        self.stop_hold();self.widgets.focus.clear();
    }
    fn binding_conflict(&self,id:&str,index:usize,key:&KeyBinding)->Option<String> {
        commands::all_commands().into_iter().find_map(|c|self.command_bindings(c.id).iter().enumerate().find_map(|(i,k)|
            (k==key && !(c.id==id && i==index)).then(||self.command_label(c.id))))
    }
    pub(super) fn binding_key(&mut self,event:&Value)->bool {
        if self.binding_capture.is_none() {return false;}
        if s(&event["key"])=="Escape" {self.binding_capture=None;return true;}
        if b(&event["repeat"]) {return true;}
        let Some(candidate)=KeyBinding::from_event(event).filter(KeyBinding::valid) else{return true;};
        if candidate==KeyBinding::plain("Enter") && self.binding_capture.as_ref().is_some_and(|c|c.candidate.is_some()) {
            self.confirm_binding();return true;
        }
        let capture=self.binding_capture.as_ref().unwrap();
        let conflict=self.binding_conflict(&capture.command,capture.index,&candidate);
        let error=conflict.map(|command|self.label("keybindings.conflict",&json!({"command":command})));
        let capture=self.binding_capture.as_mut().unwrap();capture.candidate=Some(candidate);capture.error=error;
        true
    }
    pub(super) fn confirm_binding(&mut self) {
        let Some(capture)=self.binding_capture.clone() else{return;};
        let Some(candidate)=capture.candidate else{return;};
        if self.binding_conflict(&capture.command,capture.index,&candidate).is_some() {return;}
        let mut bindings=self.command_bindings(&capture.command);
        if capture.index>bindings.len() {return;}
        if capture.index==bindings.len() {bindings.push(candidate);} else {bindings[capture.index]=candidate;}
        self.controls_preferences.bindings.insert(capture.command,bindings);
        self.binding_capture=None;
    }
}

impl BrowserUi {
    pub(super) fn draw_binding_capture(&mut self) {
        let Some(capture)=self.binding_capture.clone() else{return;};
        self.begin_choices("key-binding");self.regions.clear();self.map_rect=None;
        self.widgets.rect(Rect::new(0.,0.,self.width,self.height),"@overlay.strong");
        let width=(self.width-24.).min(520.);let inner=width-32.;
        let prompt=self.t("keybindings.prompt");let command=self.command_label(&capture.command);
        let prompt_h=self.wrap(&prompt,inner,20.).len() as f64*32.;
        let command_h=self.wrap(&command,inner,17.).len() as f64*27.2;
        let error_h=capture.error.as_ref().map_or(0.,|e|self.wrap(e,inner,17.).len() as f64*27.2+12.);
        let height=(prompt_h+command_h+error_h+170.).min(self.height-16.);
        let x=(self.width-width)/2.;let y=(self.height-height)/2.;
        self.widgets.box_rect(Rect::new(x,y,width,height),PANEL,Some(LINE),0.);
        self.text(&prompt,x+16.,y+16.,inner,20.,TEXT,true);
        self.text(&command,x+16.,y+16.+prompt_h,inner,17.,TEXT,false);
        let candidate=capture.candidate.as_ref().map(KeyBinding::label).unwrap_or_default();
        self.text(&candidate,x+16.,y+28.+prompt_h+command_h,inner,22.,ACCENT,true);
        if let Some(error)=capture.error.as_ref() {self.text(error,x+16.,y+70.+prompt_h+command_h,inner,17.,ERROR,false);}
        let bottom=y+height-64.;let half=(inner-12.)/2.;
        self.control("key-binding-cancel",&self.t("action.cancel"),Rect::new(x+16.,bottom,half,48.),json!({"kind":"binding-cancel"}),ControlStyle{size:17.,..Default::default()});
        self.control("key-binding-confirm",&self.t("keybindings.confirm"),Rect::new(x+28.+half,bottom,half,48.),json!({"kind":"binding-confirm"}),ControlStyle{size:17.,disabled:capture.candidate.is_none() || capture.error.is_some(),..Default::default()});
    }
    pub(super) fn bound_command_key(&mut self,event:&Value,effects:&mut Vec<Value>)->bool {
        if b(&self.view["coarse"]) || !self.command_ready() || !s(&event["native"]).is_empty()
            || self.commands_open || self.mobile_operations || self.history_open || self.status_open || self.mobile_repeat_open || !self.dropdown.is_empty() || b(&self.model["settingsOpen"]) {return false;}
        let Some(key)=KeyBinding::from_event(event) else{return false;};
        if let Some(c)=commands::all_commands().into_iter().find(|c|self.command_bindings(c.id).contains(&key)) {
            if !b(&event["repeat"]) || !matches!(c.action,commands::CommandAction::Web(_)) {
                let start=effects.len();self.activate_command(c.id,effects);
                if !matches!(c.action,commands::CommandAction::Web(_)) {
                    let unchanged=default_bindings().get(c.id).is_some_and(|keys|keys.contains(&key));
                    let original=unchanged.then(||super::interaction::game_key(event,"command")).flatten();
                    for effect in &mut effects[start..] {
                        if effect["kind"]=="send" {
                            if let Some(raw)=original {
                                if !matches!(c.id,"game.throw"|"game.zap") {effect["key"]=json!(self.movement_key(raw));}
                            } else if b(&event["repeat"]) {
                                if let Some(raw)=effect["key"].as_u64() {effect["key"]=json!(raw as u32 | rogue_contract::RG_EVENT_REPEAT);}
                            }
                            effect["redraw"]=json!(c.id=="game.stats");
                        }
                    }
                }
            }
            return true;
        }
        // Removed aliases cannot fall through and revive their C command.
        default_bindings().values().any(|keys|keys.contains(&key))
    }
}
