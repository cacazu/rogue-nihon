//! A PC direction selector follows the initiating button, never a stale keyboard click.
use super::*;
pub(super) fn direction_bounds(x:f64,y:f64,width:f64,height:f64)->Rect {Rect::new(clamp(x-84.,8.,width-176.),clamp(y-84.,8.,height-176.),168.,168.)}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nearby_selector_clamps_its_entire_rectangle_and_keeps_interior_anchor() {
        assert_eq!(direction_bounds(2.,898.,700.,900.),Rect::new(8.,724.,168.,168.));
        assert_eq!(direction_bounds(350.,450.,700.,900.),Rect::new(266.,366.,168.,168.));
        assert_eq!(direction_bounds(1399.,1.,1400.,900.),Rect::new(1224.,8.,168.,168.));
    }
}

#[derive(Clone)]
pub(super) struct DirectionOrigin {
    pub control:String,
    pub point:(f64,f64),
    pub viewport:(f64,f64),
    pub generation:Value,
    pub seen:bool,
    pub request:u64,
}
impl BrowserUi {
    /// Both map pads use the same direction intent, key caption and highlight.
    pub(super) fn direction_control(&mut self,id:&str,key:u32,label:&str,rect:Rect) {
        let pc=self.pc_controls();
        let direction=b(&self.model["frame"]["ui"]["movement_direction"]);
        let emitted=self.movement_key(key);
        let shortcut=commands::key_id(key).and_then(|id|self.command_shortcut(id));
        self.control(id,label,rect,json!({"kind":"send","key":emitted}),
            ControlStyle{size:if key==46 {17.}else{26.},custom:pc,key:Some(json!(emitted)),throw_direction:direction,shortcut:shortcut.clone(),..Default::default()});
        if pc {
            let color=if direction {"@background"}else{"@button.text"};
            self.widgets.single_line(label,Rect::new(rect.x,rect.y+2.,rect.w,27.),
                LineStyle{text:TextStyle::new(if key==46 {15.}else{24.},color,false),center:true,ellipsis:false},self.measure);
            self.widgets.fitted_line(shortcut.as_deref().unwrap_or(""),Rect::new(rect.x+1.,rect.y+rect.h-18.,rect.w-2.,15.),
                LineStyle{text:TextStyle::new(12.,color,false),center:true,ellipsis:false},self.measure);
        }
    }
    pub(super) fn remember_direction_origin(&mut self,control:&Control) {
        if self.keyboard_dispatch || !self.pc_controls() {return;}
        if control.action["key"]==27 {self.direction_origin=None;return;}
        let kind=s(&control.action["kind"]);
        let key=control.action["key"].as_u64();
        let from_command=self.command_ready() && matches!(kind,"command"|"send"|"movement"|"web");
        let from_item_action=control.id.starts_with("window-") && matches!(key,Some(116|122|102|70|94));
        if from_command || from_item_action {
            self.direction_origin=Some(DirectionOrigin {control:control.id.clone(),point:(control.rect.x+control.rect.w/2.,control.rect.y+control.rect.h/2.),viewport:(self.width,self.height),generation:self.model["generation"].clone(),seen:false,request:n(&self.model["inputRequests"]) as u64});
        }
    }
    pub(super) fn sync_direction_origin(&mut self) {
        let direction=b(&self.model["frame"]["ui"]["movement_direction"]);
        let request=n(&self.model["inputRequests"]) as u64;
        if self.direction_origin.as_ref().is_some_and(|origin|origin.generation!=self.model["generation"] || b(&self.model["topOpen"]) || origin.seen && !direction && self.model["input"]["kind"]=="command" && request>origin.request) {
            self.direction_origin=None;
        }
        if direction {
            if let Some(origin)=self.direction_origin.as_mut() {origin.seen=true;origin.request=request;}
        }
    }
    pub(super) fn draw_desktop_direction(&mut self) {
        let point=self.direction_origin.as_ref().map(|origin| {
            self.widgets.controls.iter().find(|c|c.id==origin.control)
                .map(|control|(control.rect.x+control.rect.w/2.,control.rect.y+control.rect.h/2.))
                .unwrap_or_else(||(origin.point.0*self.width/origin.viewport.0.max(1.),origin.point.1*self.height/origin.viewport.1.max(1.)))
        }).unwrap_or((self.width/2.,self.height/2.));
        let pad=direction_bounds(point.0,point.1,self.width,self.height);
        self.begin_choices("throw-direction");
        self.regions.clear();
        self.widgets.box_rect(Rect::new(pad.x-4.,pad.y-4.,pad.w+8.,pad.h+8.),PANEL,Some(LINE),8.);
        let directions=self.model["frame"]["ui"]["map_controls"]["directions"].clone();
        for direction in array(&directions) {
            let key=n(&direction["key"]) as u32;
            if key==46 {continue;}
            let rect=Rect::new(pad.x+n(&direction["column"])*58.,pad.y+n(&direction["row"])*58.,52.,52.);
            self.direction_control(&format!("touch-{}",char::from_u32(key).unwrap()),key,s(&direction["text"]),rect);
        }
        self.control("pc-cancel",&self.t("action.cancel_short"),Rect::new(pad.x+58.,pad.y+58.,52.,52.),json!({"kind":"send","key":27}),ControlStyle{size:17.,key:Some(json!(27)),shortcut:self.pc_shortcut("Escape"),..Default::default()});
    }
}


#[cfg(test)]
mod direction_contract_tests {
    use super::*;
    fn measure(text:&str,size:f64,_bold:bool,_mono:bool)->TextSize {TextSize{width:text.chars().count() as f64*size*0.55,ascent:0.,descent:size}}
    #[test]
    fn pc_direction_selector_exposes_and_paints_each_direction_shortcut() {
        for width in [320.,390.,700.,1400.] {
            let mut ui=BrowserUi::new(measure);ui.width=width;ui.height=900.;ui.view=json!({"coarse":false});
            ui.model=json!({"running":true,"language":"ja","input":{"kind":"direction"},"frame":{"ui":{"mode":"game","input":{"kind":"direction"},"movement_direction":true}}});
            ui.model["frame"]["ui"]["map_controls"]=crate::game_window::map_controls(&ui.model["frame"]["ui"],false);
            ui.draw_desktop_direction();
            for letter in ['y','k','u','h','l','b','j','n'] {
                let c=ui.widgets.controls.iter().find(|c|c.id==format!("touch-{letter}")).unwrap();
                assert_eq!(c.shortcut.as_deref(),Some(letter.to_string().as_str()),"{width}: {letter}");
                assert_eq!(c.action["key"],json!(letter as u32));
                assert!(ui.widgets.commands.iter().any(|c|c["op"]=="text"&&c["text"]==letter.to_string()&&c["color"]==ui.widgets.theme.color("@background")),"The highlighted pad paints its real key: {letter}");
            }
            assert_eq!(ui.widgets.controls.iter().find(|c|c.id=="pc-cancel").unwrap().shortcut.as_deref(),Some("Escape"));
        }
    }
}
