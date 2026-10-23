//! Desktop dock uses a fixed twelve-command profile, separate from phone settings.
use super::*;
pub(super) fn dock_height(_width:f64)->f64 {230.}
impl BrowserUi {
    fn desktop_command(&mut self,id:&str,key:u32,label:&str,rect:Rect,disabled:bool) {
        self.control(id,label,rect,json!({"kind":"send","key":key}),ControlStyle{size:17.,role:ControlRole::Command,shortcut:commands::key_id(key).and_then(|id|self.command_shortcut(id)),key:Some(json!(key)),disabled,..Default::default()});
    }
    pub(super) fn draw_desktop_dock(&mut self,dock:Rect) {
        self.draw_configurable_dock(dock,control_preferences::ControlForm::Desktop);
        if b(&self.model["frame"]["ui"]["movement_direction"]) {return;}
        let width=(dock.w-200.).min(880.);
        let context=self.map_context_commands();
        let fire=b(&self.model["frame"]["ui"]["ranged"]["bow"]);
        let count=context.len()+usize::from(fire);
        if count==0 {return;}
        let left=if self.left_handed() {(self.width-width-184.)/2.+184.}else{(self.width-width-184.)/2.};
        let cell=((width-(count-1) as f64*8.)/count as f64).min(180.);
        let x=left+(width-(count as f64*cell+(count-1) as f64*8.))/2.;
        let left_handed=self.left_handed();
        let rect=|index:usize|Rect::new(x+if left_handed{index}else{count-1-index} as f64*(cell+8.),dock.y+8.,cell,48.);
        for (index,(key,label)) in context.iter().enumerate() {
            let id=match key {60=>"pc-ascend",62=>"pc-descend",94=>"pc-trap",44=>"pc-pickup",_=>unreachable!()};
            self.desktop_command(id,*key,&self.t(label),rect(index),!self.command_ready());
        }
        if fire {self.command_control("web.fire","pc-fire",rect(context.len()),ControlStyle{size:17.,..Default::default()});}
    }
}
