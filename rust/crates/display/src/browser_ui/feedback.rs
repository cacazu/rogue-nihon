//! Accepted UI intent feedback is independent from focus, physical holds and sprites.
use super::*;
use rogue_contract::*;

const PULSE_MS:f64=160.;
#[derive(Clone)]
pub(super) struct Feedback {
    intent:Value,
    targets:Vec<(String,Rect)>,
    expires:Option<f64>,
    generation:Value,
}
fn visible(control:&Control)->bool {
    !control.disabled && control.kind!="field" && !control.label.is_empty()
        && control.rect.w>0. && control.rect.h>0.
}
fn scalar(key:u32)->u32 {
    match key & RG_EVENT_SCALAR_MASK {
        RG_KEY_LEFT=>104,RG_KEY_DOWN=>106,RG_KEY_UP=>107,RG_KEY_RIGHT=>108,
        RG_KEY_HOME=>121,RG_KEY_PAGE_UP=>117,RG_KEY_END=>98,RG_KEY_PAGE_DOWN=>110,
        RG_KEY_SELECT_THROW=>116,RG_KEY_SELECT_ZAP=>122,key=>key,
    }
}
impl BrowserUi {
    fn control_feedback_intent(&self,control:&Control)->Value {
        if let Some(id)=control.feedback_command.as_deref().or_else(||commands::control_command_id(control)) {return json!({"kind":"command","id":id});}
        let action=&control.action;
        if (action["kind"]=="movement" || action["kind"]=="send" && (self.command_ready() || b(&self.model["frame"]["ui"]["movement_direction"])))
            && let Some(key)=action["key"].as_u64()
            && let Some(id)=commands::key_id(scalar(key as u32)) {return json!({"kind":"command","id":id});}
        if action["kind"]=="send" {return json!({"kind":"choice","context":self.widgets.shortcut_context,"action":action});}
        action.clone()
    }
    fn record_feedback(&mut self,intent:Value) {
        let targets:Vec<_>=self.widgets.controls.iter().filter(|c|visible(c) && self.control_feedback_intent(c)==intent)
            .map(|c|(c.id.clone(),c.rect)).collect();
        if targets.is_empty() {return;}
        self.feedback_nonce=self.feedback_nonce.wrapping_add(1);
        self.feedback=Some(Feedback{intent,targets,expires:None,generation:self.model["generation"].clone()});
    }
    pub(super) fn feedback_control(&mut self,control:&Control) {
        if !self.control_action_available(control) {return;}
        if visible(control) {self.record_feedback(self.control_feedback_intent(control));}
    }
    pub(super) fn feedback_command(&mut self,id:&str) {self.record_feedback(json!({"kind":"command","id":id}));}
    fn feedback_key_control(&self,event:&Value)->Option<Control> {
        if event["type"]!="key" || b(&event["repeat"]) || !s(&event["native"]).is_empty()
            || b(&event["composing"]) || n(&event["keyCode"])==229.
            || b(&event["ctrlKey"]) || b(&event["altKey"]) || b(&event["shiftKey"]) || b(&event["metaKey"]) {return None;}
        let id=match s(&event["key"]) {
            "Escape" if self.binding_capture.is_some()=>"key-binding-cancel",
            "Enter" if self.binding_capture.is_some()=>"key-binding-confirm",
            "Escape" if self.controls_editor.is_some()=>if self.controls_editor.as_ref().unwrap().selected.is_some(){"control-picker-close"}else{"controls-cancel"},
            "Enter" if self.mobile_repeat_open && self.widgets.focus!="repeat-count-close"=>"repeat-count-submit",
            "Escape"=>return self.widgets.controls.iter().find(|c|visible(c) && (c.shortcut.as_deref()==Some("Escape") || c.key==Some(json!(27)))).cloned(),
            "Enter" | " " if !self.widgets.focus.is_empty()=>&self.widgets.focus,
            "Enter" if b(&self.model["topOpen"])=>"new-game",
            _=>return None,
        };
        self.widgets.controls.iter().find(|c|c.id==id && visible(c)).cloned()
    }
    fn effect_matches_control(&self,effect:&Value,control:&Control)->bool {
        if effect["kind"]=="send" && let Some(raw)=effect["key"].as_u64() {
            let expected=if let Some(id)=commands::control_command_id(control) {
                commands::command(id).and_then(|c|match c.action {
                    commands::CommandAction::Direction(key)=>Some(self.movement_key(key)),
                    commands::CommandAction::Key(key)=>Some(self.command_input_key(key)),
                    commands::CommandAction::Web(WebAction::Fire)=>Some(RG_KEY_FIRE),_=>None,
                })
            } else {control.action["key"].as_u64().map(|key|if control.action["kind"]=="movement"{self.movement_key(key as u32)}else{key as u32})};
            return expected.is_some_and(|key|scalar(key)==scalar(raw as u32));
        }
        control.action.as_object().is_some_and(|action| !action.is_empty() && action.iter().all(|(key,value)|effect[key]==*value))
    }
    pub(super) fn feedback_effects(&mut self,effects:&[Value]) {
        if let Some(control)=effects.iter().find_map(|effect|self.widgets.controls.iter().find(|c|visible(c) && self.effect_matches_control(effect,c)).cloned()) {
            self.feedback_control(&control);
        }
    }
    pub(super) fn feedback_diagnostics(&self)->Value {
        self.feedback.as_ref().map(|pulse|json!({"intent":pulse.intent,"controls":pulse.targets.iter().map(|(id,_)|id).collect::<Vec<_>>(),"expires":pulse.expires})).unwrap_or(Value::Null)
    }
    pub(super) fn paint_feedback(&mut self)->Option<f64> {
        let now=n(&self.view["now"]);
        if self.feedback.as_ref().is_some_and(|p|p.generation!=self.model["generation"] || p.expires.is_some_and(|end|now>=end)) {
            self.feedback=None;
        }
        let pulse=self.feedback.as_mut()?;
        // Start the short visual lifetime at its first paint, including a fast tap after an idle frame.
        let expires=*pulse.expires.get_or_insert(now+PULSE_MS);
        let pulse=pulse.clone();
        let current:Vec<_>=self.widgets.controls.iter().filter(|c|visible(c) && self.control_feedback_intent(c)==pulse.intent).map(|c|c.rect).collect();
        let echo=current.is_empty();
        let rects=if echo {pulse.targets.iter().map(|(_,r)|*r).collect()}else{current};
        for rect in rects {
            let rect=rect.intersect(Rect::new(0.,0.,self.width,self.height));
            if rect.w<=0. || rect.h<=0. {continue;}
            self.widgets.commands.push(json!({"op":"save","alpha":if echo{0.10}else{0.20}}));
            self.widgets.box_rect(rect,ACCENT,None,0.);
            self.widgets.commands.last_mut().unwrap()["feedback"]=json!(true);
            self.widgets.commands.push(json!({"op":"restore"}));
            self.widgets.commands.push(json!({"op":"save","alpha":if echo{0.35}else{0.65}}));
            self.widgets.box_rect(rect,"transparent",Some(ACCENT),0.);
            self.widgets.commands.last_mut().unwrap()["feedback"]=json!(true);
            self.widgets.commands.push(json!({"op":"restore"}));
        }
        Some((expires-now).max(1.))
    }
    pub fn event(&mut self,event:Value)->Value {
        if event["type"]=="cancel" && event["id"].is_null()
            || matches!(s(&event["type"]),"blur"|"pagehide")
            || event["type"]=="visibilitychange" && b(&event["hidden"]) {self.feedback=None;}
        let key_control=self.feedback_key_control(&event);let nonce=self.feedback_nonce;
        let mut result=self.event_core(event);
        if nonce==self.feedback_nonce {self.feedback_effects(array(&result["effects"]));}
        if nonce==self.feedback_nonce && b(&result["consumed"]) && let Some(control)=key_control {self.feedback_control(&control);}
        result["feedbackChanged"]=json!(nonce!=self.feedback_nonce);
        result["diagnostics"]=self.diagnostics();result
    }
}
