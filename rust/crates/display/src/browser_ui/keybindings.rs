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
            CommandAction::Direction(key)=>direction_aliases(key),
            CommandAction::Key(key) if c.id.starts_with("game.run-")=>{
                let ctrl=key<32;let letter=if ctrl {key+96} else {key+32};
                let mut aliases=direction_aliases(letter);
                for alias in &mut aliases {if ctrl {alias.ctrl=true;}else if alias.key.len()==1 {alias.key=alias.key.to_ascii_uppercase();}else {alias.shift=true;}}
                aliases
            },
            CommandAction::Key(key) if key<32=>vec![KeyBinding {key:char::from_u32(key+96).unwrap().to_string(),ctrl:true,alt:false,shift:false}],
            CommandAction::Key(118)=>vec![KeyBinding::plain("~")],
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
    let legacy_context=value.get("web.context").and_then(|value|serde_json::from_value::<Vec<KeyBinding>>(value.clone()).ok())
        .filter(|keys|keys.len()<=8 && keys.iter().all(KeyBinding::valid));
    // Old preferences had no exploration command and reserved v for Version.
    // Resolve only the newly introduced defaults; explicit aliases keep ownership.
    if value.get("web.explore").is_none() {
        let old_version=value.get("game.version").is_none()
            || out.get("game.version")==Some(&vec![KeyBinding::plain("v")]);
        if old_version {
            let occupied=out.iter().any(|(id,keys)|id!="game.version" && id!="web.explore" && keys.contains(&KeyBinding::plain("~")))
                || legacy_context.as_ref().is_some_and(|keys|keys.contains(&KeyBinding::plain("~")));
            out.insert("game.version".into(),if occupied {vec![]}else{vec![KeyBinding::plain("~")]});
        }
        if out.iter().any(|(id,keys)|id!="web.explore" && keys.contains(&KeyBinding::plain("v")))
            || legacy_context.as_ref().is_some_and(|keys|keys.contains(&KeyBinding::plain("v"))) {
            out.insert("web.explore".into(),vec![]);
        }
    }
    let mut used=std::collections::BTreeSet::new();
    if out.values().flatten().any(|key|!used.insert(key.clone())) {return defaults;}
    // A retired UI command is accepted only when loading older preferences.
    if let Some(keys)=legacy_context {
        let search=out.get_mut("game.search").expect("Search command");
        for key in keys {if search.len()==8 {break;} if used.insert(key.clone()) {search.push(key);}}
    }
    out
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
                                if !matches!(c.id,"game.throw"|"game.zap"|"game.version") {effect["key"]=json!(self.movement_key(raw));}
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


