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
    pub(super) fn inventory_list_visible(&self) -> bool {
        let ui = &self.model["frame"]["ui"];
        b(&ui["inventory"]) && ui["window"]["kind"] == "menu"
    }
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
        TABS.iter().copied().filter(|tab| *tab == "all" || array(&ui["lines"]).iter().any(|row| b(&row["selectable"]) && matches(tab, row))).collect()
    }
    pub(super) fn sync_inventory_tabs(&mut self, ui: &Value) {
        if !self.inventory_available_tabs(ui).contains(&self.inventory_tabs.tab.as_str()) {
            self.inventory_tabs.tab = "all".into();
            self.inventory_tabs.reveal = true;
        }
    }
    pub(super) fn inventory_row_visible(&self, row: &Value) -> bool {
        !b(&row["selectable"]) || matches(&self.inventory_tabs.tab, row)
    }
    pub(super) fn inventory_scroll(&self) -> f64 {
        *self.inventory_tabs.positions.get(&self.inventory_tabs.tab).unwrap_or(&0.)
    }
    pub(super) fn remember_inventory_scroll(&mut self, scroll: f64) {
        self.inventory_tabs.positions.insert(self.inventory_tabs.tab.clone(), scroll);
    }
    pub(super) fn draw_inventory_tabs(&mut self, ui: &Value, rect: Rect) {
        let tabs = self.inventory_available_tabs(ui);
        let mut sizes = Vec::new();
        let mut total = 0.;
        for tab in tabs {
            let label = self.t(&format!("inventory.tab.{tab}"));
            let width = ((self.measure)(&label, 17., false, false).width + 20.).max(48.);
            sizes.push((tab,label,total,width));
            total += width + 6.;
        }
        total = (total - 6.).max(0.);
        let max = (total - rect.w).max(0.);
        let mut scroll = clamp(self.inventory_tabs.horizontal,0.,max);
        if self.inventory_tabs.reveal {
            if let Some((_,_,left,width)) = sizes.iter().find(|(tab,_,_,_)| *tab == self.inventory_tabs.tab) {
                if *left < scroll { scroll = *left; }
                else if left + width > scroll + rect.w { scroll = left + width - rect.w; }
                scroll = clamp(scroll,0.,max);
            }
            self.inventory_tabs.reveal = false;
        }
        self.inventory_tabs.horizontal = scroll;
        self.scrolls.insert("inventory-tabs".into(),scroll);
        self.regions.insert("inventory-tabs".into(),Region { rect,max });
        self.widgets.begin_clip(rect);
        for (tab,label,left,width) in sizes {
            let active = tab == self.inventory_tabs.tab;
            let r = Rect::new(rect.x+left-scroll,rect.y,width,rect.h);
            self.control(&format!("inventory-tab-{tab}"),&label,r,json!({"kind":"inventory-tab","tab":tab}),
                ControlStyle { flat:true,custom:true,..Default::default() });
            self.widgets.single_line(&label,Rect::new(r.x,r.y+4.,r.w,32.),
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
