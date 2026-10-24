//! Map contacts preserve a matching route; only a confirmed tap commits an action.
use super::*;

impl BrowserUi {
    fn map_intent_available(&self) -> bool {
        self.command_ready() && self.map_navigation_available() && self.model["frame"]["ui"]["mode"]=="game"
    }
    pub(super) fn map_contact(&self, x:f64, y:f64) -> Option<Value> {
        if !self.map_intent_available() || !self.map_rect?.contains(x,y) || self.hit(x,y).is_some() {return None;}
        let cell=self.map_cell(x,y)?;
        Some(json!({"kind":"map-contact","x":cell["x"],"y":cell["y"],"movement":self.mobile_movement}))
    }
    pub(super) fn commit_map_intent(&mut self, cell:&Value, effects:&mut Vec<Value>) {
        if !self.map_intent_available() {return;}
        let (Some(x),Some(y))=(cell["x"].as_f64(),cell["y"].as_f64()) else {return;};
        let player=&self.model["frame"]["player"];
        if player["x"].as_f64()==Some(x) && player["y"].as_f64()==Some(y) {
            self.activate_command("game.rest",effects);
        } else {
            effects.push(json!({"kind":"map-target","x":cell["x"],"y":cell["y"],"movement":self.mobile_movement}));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn measure(text:&str,size:f64,_:bool,_:bool)->TextSize {
        TextSize {width:text.len() as f64*size/2.,ascent:0.,descent:size}
    }
    fn ui()->BrowserUi {
        let mut ui=BrowserUi::new(measure);
        ui.model=json!({"running":true,"input":{"kind":"command"},"frame":{"width":8,"height":6,
            "player":{"x":1,"y":2},"ui":{"mode":"game","input":{"kind":"command"}}}});
        ui.view=json!({"coarse":false});
        ui.map_rect=Some(Rect::new(0.,0.,80.,40.));
        ui.camera=Some(Camera {size:10.,cell_h:10.,width:80.,height:40.,..Camera::default()});
        ui
    }
    #[test]
    fn map_intent_contact_has_no_game_input_and_self_tap_is_canonical_rest() {
        for mode in 0..=2 {
            let mut ui=ui();ui.mobile_movement=mode;
            let mut canonical=Vec::new();ui.activate_command("game.rest",&mut canonical);
            let mut effects=Vec::new();ui.commit_map_intent(&json!({"x":1.,"y":2.}),&mut effects);
            assert_eq!(effects,canonical);assert_eq!(effects,json!([{"kind":"send","key":46}]).as_array().unwrap().to_vec());
            assert_eq!(ui.map_contact(15.,15.),Some(json!({"kind":"map-contact","x":1.,"y":2.,"movement":mode})));
            effects.clear();ui.commit_map_intent(&json!({"x":2.,"y":2.}),&mut effects);
            assert_eq!(effects,vec![json!({"kind":"map-target","x":2.,"y":2.,"movement":mode})]);
        }
    }
    #[test]
    fn map_intent_contact_and_commit_share_modal_and_command_availability() {
        let models=[json!({"settingsOpen":true}),json!({"topOpen":true}),json!({"savePending":true}),
            json!({"starting":true}),json!({"returnAfterEnd":true}),json!({"running":false}),
            json!({"input":{"kind":"direction"}}),json!({"frame":{"ui":{"movement_direction":true}}}),
            json!({"frame":{"ui":{"window":{"kind":"inventory"}}}})];
        for patch in models {
            let mut ui=ui();
            for (key,value) in patch.as_object().unwrap() {
                if key=="frame" { for (k,v) in value["ui"].as_object().unwrap() {ui.model["frame"]["ui"][k]=v.clone();} }
                else {ui.model[key]=value.clone();}
            }
            assert_eq!(ui.map_contact(15.,15.),None,"{patch}");
            let mut effects=Vec::new();ui.commit_map_intent(&json!({"x":1.,"y":2.}),&mut effects);
            assert!(effects.is_empty(),"{patch}: {effects:?}");
        }
        for modal in 0..5 {
            let mut ui=ui();match modal {0=>ui.commands_open=true,1=>ui.history_open=true,2=>ui.status_open=true,3=>ui.mobile_operations=true,_=>ui.mobile_repeat_open=true}
            assert_eq!(ui.map_contact(15.,15.),None);
            let mut effects=Vec::new();ui.commit_map_intent(&json!({"x":1.,"y":2.}),&mut effects);assert!(effects.is_empty());
        }
        let mut ui=ui();assert_eq!(ui.map_contact(85.,15.),None);
        ui.widgets.hit_target("overlay","",Rect::new(0.,0.,20.,20.),Value::Null);
        assert_eq!(ui.map_contact(15.,15.),None);
    }
}
