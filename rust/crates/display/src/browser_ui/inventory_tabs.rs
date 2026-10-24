//! Inventory filters and remembered positions use public rows, never game input.
use super::*;

const TABS: &[&str] = &["all", "equipped", "stick", "food", "potion", "scroll", "weapon", "armor", "ring", "amulet", "gold"];

pub(super) struct InventoryTabs {
    pub tab: String,
    pub positions: BTreeMap<String, f64>,
    pub horizontal: f64,
    pub reveal: bool,
}
impl Default for InventoryTabs {
    fn default() -> Self {
        Self { tab:"all".into(), positions:BTreeMap::new(), horizontal:0., reveal:true }
    }
}
fn item(row: &Value) -> &Value { &row["args"][1]["value"] }
fn matches(tab: &str, row: &Value) -> bool {
    match tab {
        "all" => true,
        "equipped" => item(row)["equipped"].as_str().is_some_and(|slot| slot != "none"),
        category => item(row)["category"] == category,
    }
}

impl BrowserUi {
    pub(super) fn inventory_browse_visible(&self) -> bool {
        let ui = &self.model["frame"]["ui"];
        b(&ui["inventory"]) && ui["window"]["kind"] == "menu"
    }
    pub(super) fn item_selection_visible(&self) -> bool {
        self.pc_controls()
            && self.model["frame"]["ui"]["input"]["kind"] == "item"
    }
    pub(super) fn inventory_list_visible(&self) -> bool {
        self.inventory_browse_visible() || self.item_selection_visible()
    }
    pub(super) fn list_tabs(&self) -> &InventoryTabs {
        if self.item_selection_visible() { &self.selection_tabs } else { &self.inventory_tabs }
    }
    pub(super) fn list_tabs_mut(&mut self) -> &mut InventoryTabs {
        if self.item_selection_visible() { &mut self.selection_tabs } else { &mut self.inventory_tabs }
    }
    pub fn reset_inventory_view(&mut self) { self.inventory_tabs=InventoryTabs::default(); }
    pub fn inventory_preference(&self) -> Value {
        json!({"version":1,"tab":self.inventory_tabs.tab,"positions":self.inventory_tabs.positions,"horizontal":self.inventory_tabs.horizontal})
    }
    pub fn load_inventory_preference(&mut self, raw: &str) {
        let Ok(value) = serde_json::from_str::<Value>(raw) else { return; };
        if value["version"] != 1 { return; }
        if TABS.contains(&s(&value["tab"])) { self.inventory_tabs.tab = s(&value["tab"]).into(); }
        for tab in TABS {
            if let Some(offset) = value["positions"][*tab].as_f64().filter(|n| n.is_finite() && *n >= 0. && *n <= 1_000_000.) {
                self.inventory_tabs.positions.insert((*tab).into(), offset);
            }
        }
        self.inventory_tabs.horizontal = value["horizontal"].as_f64().filter(|n| n.is_finite()).unwrap_or(0.).clamp(0., 100_000.);
        self.inventory_tabs.reveal = true;
    }
    pub(super) fn inventory_available_tabs(&self, ui: &Value) -> Vec<&'static str> {
        if self.item_selection_visible() {
            let filter = s(&ui["input"]["filter"]);
            if filter == "all" { return vec!["all"]; }
            if filter == "ring-stick" { return vec!["stick","ring"]; }
            if TABS.contains(&filter) && filter != "equipped" {
                return vec![TABS.iter().copied().find(|tab| *tab == filter).unwrap()];
            }
            // CALLABLE offers only categories still present in public choices.
            let tabs: Vec<_> = TABS.iter().copied().filter(|tab| !matches!(*tab,"all" | "equipped")
                && array(&ui["lines"]).iter().any(|row| b(&row["selectable"]) && matches(tab,row))).collect();
            return if tabs.is_empty() { vec!["all"] } else { tabs };
        }
        TABS.iter().copied().filter(|tab| *tab == "all" || array(&ui["lines"]).iter().any(|row| b(&row["selectable"]) && matches(tab, row))).collect()
    }
    pub(super) fn sync_inventory_tabs(&mut self, ui: &Value) {
        if self.item_selection_visible() {
            let context = format!("{}:{}:{}",s(&ui["input"]["action"]),s(&ui["input"]["id"]).replace("_list",""),s(&ui["input"]["filter"]));
            if context != self.selection_context {
                self.selection_tabs = InventoryTabs::default();
                self.selection_context = context;
            }
        }
        let tabs = self.inventory_available_tabs(ui);
        if !tabs.contains(&self.list_tabs().tab.as_str()) {
            let state = self.list_tabs_mut();
            state.tab = tabs[0].into();
            state.reveal = true;
        }
    }
    pub(super) fn inventory_row_visible(&self, row: &Value) -> bool {
        !b(&row["selectable"]) || matches(&self.list_tabs().tab, row)
    }
    pub(super) fn inventory_scroll(&self) -> f64 {
        *self.list_tabs().positions.get(&self.list_tabs().tab).unwrap_or(&0.)
    }
    pub(super) fn remember_inventory_scroll(&mut self, scroll: f64) {
        let tab = self.list_tabs().tab.clone();
        self.list_tabs_mut().positions.insert(tab, scroll);
    }
    pub(super) fn draw_inventory_tabs(&mut self, ui: &Value, rect: Rect) {
        let tabs = self.inventory_available_tabs(ui);
        let mut sizes = Vec::new();
        let mut total = 0.;
        for (index, tab) in tabs.into_iter().enumerate() {
            let label = self.t(&format!("inventory.tab.{tab}"));
            let shortcut = self.pc_shortcut(&"1234567890-".chars().nth(index).unwrap().to_string());
            let visible_label = Widgets::shortcut_label(&label, shortcut.as_deref());
            let width = ((self.measure)(&visible_label, 17., false, false).width + 20.).max(48.);
            sizes.push((tab,label,shortcut,total,width));
            total += width + 6.;
        }
        total = (total - 6.).max(0.);
        let max = (total - rect.w).max(0.);
        let mut scroll = clamp(self.list_tabs().horizontal,0.,max);
        if self.list_tabs().reveal {
            let reveal = self.widgets.focus.strip_prefix("inventory-tab-").unwrap_or(&self.list_tabs().tab);
            if let Some((_,_,_,left,width)) = sizes.iter().find(|(tab,_,_,_,_)| *tab == reveal) {
                if *left < scroll { scroll = *left; }
                else if left + width > scroll + rect.w { scroll = left + width - rect.w; }
                scroll = clamp(scroll,0.,max);
            }
            self.list_tabs_mut().reveal = false;
        }
        self.list_tabs_mut().horizontal = scroll;
        self.scrolls.insert("inventory-tabs".into(),scroll);
        self.regions.insert("inventory-tabs".into(),Region { rect,max });
        self.widgets.begin_clip(rect);
        for (tab,label,shortcut,left,width) in sizes {
            let visible_label = Widgets::shortcut_label(&label, shortcut.as_deref());
            let active = tab == self.list_tabs().tab;
            let r = Rect::new(rect.x+left-scroll,rect.y,width,rect.h);
            self.control(&format!("inventory-tab-{tab}"),&label,r,json!({"kind":"inventory-tab","tab":tab}),
                ControlStyle { role:ControlRole::Tab,custom:true,shortcut,keep_offscreen:true,..Default::default() });
            self.widgets.control_line(&visible_label,r,
                LineStyle { text:TextStyle::new(17.,if active { ACCENT } else { TEXT },active),center:true,ellipsis:false },self.measure);
            if active { self.widgets.rect(Rect::new(r.x+6.,r.y+40.,r.w-12.,3.),ACCENT); }
        }
        if max > 0. {
            let thumb = (rect.w * rect.w / total).max(24.);
            self.widgets.rect(Rect::new(rect.x,rect.y+47.,rect.w,1.),LINE);
            self.widgets.rect(Rect::new(rect.x+(rect.w-thumb)*scroll/max,rect.y+46.,thumb,2.),MUTED);
        }
        self.widgets.end_clip();
    }
}
