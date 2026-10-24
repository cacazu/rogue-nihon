//! One browser-local ranking view for the title screen and original score phase.
use super::*;
impl BrowserUi {
    pub(super) fn rankings_button(&mut self,rect:Rect,disabled:bool) {
        self.control("rankings-open",&self.t("rankings.title"),rect,json!({"kind":"rankings","open":true}),ControlStyle{size:17.,disabled,..Default::default()});
    }
    pub(super) fn activate_rankings(&mut self,open:bool,effects:&mut Vec<Value>) {
        if open && !b(&self.model["topOpen"]) {return;}
        self.rankings_open=open;self.stop_hold();
        if open {self.scrolls.insert("rankings".into(),0.);effects.push(json!({"kind":"invoke","id":"rankings-read"}));}
    }
    pub(super) fn rankings_key(&mut self,event:&Value,effects:&mut Vec<Value>)->bool {
        if !self.rankings_open {return false;}
        if self.activate_shortcut(event,"rankings",effects) {return true;}
        match s(&event["key"]) {
            "Escape"=>self.activate_rankings(false,effects),
            "ArrowDown"|"PageDown"=>self.scroll_by("rankings",150.),
            "ArrowUp"|"PageUp"=>self.scroll_by("rankings",-150.),
            "Tab"=>self.widgets.focus="rankings-close".into(),
            _=>{},
        }
        true
    }
    fn ranking_lines(&self)->Vec<Value> {
        let mut lines=Vec::new();
        for (index,record) in array(&self.model["rankings"]["entries"]).iter().enumerate() {
            let flags=n(&record["flags"]) as u32;let reason=match flags {0=>"ui.score.reason.killed",1=>"ui.score.reason.quit",2=>"ui.score.reason.winner",_=>"ui.score.reason.amulet"};
            let mut args=vec![json!({"kind":"signed","value":index+1}),json!({"kind":"signed","value":record["score"]}),json!({"kind":"string","value":record["name"]}),json!({"kind":"term","value":reason}),json!({"kind":"signed","value":record["level"]})];
            let id=if flags==0 || flags==3 {args.push(json!({"kind":"entity","value":{"type":"death","code":record["monster"],"article":true}}));"ui.score.entry_death"}else{"ui.score.entry"};
            let args=json!(args);let text=crate::display::message_language(id,&args,"",s(&self.model["language"])).text;
            lines.push(json!({"scope":"score","id":id,"args":args,"text":text}));
        }
        if lines.is_empty() {let id=if b(&self.model["rankingLoading"]){"notice.loading"}else{"rankings.empty"};lines.push(json!({"scope":"score","id":id,"text":self.t(id)}));}
        if let Some(id)=self.model["rankingErrorId"].as_str().filter(|id|matches!(*id,"error.rankings_save"|"error.rankings_load")) {lines.push(json!({"scope":"score","id":id,"text":self.t(id)}));}
        lines
    }
    pub(super) fn project_ranking_score(&self,ui:&mut Value) {
        if !array(&ui["lines"]).iter().any(|line|line["id"]=="ui.score.heading") {return;}
        let mut lines:Vec<_>=array(&ui["lines"]).iter().filter(|line|!s(&line["id"]).starts_with("ui.score.")).cloned().collect();
        lines.extend(self.ranking_lines());ui["lines"]=json!(lines);ui["window"]["title"]=json!(self.t("rankings.title"));
    }
    pub(super) fn draw_rankings(&mut self) {
        self.begin_choices("rankings");self.regions.clear();self.map_rect=None;
        self.widgets.rect(Rect::new(0.,0.,self.width,self.height),"@overlay.strong");
        let width=(self.width-16.).min(720.);let lines=self.ranking_lines();let inner=width-36.;
        let heights:Vec<_>=lines.iter().map(|line|self.wrap(s(&line["text"]),inner,18.).len().max(1) as f64*30.+14.).collect();
        let total=heights.iter().sum::<f64>();let (panel,viewport)=self.sheet_layout(width,total+20.);
        self.widgets.box_rect(panel,PANEL,Some(LINE),0.);self.text(&self.t("rankings.title"),panel.x+16.,24.,width-88.,22.,TEXT,true);
        self.control("rankings-close",&self.t("action.cancel_short"),Rect::new(panel.x+width-56.,16.,48.,48.),json!({"kind":"rankings","open":false}),ControlStyle{icon:Some("close"),icon_size:24.,shortcut:self.pc_shortcut("Escape"),..Default::default()});
        let max=(total-viewport.h).max(0.);let scroll=clamp(*self.scrolls.get("rankings").unwrap_or(&0.),0.,max);let mut y=viewport.y-scroll;
        self.widgets.begin_clip(viewport);for (line,height) in lines.iter().zip(heights) {self.text(s(&line["text"]),viewport.x+8.,y,inner,18.,TEXT,false);y+=height;}
        self.widgets.end_clip();self.regions.insert("rankings".into(),Region{rect:viewport,max});self.scrolls.insert("rankings".into(),scroll);self.widgets.scrollbar(viewport,total,scroll);
    }
}

#[cfg(test)]
mod tests {
 use super::*;
 fn measure(text:&str,size:f64,_:bool,_:bool)->TextSize {TextSize{width:text.chars().count() as f64*size/2.,ascent:0.,descent:size}}
 #[test] fn ranking_sheet_scroll_and_score_projection_preserve_original_ack() {
    let mut ui=BrowserUi::new(measure);ui.rankings_open=true;
    let entries:Vec<_>=(0..10).map(|i|json!({"adventure":format!("A{i}"),"score":100-i,"flags":1,"name":"Player","level":1,"monster":0})).collect();
    let model=json!({"topOpen":true,"language":"en","rankings":{"version":1,"entries":entries},"generation":1});
    let view=json!({"width":390,"height":300,"coarse":false,"now":0.});ui.render(model.clone(),view.clone());
    let region=ui.regions["rankings"];assert!(region.max>0.);
    let out=ui.event(json!({"type":"wheel","x":region.rect.x+10.,"y":region.rect.y+10.,"dy":90.}));
    assert_eq!(ui.scrolls["rankings"],90.);assert!(out["effects"].as_array().unwrap().is_empty());
    ui.render(model,view);let x=region.rect.x+10.;let y=region.rect.y+40.;
    ui.event(json!({"type":"down","id":1,"pointerType":"touch","x":x,"y":y}));
    ui.event(json!({"type":"move","id":1,"pointerType":"touch","buttons":1,"captured":true,"x":x,"y":y-30.}));
    assert!(ui.scrolls["rankings"]>90.);ui.event(json!({"type":"up","id":1,"pointerType":"touch","x":x,"y":y-30.}));
    let mut score=json!({"lines":[{"id":"ui.score.heading"},{"id":"ui.score.entry","text":"old"}],"input":{"kind":"ack","key":13},"actions":[{"key":13}]});
    ui.project_ranking_score(&mut score);assert_eq!(score["input"],json!({"kind":"ack","key":13}));assert_eq!(score["actions"],json!([{"key":13}]));assert_eq!(score["lines"].as_array().unwrap().len(),10);
    let mut tomb=json!({"lines":[{"id":"ui.tombstone.name"}],"input":{"kind":"ack"}});let before=tomb.clone();ui.project_ranking_score(&mut tomb);assert_eq!(tomb,before);
    ui.event(json!({"type":"key","key":"Escape"}));assert!(!ui.rankings_open);
 }
}
