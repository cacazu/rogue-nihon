//! A configuration transaction owns all input until it is committed or discarded.
use super::*;
use super::control_preferences::{Column,ControlForm,ControlProfile};

#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub(super) enum EditMode { Placement, Assignment }
pub(super) struct ControlEditor {
    pub mode:EditMode,
    pub form:ControlForm,
    pub draft:ControlProfile,
    pub selected:Option<usize>,
    pub drag:Option<EditorDrag>,
}
pub(super) struct EditorDrag {pub id:i64,pub button:usize,pub x:f64,pub y:f64,pub last_y:f64,pub moved:bool}
#[derive(Clone)]
pub(super) struct DockTarget {pub button:usize,pub rect:Rect}

impl BrowserUi {
    pub(super) fn open_controls_editor(&mut self,mode:EditMode) {
        let form=self.control_form();
        self.stop_hold();self.gestures=gestures::Gestures::default();self.drag=None;
        self.controls_editor=Some(ControlEditor{mode,form,draft:self.controls_preferences.profile(form).clone(),selected:None,drag:None});
        self.dropdown.clear();
    }
    pub(super) fn editor_activate(&mut self,control:&Control,effects:&mut Vec<Value>)->bool {
        match control.id.as_str() {
            "controls-placement"=>{self.open_controls_editor(EditMode::Placement);return true;},
            "controls-assignment"=>{self.open_controls_editor(EditMode::Assignment);return true;},
            _=>{}
        }
        if self.controls_editor.is_none() {return false;}
        match s(&control.action["kind"]) {
            "editor-commit"=>{
                let editor=self.controls_editor.take().unwrap();
                *self.controls_preferences.profile_mut(editor.form)=editor.draft;
                effects.push(json!({"kind":"invoke","id":"settings-close"}));
            },
            "editor-cancel"=>{self.controls_editor=None;effects.push(json!({"kind":"invoke","id":"settings-close"}));},
            "editor-default"=>{
                let editor=self.controls_editor.as_mut().unwrap();
                let defaults=ControlProfile::defaults(editor.form);
                if editor.mode==EditMode::Placement {editor.draft.columns=defaults.columns;}
                else {editor.draft.assignments=defaults.assignments;}
                editor.selected=None;
            },
            "editor-select"=>self.controls_editor.as_mut().unwrap().selected=control.action["button"].as_u64().map(|n|n as usize),
            "editor-command"=>{
                let id=s(&control.action["command"]).to_string();
                let editor=self.controls_editor.as_mut().unwrap();
                if let Some(button)=editor.selected.take() {editor.draft.assignments[button]=id;}
            },
            "editor-picker-close"=>{self.controls_editor.as_mut().unwrap().selected=None;},
            _=>{}
        }
        true
    }
    pub(super) fn controls_editor_event(&mut self,event:&Value,effects:&mut Vec<Value>)->Option<bool> {
        if self.controls_editor.is_none() {return None;}
        let x=n(&event["x"]);let y=n(&event["y"]);let id=event["id"].as_i64().unwrap_or(0);
        let hit=self.hit(x,y);
        match s(&event["type"]) {
            "key"=>{
                if event["key"]=="Escape" {
                    if self.controls_editor.as_ref().unwrap().selected.is_some() {self.controls_editor.as_mut().unwrap().selected=None;}
                    else {self.controls_editor=None;effects.push(json!({"kind":"invoke","id":"settings-close"}));}
                } else if event["key"]=="Enter" {
                    if let Some(control)=self.widgets.controls.iter().find(|c|c.id==self.widgets.focus).cloned() {self.editor_activate(&control,effects);}
                } else if event["key"]=="Tab" {
                    let controls=&self.widgets.controls;
                    if !controls.is_empty() {
                        let current=controls.iter().position(|c|c.id==self.widgets.focus).map(|n|n as i64).unwrap_or(-1);
                        let next=(current+if b(&event["shiftKey"]) {-1}else{1}).rem_euclid(controls.len() as i64) as usize;
                        self.widgets.focus=controls[next].id.clone();
                    }
                } else if matches!(s(&event["key"]),"ArrowDown"|"PageDown"|"ArrowUp"|"PageUp") {
                    let delta=if matches!(s(&event["key"]),"ArrowUp"|"PageUp") {-80.}else{80.};
                    if let Some(region)=self.regions.get("control-picker") {let max=region.max;let value=self.scrolls.entry("control-picker".into()).or_default();*value=clamp(*value+delta,0.,max);}
                }
            },
            "down"=>{
                if event["primary"]==false || n(&event["button"])!=0. || self.controls_editor.as_ref().unwrap().drag.is_some() {return Some(true);}
                let target=self.dock_targets.iter().find(|target|target.rect.contains(x,y)).map(|t|t.button);
                if let Some(c)=hit {self.widgets.pressed=c.id;}
                let button=if self.controls_editor.as_ref().unwrap().selected.is_some() {usize::MAX-1}else{target.unwrap_or(usize::MAX-1)};
                self.controls_editor.as_mut().unwrap().drag=Some(EditorDrag{id,button,x,y,last_y:y,moved:false});
                effects.push(json!({"kind":"capture","id":id}));
                effects.push(json!({"kind":"canvas-focus"}));
            },
            "move"=>{
                let max=self.regions.get("control-picker").map(|r|r.max);
                if let Some(drag)=self.controls_editor.as_mut().unwrap().drag.as_mut().filter(|d|d.id==id) {
                    drag.moved|=(x-drag.x).hypot(y-drag.y)>6.;
                    if let Some(max)=max {
                        let scroll=self.scrolls.entry("control-picker".into()).or_default();
                        *scroll=clamp(*scroll+drag.last_y-y,0.,max);
                    }
                    drag.last_y=y;
                }
            },
            "up"=>{
                if !self.controls_editor.as_ref().unwrap().drag.as_ref().is_some_and(|d|d.id==id) {return Some(true);}
                let drag=self.controls_editor.as_mut().unwrap().drag.take();
                if let Some(drag)=drag.filter(|d|d.id==id) {
                    if b(&event["captured"]) {
                        if drag.button==usize::MAX-1 {
                            if !drag.moved {
                                if let Some(c)=hit.filter(|c|c.id==self.widgets.pressed) {self.editor_activate(&c,effects);}
                            }
                        } else if drag.moved {
                            if let Some(target)=self.dock_targets.iter().find(|target|target.rect.contains(x,y)) {
                                let editor=self.controls_editor.as_mut().unwrap();
                                if editor.mode==EditMode::Placement || drag.button==usize::MAX || target.button==usize::MAX {editor.draft.swap(drag.button,target.button);}
                            }
                        } else if drag.button!=usize::MAX && self.controls_editor.as_ref().unwrap().mode==EditMode::Assignment {
                            self.controls_editor.as_mut().unwrap().selected=Some(drag.button);
                            self.scrolls.insert("control-picker".into(),0.);
                        }
                    }
                }
                self.widgets.pressed.clear();
                effects.push(json!({"kind":"release","id":id}));
            },
            "cancel"=>{
                if event["id"].is_null() || self.controls_editor.as_ref().unwrap().drag.as_ref().is_some_and(|d|d.id==id) {
                    if let Some(drag)=self.controls_editor.as_mut().unwrap().drag.take() {
                        effects.push(json!({"kind":"release","id":drag.id}));
                    }
                    self.widgets.pressed.clear();
                }
            },
            "wheel"=>{
                if let Some(region)=self.regions.get("control-picker") {let max=region.max;let value=self.scrolls.entry("control-picker".into()).or_default();*value=clamp(*value+n(&event["dy"]),0.,max);}
            },
            _=>{}
        }
        Some(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn measure(text:&str,size:f64,_:bool,_:bool)->TextSize {TextSize{width:text.chars().count() as f64*size/2.,ascent:0.,descent:size}}
    #[test]
    fn editor_shows_game_and_owns_input_until_commit() {
        let mut ui=BrowserUi::new(measure);
        let model=json!({"language":"ja","running":true,"settingsOpen":true,"input":{"kind":"command"},"frame":{"width":80,"height":24,"player":{"x":1,"y":1},"ui":{}}});
        ui.render(model.clone(),json!({"width":1400,"height":900}));
        ui.open_controls_editor(EditMode::Placement);
        let out=ui.render(model,json!({"width":1400,"height":900}));
        assert_eq!(out["diagnostics"]["scope"],"controls-editor");
        assert!(array(&out["diagnostics"]["controls"]).iter().any(|c|c["id"]=="controls-commit"));
        let before=ui.control_preferences();
        let result=ui.event(json!({"type":"key","key":"s"}));
        assert_eq!(result["consumed"],true);
        assert!(array(&result["effects"]).is_empty());
        assert_eq!(ui.control_preferences(),before);
    }
    fn assigned_ui(phone:bool)->(BrowserUi,Value,Value) {
        let mut ui=BrowserUi::new(measure);
        let model=json!({"language":"ja","running":true,"input":{"kind":"command"},"frame":{"width":80,"height":24,"player":{"x":1,"y":1},"ui":{}}});
        let view=json!({"width":if phone {390.}else{1400.},"height":900.,"coarse":phone});
        let form=if phone {ControlForm::Phone}else{ControlForm::Desktop};
        ui.controls_preferences.profile_mut(form).assignments[1]="web.repeat".into();
        ui.controls_preferences.profile_mut(form).assignments[2]="web.movement".into();
        ui.controls_preferences.profile_mut(form).assignments[if phone {5}else{8}]="game.search".into();
        ui.render(model.clone(),view.clone());(ui,model,view)
    }
    #[test]
    fn assigned_repeat_keeps_its_caption_and_short_tap_action_in_either_form() {
        for phone in [false,true] {
            let (mut ui,_,_)=assigned_ui(phone);
            let repeat=ui.widgets.controls.iter().find(|c|c.id==if phone {"touch-action-action.inventory"}else{"pc-inventory"}).unwrap().clone();
            let text:Vec<_>=ui.widgets.text_runs.iter().filter(|run|repeat.rect.contains(n(&run["x"]),n(&run["y"]))).map(|run|s(&run["text"]).to_string()).collect();
            assert_eq!(text,if phone {vec!["繰返し","長押し"]}else{vec!["E) 繰返し","A) 回数1"]});
            let mut effects=Vec::new();ui.activate(&repeat,&Value::Null,&mut effects);
            assert_eq!(effects,vec![json!({"kind":"send","keys":[97]})]);
        }
    }
    #[test]
    fn assigned_original_repeat_slot_no_longer_owns_the_repeat_gesture() {
        for phone in [false,true] {
            let (mut ui,_,_)=assigned_ui(phone);
            let c=ui.widgets.controls.iter().find(|c|c.id=="touch-again").unwrap().clone();
            let mut effects=Vec::new();ui.start_hold(&c,9,&mut effects);
            assert!(effects.is_empty(),"A reassigned Search does not start a repeat timer");
        }
    }
    #[test]
    fn assigned_repeat_hold_opens_count_without_sending_a_repeat() {
        for phone in [false,true] {
            let (mut ui,_,_)=assigned_ui(phone);
            let c=ui.widgets.controls.iter().find(|c|c.id==if phone {"touch-action-action.inventory"}else{"pc-inventory"}).unwrap().clone();
            let x=c.rect.x+c.rect.w/2.;let y=c.rect.y+c.rect.h/2.;
            ui.event(json!({"type":"down","id":9,"x":x,"y":y,"button":0,"primary":true,"pointerType":"mouse"}));
            let out=ui.event(json!({"type":"hold-tick","id":9}));
            assert!(ui.mobile_repeat_open,"Assigned Repeat supports its count gesture");
            assert!(!array(&out["effects"]).iter().any(|e|e["kind"]=="send"));
            let out=ui.event(json!({"type":"up","id":9,"x":x,"y":y,"captured":true,"pointerType":"mouse"}));
            assert!(!array(&out["effects"]).iter().any(|e|e["kind"]=="send"));
        }
    }
    #[test]
    fn assigned_movement_switches_and_keeps_the_current_mode_caption() {
        for phone in [false,true] {
            let (mut ui,model,view)=assigned_ui(phone);
            let id=if phone {"touch-search"}else{"pc-wield"};
            let c=ui.widgets.controls.iter().find(|c|c.id==id).unwrap().clone();
            let mut effects=Vec::new();ui.activate(&c,&Value::Null,&mut effects);
            assert_eq!(ui.mobile_movement,1);assert!(effects.is_empty());
            ui.render(model,view);
            let c=ui.widgets.controls.iter().find(|c|c.id==id).unwrap();
            assert!(c.label.contains(&ui.t("mobile.run")));
        }
    }
    #[test]
    fn desktop_pad_keeps_arrows_and_dynamic_hints_inside_each_cell() {
        for width in [390.,1400.] {
        let mut ui=BrowserUi::new(measure);
        let directions=json!([{"key":121,"text":"↖","row":0,"column":0},{"key":107,"text":"↑","row":0,"column":1},{"key":117,"text":"↗","row":0,"column":2},{"key":104,"text":"←","row":1,"column":0},{"key":46,"text":"·","row":1,"column":1},{"key":108,"text":"→","row":1,"column":2},{"key":98,"text":"↙","row":2,"column":0},{"key":106,"text":"↓","row":2,"column":1},{"key":110,"text":"↘","row":2,"column":2}]);
        let model=json!({"language":"ja","running":true,"input":{"kind":"command"},"frame":{"width":80,"height":24,"player":{"x":1,"y":1},"ui":{"map_controls":{"directions":directions}}}});
        ui.controls_preferences.bindings.insert("game.move-left".into(),vec![keybindings::KeyBinding {key:"ArrowLeft".into(),ctrl:true,alt:true,shift:true}]);
        ui.render(model,json!({"width":width,"height":900}));
        for (key,arrow) in [(121,"↖"),(107,"↑"),(117,"↗"),(104,"←"),(46,"待機"),(108,"→"),(98,"↙"),(106,"↓"),(110,"↘")] {
            let c=ui.widgets.controls.iter().find(|c|c.id==format!("touch-{}",char::from_u32(key).unwrap())).unwrap();
            let hint=ui.command_shortcut(commands::key_id(key).unwrap()).unwrap();
            for (text,max_size) in [(arrow,24.),(hint.as_str(),12.)] {
                let run=ui.widgets.text_runs.iter().find(|run|s(&run["text"])==text).unwrap_or_else(||panic!("Missing separate pad caption {text}"));
                let size=n(&run["size"]);let ink=measure(text,size,false,false);
                assert!(size<=max_size);
                assert!(n(&run["x"])>=c.rect.x && n(&run["x"])+ink.width<=c.rect.x+c.rect.w+0.001,"{text} horizontal bounds");
                assert!(n(&run["y"])-ink.ascent>=c.rect.y && n(&run["y"])+ink.descent<=c.rect.y+c.rect.h,"{text} vertical bounds");
            }
        }
        }
    }
    #[test]
    fn editor_keeps_short_movement_and_two_line_repeat_captions() {
        for phone in [false,true] {
            let mut ui=BrowserUi::new(measure);
            let model=json!({"language":"ja","running":true,"settingsOpen":true,"input":{"kind":"command"},"frame":{"width":80,"height":24,"player":{"x":1,"y":1},"ui":{}}});
            let view=json!({"width":if phone {390.}else{1400.},"height":900.,"coarse":phone});
            ui.render(model.clone(),view.clone());ui.open_controls_editor(EditMode::Assignment);
            ui.render(model,view);
            assert_eq!(ui.widgets.controls.iter().find(|c|c.id=="mobile-movement").unwrap().label,"歩く");
            let repeat=ui.widgets.controls.iter().find(|c|c.id=="touch-again").unwrap();
            let runs:Vec<_>=ui.widgets.text_runs.iter().filter(|run|repeat.rect.contains(n(&run["x"]),n(&run["y"]))).map(|run|s(&run["text"])).collect();
            assert_eq!(runs,if phone {vec!["繰返し","長押し"]}else{vec!["E) 繰返し","A) 回数1"]});
        }
    }
    #[test]
    fn phone_default_keeps_the_short_list_button_label() {
        let mut ui=BrowserUi::new(measure);
        let model=json!({"language":"ja","running":true,"input":{"kind":"command"},"frame":{"width":80,"height":24,"player":{"x":1,"y":1},"ui":{}}});
        ui.render(model,json!({"width":390,"height":844,"coarse":true}));
        let list=ui.widgets.controls.iter().find(|c|c.id=="mobile-operations").unwrap();
        assert_eq!(list.label,ui.t("action.help"));
    }
    #[test]
    fn custom_movement_binding_updates_the_visible_caption() {
        let mut ui=BrowserUi::new(measure);
        let model=json!({"language":"ja","running":true,"input":{"kind":"command"},"frame":{"width":80,"height":24,"player":{"x":1,"y":1},"ui":{}}});
        ui.controls_preferences.bindings.insert("web.movement".into(),vec![keybindings::KeyBinding {key:"g".into(),ctrl:true,alt:false,shift:false}]);
        let out=ui.render(model,json!({"width":1400,"height":900}));
        let movement=ui.widgets.controls.iter().find(|c|c.id=="mobile-movement").unwrap();
        assert_eq!(movement.shortcut.as_deref(),Some("Ctrl+g"));
        assert!(array(&out["commands"]).iter().any(|c|c["op"]=="text" && s(&c["text"]).starts_with("Ctrl+g)")));
        assert!(!array(&out["commands"]).iter().any(|c|c["op"]=="text" && s(&c["text"]).starts_with("g)")));
    }
    #[test]
    fn unrelated_pointer_release_does_not_drop_an_editor_drag() {
        let mut ui=BrowserUi::new(measure);
        ui.width=1400.;ui.open_controls_editor(EditMode::Placement);
        ui.controls_editor.as_mut().unwrap().drag=Some(EditorDrag{id:1,button:0,x:10.,y:10.,last_y:10.,moved:false});
        let mut effects=Vec::new();
        ui.controls_editor_event(&json!({"type":"up","id":2,"captured":true}),&mut effects);
        assert_eq!(ui.controls_editor.as_ref().unwrap().drag.as_ref().map(|d|d.id),Some(1));
        ui.controls_editor_event(&json!({"type":"cancel","id":2}),&mut effects);
        assert_eq!(ui.controls_editor.as_ref().unwrap().drag.as_ref().map(|d|d.id),Some(1));
        effects.clear();
        ui.controls_editor_event(&json!({"type":"cancel"}),&mut effects);
        assert!(ui.controls_editor.as_ref().unwrap().drag.is_none());
        assert!(effects.contains(&json!({"kind":"release","id":1})),"Global cancellation releases the owned capture");
    }
    #[test]
    fn defaults_and_cancel_are_drafts_and_commit_preserves_other_form() {
        let mut ui=BrowserUi::new(measure);
        ui.width=1400.;let before=ui.control_preferences();
        ui.open_controls_editor(EditMode::Placement);
        ui.controls_editor.as_mut().unwrap().draft.swap(0,11);
        assert_eq!(ui.control_preferences(),before);
        ui.controls_editor=None;
        assert_eq!(ui.control_preferences(),before);
        ui.open_controls_editor(EditMode::Assignment);
        ui.controls_editor.as_mut().unwrap().draft.assignments[0]="game.search".into();
        let editor=ui.controls_editor.take().unwrap();
        *ui.controls_preferences.profile_mut(editor.form)=editor.draft;
        assert_ne!(ui.control_preferences(),before);
        assert_eq!(ui.control_preferences()["phone"],before["phone"]);
    }
}

impl BrowserUi {
    pub(super) fn draw_configurable_dock(&mut self,dock:Rect,form:ControlForm) {
        let profile=self.dock_profile(form);
        let phone=form==ControlForm::Phone;
        let editing=self.controls_editor.is_some();
        let pad_width=if phone {168.}else{156.};
        let button_columns=if phone {2.}else{4.};
        let button_width=if phone {(self.width-212.)/2.}else{((dock.w-200.).min(880.)-24.)/4.};
        let total=pad_width+if phone {12.}else{28.}+button_columns*button_width+(button_columns-1.)*8.;
        let left=(self.width-total)/2.;
        let top=if phone {dock.y+8.}else{dock.y+66.};
        let button_height=if phone {if self.width<360. {76.}else{52.}}else{48.};
        let step=button_height+6.;
        let pad_y=if phone {dock.y+(dock.h-pad_width)/2.}else{dock.y+dock.h-164.};
        let mirror=!self.left_handed();
        let screen_width=self.width;
        let place=|r:Rect|if mirror {Rect::new(screen_width-r.x-r.w,r.y,r.w,r.h)}else{r};
        let mut x=left;
        let direction=b(&self.model["frame"]["ui"]["movement_direction"]);
        let mut cancel_drawn=false;
        self.widgets.rect(dock,BG);
        for (column_index,column) in profile.columns.iter().enumerate() {
            match column {
                Column::Pad=>{
                    let rect=place(Rect::new(x,pad_y,pad_width,pad_width));
                    self.dock_targets.push(DockTarget{button:usize::MAX,rect});
                    if editing {
                        self.control("editor-pad","",rect,json!({"kind":"editor-pad"}),ControlStyle{custom:true,..Default::default()});
                    }
                    let frame_directions=self.model["frame"]["ui"]["map_controls"]["directions"].clone();
                    let directions=if self.pc_controls() && direction && !editing {Vec::new()}else if editing {
                        vec![(121,"↖",0,0),(107,"↑",0,1),(117,"↗",0,2),(104,"←",1,0),(46,"·",1,1),(108,"→",1,2),(98,"↙",2,0),(106,"↓",2,1),(110,"↘",2,2)]
                    } else {
                        array(&frame_directions).iter().map(|a|(n(&a["key"]) as u32,s(&a["text"]),n(&a["row"]) as i32,n(&a["column"]) as i32)).collect()
                    };
                    let cell=if phone {52.}else{48.};let spacing=if phone {58.}else{54.};
                    for (key,text,row,col) in directions {
                        let emitted=self.movement_key(key);
                        let r=Rect::new(rect.x+col as f64*spacing,rect.y+row as f64*spacing,cell,cell);
                        let label=if key==46 {self.t("mobile.wait")}else{text.into()};
                        self.control(&format!("touch-{}",char::from_u32(key).unwrap()),&label,r,
                            if editing {json!({"kind":"editor-pad"})}else{json!({"kind":"send","key":emitted})},
                            ControlStyle{size:if key==46 {17.}else{26.},custom:self.pc_controls() && !editing,key:Some(json!(emitted)),throw_direction:b(&self.model["frame"]["ui"]["movement_direction"]),shortcut:if editing {None}else{commands::key_id(key).and_then(|id|self.command_shortcut(id))},..Default::default()});
                        if self.pc_controls() && !editing {
                            self.widgets.single_line(&label,Rect::new(r.x,r.y+2.,r.w,27.),
                                LineStyle{text:TextStyle::new(if key==46 {15.}else{24.},TEXT,false),center:true,ellipsis:false},self.measure);
                            let hint=commands::key_id(key).and_then(|id|self.command_shortcut(id)).unwrap_or_default();
                            self.widgets.fitted_line(&hint,Rect::new(r.x+1.,r.y+30.,r.w-2.,15.),
                                LineStyle{text:TextStyle::new(12.,TEXT,false),center:true,ellipsis:false},self.measure);
                        }
                    }
                    x+=pad_width;
                },
                Column::Buttons(buttons)=>{
                    for (row,button) in buttons.iter().enumerate() {
                        let r=place(Rect::new(x,top+row as f64*step,button_width,button_height));
                        let command=&profile.assignments[*button];
                        self.dock_targets.push(DockTarget{button:*button,rect:r});
                        let id=match form {
                            ControlForm::Desktop=>["mobile-movement","pc-inventory","pc-wield","pc-armor","pc-search","pc-throw","pc-zap","pc-read","touch-again","mobile-full-map","pc-eat","pc-quaff"][*button],
                            ControlForm::Phone=>["mobile-movement","touch-action-action.inventory","touch-search","mobile-full-map","mobile-operations","touch-again"][*button],
                        };
                        if !editing && direction && !self.pc_controls() {
                            if !cancel_drawn {
                                self.control("touch-action-action.cancel",&self.t("action.cancel_short"),r,json!({"kind":"send","key":27}),ControlStyle{size:17.,key:Some(json!(27)),..Default::default()});
                                cancel_drawn=true;
                            }
                            continue;
                        }
                        if editing {
                            let action=json!({"kind":"editor-select","button":button});
                            if command=="web.repeat" {self.repeat_control(id,r,action,true);}
                            else {self.control(id,&self.dock_command_label(command),r,action,ControlStyle{size:17.,..Default::default()});}
                        } else if command=="web.movement" {self.movement_control(id,r);}
                        else if command=="web.repeat" {self.repeat_control(id,r,json!({"kind":"command","id":"web.repeat"}),false);}
                        else {
                            self.dock_command(command,id,r);
                        }
                    }
                    x+=button_width;
                }
            }
            if column_index+1<profile.columns.len() {
                x+=if matches!(column,Column::Pad)||matches!(profile.columns[column_index+1],Column::Pad) {if phone {12.}else{28.}}else{8.};
            }
        }
    }
    pub(super) fn draw_controls_editor(&mut self) {
        self.begin_choices("controls-editor");
        self.regions.clear();
        self.widgets.rect(Rect::new(0.,0.,self.width,self.height),"@overlay.soft");
        let form=self.controls_editor.as_ref().unwrap().form;
        let h=if form==ControlForm::Desktop {230.}else if self.width<360. {256.}else{184.};
        self.dock_targets.clear();
        self.draw_configurable_dock(Rect::new(0.,self.height-h,self.width,h),form);
        let w=(self.width-24.).min(420.);
        let button_width=(w-16.)/3.;
        let y=((self.height-h)/2.-24.).max(8.);
        for (index,(id,label,kind)) in [("controls-commit","controls.confirm","editor-commit"),("controls-cancel","controls.cancel","editor-cancel"),("controls-default","controls.default","editor-default")].into_iter().enumerate() {
            self.control(id,&self.t(label),Rect::new((self.width-w)/2.+index as f64*(button_width+8.),y,button_width,48.),json!({"kind":kind}),ControlStyle{size:17.,..Default::default()});
        }
        if self.controls_editor.as_ref().unwrap().selected.is_some() {self.draw_command_picker();}
    }
    fn draw_command_picker(&mut self) {
        self.begin_choices("control-picker");self.dock_targets.clear();
        self.widgets.rect(Rect::new(0.,0.,self.width,self.height),"@overlay.strong");
        let commands=commands::all_commands();
        let total=commands.len() as f64*56.;
        let (panel,viewport)=self.sheet_layout((self.width-16.).min(540.),total);
        self.widgets.box_rect(panel,PANEL,Some(LINE),0.);
        self.text(&self.t("controls.choose"),panel.x+16.,24.,panel.w-88.,22.,TEXT,true);
        self.control("control-picker-close",&self.t("controls.cancel"),Rect::new(panel.x+panel.w-60.,16.,48.,48.),json!({"kind":"editor-picker-close"}),ControlStyle{icon:Some("close"),..Default::default()});
        let max=(total-viewport.h).max(0.);
        let scroll=clamp(*self.scrolls.entry("control-picker".into()).or_default(),0.,max);
        self.widgets.begin_clip(viewport);
        for (index,command) in commands.iter().enumerate() {
            self.control(&format!("control-pick-{}",command.id),&self.command_label(command.id),
                Rect::new(viewport.x,viewport.y+index as f64*56.-scroll,viewport.w,48.),
                json!({"kind":"editor-command","command":command.id}),ControlStyle{size:17.,left:true,keep_offscreen:true,..Default::default()});
        }
        self.widgets.end_clip();
        self.regions.insert("control-picker".into(),Region{rect:viewport,max});
        self.widgets.scrollbar(viewport,total,scroll);
    }
}

impl BrowserUi {
    fn dock_command_label(&self,id:&str)->String {
        let label=match id {
            "web.movement"=>return self.movement_caption(),
            "web.commands"=>"action.help","game.inventory"=>"action.inventory","game.wield"=>"mobile.weapon","game.wear"=>"inventory.tab.armor",
            "game.search"=>"mobile.search","game.throw"=>"mobile.throw","game.zap"=>"inventory.tab.stick",
            "game.read"=>"mobile.read","game.eat"=>"","game.quaff"=>"",
            _=>return self.command_label(id),
        };
        if id=="game.eat" {self.mobile_help("action.eat")}
        else if id=="game.quaff" {self.mobile_help("action.quaff")}
        else {self.t(label)}
    }
    fn dock_command(&mut self,command:&str,id:&str,rect:Rect) {
        let key=commands::command(command).and_then(|definition|match definition.action {
            commands::CommandAction::Key(key)|commands::CommandAction::Direction(key)=>Some(json!(self.command_input_key(key))),
            commands::CommandAction::Context=>Some(json!(self.mobile_context_command().0)),
            _=>None,
        });
        self.control(id,&self.dock_command_label(command),rect,json!({"kind":"command","id":command}),
            ControlStyle{size:17.,role:ControlRole::Command,key,shortcut:self.command_shortcut(command),disabled:!self.command_available(command),highlight:command=="web.context"&&self.mobile_context_command().0!=115,..Default::default()});
    }
}
