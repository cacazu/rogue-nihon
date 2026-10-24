//! Item choices consume UI navigation before any raw game key is forwarded.
use super::*;

impl BrowserUi {
    pub(super) fn item_navigation_visible(&self) -> bool {
        let ui=&self.model["frame"]["ui"];
        !b(&self.model["topOpen"]) && !b(&self.model["settingsOpen"])
            && (self.inventory_browse_visible() || ui["input"]["kind"]=="item"
                || ui["window"]["kind"]=="inventory_actions")
    }
    fn item_focus_candidates(&self) -> Vec<Control> {
        let actions=self.model["frame"]["ui"]["window"]["kind"]=="inventory_actions";
        self.widgets.controls.iter().filter(|c| !c.disabled && if actions {
            c.id.starts_with("window-") && c.action["kind"]=="send"
        } else {c.id.starts_with("item-")}).cloned().collect()
    }
    pub(super) fn sync_item_focus(&mut self) {
        if self.item_navigation_visible() && self.widgets.focus.starts_with("item-")
            && !self.item_focus_candidates().iter().any(|c|c.id==self.widgets.focus) {
            self.widgets.focus.clear();
        }
    }
    pub(super) fn reveal_item_focus(&mut self) {
        if !self.item_navigation_visible() {return;}
        let Some(control)=self.item_focus_candidates().into_iter().find(|c|c.id==self.widgets.focus) else{return;};
        // Action buttons are fixed below the scrolling item viewport.
        if !control.id.starts_with("item-") {return;}
        let Some(region)=self.regions.get("dialog").copied() else{return;};
        let row=control.full_rect;
        let delta=if row.y<region.rect.y {row.y-region.rect.y}
            else {(row.y+row.h-region.rect.y-region.rect.h).max(0.)};
        self.scroll_by("dialog",delta);
    }
    pub(super) fn item_navigation_key(&mut self,event:&Value,effects:&mut Vec<Value>)->bool {
        if !self.item_navigation_visible() || !self.scope.starts_with("dialog")
            || !s(&event["native"]).is_empty() || b(&event["metaKey"]) {return false;}
        let key=match s(&event["code"]) {
            "Numpad2"=>"ArrowDown", "Numpad8"=>"ArrowUp",
            "Numpad4"=>"ArrowLeft", "Numpad6"=>"ArrowRight", _=>s(&event["key"]),
        };
        if matches!(key,"ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight" | "Enter")
            && (b(&event["ctrlKey"]) || b(&event["altKey"]) || b(&event["shiftKey"])) {
            self.activate_shortcut(event,"dialog",effects);
            return true;
        }
        match key {
            "ArrowDown" | "ArrowUp" => {
                let candidates=self.item_focus_candidates();
                if candidates.is_empty() {self.widgets.focus.clear();return true;}
                let current=candidates.iter().position(|c|c.id==self.widgets.focus);
                let next=match (current,key) {
                    (None,"ArrowDown")=>0, (None,_)=>candidates.len()-1,
                    (Some(i),"ArrowDown")=>(i+1).min(candidates.len()-1), (Some(i),_)=>i.saturating_sub(1),
                };
                self.widgets.focus=candidates[next].id.clone();self.reveal_item_focus();true
            }
            "ArrowLeft" | "ArrowRight" => {
                let tabs:Vec<_>=self.widgets.controls.iter().filter(|c|!c.disabled && c.action["kind"]=="inventory-tab").cloned().collect();
                if tabs.len()>1 {
                    let current=tabs.iter().position(|c|c.action["tab"]==self.list_tabs().tab).unwrap_or(0);
                    let next=(current as i64+if key=="ArrowRight"{1}else{-1}).rem_euclid(tabs.len() as i64) as usize;
                    self.activate(&tabs[next],&Value::Null,effects);
                }
                true
            }
            "Enter" => {
                if let Some(c)=self.widgets.controls.iter().find(|c|c.id==self.widgets.focus && !c.disabled).cloned() {
                    self.activate(&c,&Value::Null,effects);
                }
                true
            }
            _=>false,
        }
    }
}