impl BrowserUi {
    /// Resolve only direction bindings while C owns a get_dir() wait.
    pub(super) fn direction_key(&mut self,event:&Value,effects:&mut Vec<Value>)->bool {
        if !self.pc_controls() || !b(&self.model["running"]) || !b(&self.model["frame"]["ui"]["movement_direction"])
            || b(&self.model["topOpen"]) || b(&self.model["starting"]) || b(&self.model["savePending"])
            || b(&self.model["returnAfterEnd"]) || !s(&event["native"]).is_empty()
            || self.commands_open || self.mobile_operations || self.history_open || self.status_open
            || self.mobile_repeat_open || !self.dropdown.is_empty() || b(&self.model["settingsOpen"]) {return false;}
        let Some(key)=KeyBinding::from_event(event) else{return false;};
        if key.key=="Escape" {return false;}
        let directions:Vec<_>=commands::all_commands().into_iter().filter_map(|c|match c.action {
            commands::CommandAction::Direction(direction)=>Some((c.id,direction)),_=>None,
        }).collect();
        let send=|effects:&mut Vec<Value>,direction:u32|effects.push(json!({"kind":"send","key":direction | if b(&event["repeat"]) {rogue_contract::RG_EVENT_REPEAT} else {0},"redraw":false}));
        // Exact configured aliases, including Ctrl/Alt and focus keys, take priority.
        if let Some((_,direction))=directions.iter().find(|(id,_)|self.command_bindings(id).contains(&key)) {
            send(effects,*direction);return true;
        }
        // Preserve original Shift/Ctrl direction variants only while their base
        // alias still belongs to that direction. Removed aliases cannot revive.
        if !key.alt {
            let mut base=key.clone();base.ctrl=false;base.shift=false;
            if base.key=="Backspace" {base.key="h".into();}
            else if base.key.len()==1 {base.key=base.key.to_ascii_lowercase();}
            let defaults=default_bindings();
            if let Some((id,direction))=directions.iter().find(|(id,_)|defaults.get(*id).is_some_and(|keys|keys.contains(&base))) {
                if self.command_bindings(id).contains(&base) {send(effects,*direction);}
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod direction_binding_tests {
    use super::*;
    fn measure(text:&str,size:f64,_bold:bool,_mono:bool)->TextSize {TextSize{width:text.len() as f64*size*0.55,ascent:0.,descent:size}}
    fn ui()->BrowserUi {
        let mut ui=BrowserUi::new(measure);ui.view=json!({"coarse":false});
        ui.model=json!({"running":true,"input":{"kind":"direction"},"frame":{"ui":{"movement_direction":true}}});ui
    }
    fn expect(ui:&mut BrowserUi,event:Value,key:u32) {
        let mut effects=Vec::new();assert!(ui.direction_key(&event,&mut effects),"{event}");
        assert_eq!(effects,vec![json!({"kind":"send","key":key,"redraw":false})]);
    }
    #[test]
    fn direction_bindings_send_raw_directions_for_every_alias_and_movement_mode() {
        for mode in 0..3 {
            let mut ui=ui();ui.mobile_movement=mode;
            for (letter,arrow,pad) in [('h',"ArrowLeft",4),('j',"ArrowDown",2),('k',"ArrowUp",8),('l',"ArrowRight",6),('y',"Home",7),('u',"PageUp",9),('b',"End",1),('n',"PageDown",3)] {
                for event in [json!({"key":letter.to_string()}),json!({"key":arrow}),json!({"key":pad.to_string(),"code":format!("Numpad{pad}")}),json!({"key":arrow,"code":format!("Numpad{pad}")})] {expect(&mut ui,event,letter as u32);}
                expect(&mut ui,json!({"key":letter.to_ascii_uppercase().to_string(),"shiftKey":true}),letter as u32);
                expect(&mut ui,json!({"key":letter.to_string(),"ctrlKey":true}),letter as u32);
                expect(&mut ui,json!({"key":arrow,"ctrlKey":true,"shiftKey":true}),letter as u32);
            }
            expect(&mut ui,json!({"key":"h","repeat":true}),104|rogue_contract::RG_EVENT_REPEAT);
        }
    }
    #[test]
    fn direction_bindings_honor_custom_modifiers_and_block_removed_default_aliases() {
        let mut ui=ui();
        ui.controls_preferences.bindings.insert("game.move-left".into(),vec![KeyBinding::plain("F2"),KeyBinding{key:"F3".into(),ctrl:true,alt:false,shift:false},KeyBinding{key:"F4".into(),ctrl:false,alt:true,shift:false}]);
        for event in [json!({"key":"F2"}),json!({"key":"F3","ctrlKey":true}),json!({"key":"F4","altKey":true})] {expect(&mut ui,event,104);}
        for event in [json!({"key":"h"}),json!({"key":"H","shiftKey":true}),json!({"key":"h","ctrlKey":true}),json!({"key":"ArrowLeft"}),json!({"key":"ArrowLeft","ctrlKey":true}),json!({"key":"4","code":"Numpad4"})] {
            let mut effects=Vec::new();assert!(ui.direction_key(&event,&mut effects));assert!(effects.is_empty(),"Removed alias must not fall through: {event}");
        }
        ui.controls_preferences.bindings.insert("game.move-left".into(),vec![KeyBinding::plain("Tab"),KeyBinding::plain("Enter"),KeyBinding::plain(" ")]);
        for key in ["Tab","Enter"," "] {expect(&mut ui,json!({"key":key}),104);}
        // A custom exact modifier binding wins before a legacy direction variant.
        ui.controls_preferences.bindings.insert("game.move-right".into(),vec![KeyBinding{key:"h".into(),ctrl:true,alt:false,shift:false}]);
        expect(&mut ui,json!({"key":"h","ctrlKey":true}),108);
    }
    #[test]
    fn direction_backspace_legacy_cannot_revive_a_removed_h_alias() {
        let mut ui=ui();expect(&mut ui,json!({"key":"Backspace"}),104);
        ui.controls_preferences.bindings.insert("game.move-left".into(),vec![KeyBinding::plain("F2")]);
        let mut effects=Vec::new();assert!(ui.direction_key(&json!({"key":"Backspace"}),&mut effects));assert!(effects.is_empty());
        ui.controls_preferences.bindings.insert("game.move-right".into(),vec![KeyBinding::plain("Backspace")]);
        expect(&mut ui,json!({"key":"Backspace"}),108);
    }
    #[test]
    fn direction_bindings_leave_cancellation_other_waits_and_background_commands_alone() {
        for event in [json!({"key":"Escape"}),json!({"key":"f"}),json!({"key":"t"}),json!({"key":"C"}),json!({"key":"O"}),json!({"key":"G"})] {
            let mut ui=ui();let mut effects=Vec::new();assert!(!ui.direction_key(&event,&mut effects));assert!(effects.is_empty());
        }
        for field in ["coarse","settingsOpen","commands","native","starting","savePending","topOpen","returnAfterEnd"] {
            let mut ui=ui();let mut event=json!({"key":"h"});
            match field {"coarse"=>ui.view["coarse"]=json!(true),"commands"=>ui.commands_open=true,"native"=>event["native"]=json!("prompt-text"),other=>ui.model[other]=json!(true)}
            let mut effects=Vec::new();assert!(!ui.direction_key(&event,&mut effects),"{field}");assert!(effects.is_empty());
        }
        let mut ui=ui();ui.model["frame"]["ui"]["movement_direction"]=json!(false);let mut effects=Vec::new();assert!(!ui.direction_key(&json!({"key":"h"}),&mut effects));assert!(effects.is_empty());
    }
}
