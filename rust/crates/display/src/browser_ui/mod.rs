//! Browser surface composition and interaction, independent of DOM/Canvas APIs.
mod dropdown;
mod gestures;
mod history;
pub mod hud;
mod interaction;
mod inventory_tabs;
mod inventory_item;
mod log_text;
mod mobile;
mod mobile_dialog;
mod mobile_map;
mod mobile_top;
mod repeat_count;
mod resume;
mod screens;
mod settings;
mod status;
#[cfg(test)]
mod tests;
pub mod tiles;
use crate::widgets::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const MIN_MAP_SIZE: f64 = 8.;
pub const MAX_MAP_SIZE: f64 = 128.;

pub(crate) fn s(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
pub(crate) fn n(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.)
}
pub(crate) fn b(v: &Value) -> bool {
    v.as_bool().unwrap_or(false)
}
pub(crate) fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub(crate) fn clamp(value: f64, low: f64, high: f64) -> f64 {
    value.max(low).min(high.max(low))
}
#[derive(Clone, Copy, Default, Serialize, Deserialize)]
pub struct Camera {
    pub size: f64,
    #[serde(rename = "cellH")]
    pub cell_h: f64,
    pub left: f64,
    pub top: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Copy, Serialize)]
struct Region {
    rect: Rect,
    max: f64,
}
#[derive(Clone)]
struct Drag {
    id: i64,
    scope: String,
    x: f64,
    y: f64,
    last_x: f64,
    last_y: f64,
    moved: bool,
    activated: bool,
    hit: Option<Control>,
    region: String,
}
pub struct BrowserUi {
    pub widgets: Widgets,
    model: Value,
    view: Value,
    measure: MeasureText,
    catalogs: [Value; 2],
    scope: String,
    width: f64,
    height: f64,
    fullscreen: bool,
    paint_count: u64,
    camera: Option<Camera>,
    center_key: String,
    map_rect: Option<Rect>,
    dialog_rect: Option<Rect>,
    regions: BTreeMap<String, Region>,
    scrolls: BTreeMap<String, f64>,
    follow_log: bool,
    drag: Option<Drag>,
    gestures: gestures::Gestures,
    description: String,
    active_row: Value,
    hud: hud::HudWidget,
    mobile_controls: bool,
    history_open: bool,
    status_open: bool,
    dropdown: String,
    mobile_generation: u64,
    mobile_operations: bool,
    mobile_movement: u32,
    mobile_overview: bool,
    mobile_full_map: bool,
    mobile_repeat_count: u32,
    mobile_repeat_configured: bool,
    mobile_repeat_open: bool,
    mobile_repeat_error: bool,
    inventory_tabs: inventory_tabs::InventoryTabs,
}
impl BrowserUi {
    /// Synchronize host lifecycle observations before an input event, even when
    /// its requested repaint has not run yet. Interaction rules stay in Rust.
    pub fn set_context(&mut self, model: Value) {
        self.model = model;
    }
    fn draw_hud(&mut self, map: Rect) {
        self.draw_hud_area(Rect::new(map.x, map.y, map.w - 104., map.h));
    }
    fn draw_hud_area(&mut self, map: Rect) {
        let catalog =
            self.catalogs[usize::from(self.model["language"] == "en")]["messages"].clone();
        let label = |id: &str| {
            catalog[id]
                .as_str()
                .unwrap_or_else(|| panic!("Missing HUD label: {id}"))
                .to_string()
        };
        self.hud.draw(
            &mut self.widgets,
            hud::HudData {
                map,
                name: s(&self.model["frame"]["ui"]["name"]),
                status: &self.model["frame"]["ui"]["status"],
                offset: self.scrolls["hud"],
                label: &label,
            },
            self.measure,
        );
        let row = serde_json::from_value(self.hud.layout["row"].clone()).expect("HUD row");
        self.regions.insert(
            "hud".into(),
            Region {
                rect: row,
                max: n(&self.hud.layout["maxScroll"]),
            },
        );
        self.scrolls
            .insert("hud".into(), n(&self.hud.layout["offset"]));
    }
    fn draw_hud_details(&mut self, map: Rect) {
        let enabled =
            !b(&self.model["settingsOpen"]) && !self.model["frame"]["ui"]["window"].is_object();
        self.hud
            .draw_details(&mut self.widgets, map, enabled, self.measure);
    }
    pub fn new(measure: MeasureText) -> Self {
        Self {
            widgets: Widgets::default(),
            model: Value::Null,
            view: Value::Null,
            measure,
            catalogs: [
                serde_json::from_str(include_str!("../../../../../locales/ui-web-ja.json"))
                    .expect("JA UI catalog"),
                serde_json::from_str(include_str!("../../../../../locales/ui-web-en.json"))
                    .expect("EN UI catalog"),
            ],
            scope: String::new(),
            width: 0.,
            height: 0.,
            fullscreen: false,
            paint_count: 0,
            camera: None,
            center_key: String::new(),
            map_rect: None,
            dialog_rect: None,
            regions: BTreeMap::new(),
            scrolls: ["top", "dialog", "settings", "log", "hud"]
                .into_iter()
                .map(|id| (id.into(), 0.))
                .collect(),
            follow_log: true,
            drag: None,
            gestures: gestures::Gestures::default(),
            description: String::new(),
            active_row: Value::Null,
            hud: hud::HudWidget::default(),
            mobile_controls: true,
            history_open: false,
            status_open: false,
            dropdown: String::new(),
            mobile_generation: 0,
            mobile_operations: false,
            mobile_movement: 0,
            mobile_overview: false,
            mobile_full_map: false,
            mobile_repeat_count: 1,
            mobile_repeat_configured: false,
            mobile_repeat_open: false,
            mobile_repeat_error: false,
            inventory_tabs: inventory_tabs::InventoryTabs::default(),
        }
    }
    fn t(&self, id: &str) -> String {
        self.label(id, &json!({}))
    }
    fn label(&self, id: &str, args: &Value) -> String {
        let catalog = &self.catalogs[usize::from(self.model["language"] == "en")];
        let mut text = catalog["messages"][id]
            .as_str()
            .unwrap_or_else(|| panic!("Missing UI catalog entry: {id}"))
            .to_string();
        if let Some(args) = args.as_object() {
            for (key, value) in args {
                text = text.replace(
                    &format!("{{{key}}}"),
                    &if value.is_string() {
                        s(value).into()
                    } else {
                        value.to_string()
                    },
                );
            }
        }
        text
    }
    // Screen composition shorthand; the public widget API uses Rect/TextStyle.
    #[allow(clippy::too_many_arguments)]
    fn text(
        &mut self,
        text: &str,
        x: f64,
        y: f64,
        w: f64,
        size: f64,
        color: &str,
        bold: bool,
    ) -> f64 {
        self.widgets.text(
            text,
            Rect::new(x, y, w, 0.),
            size,
            color,
            bold,
            self.measure,
        )
    }
    fn control(&mut self, id: &str, label: &str, r: Rect, action: Value, style: ControlStyle<'_>) {
        self.widgets
            .control(id, label, r, action, style, self.measure);
    }
    fn button(&mut self, id: &str, label: &str, r: Rect, style: ControlStyle<'_>) {
        self.control(id, label, r, json!({"kind":"invoke","id":id}), style);
    }
    fn field(&mut self, id: &str, r: Rect, disabled: bool) {
        self.widgets.field(
            id,
            r,
            &self.view["inputs"][id],
            disabled,
            b(&self.view["blink"]),
            self.measure,
        );
    }
    fn wrap(&self, text: &str, w: f64, size: f64) -> Vec<String> {
        Widgets::wrap(text, w, size, self.measure)
    }
    pub fn render(&mut self, model: Value, view: Value) -> Value {
        self.model = model;
        self.view = view;
        self.width = n(&self.view["width"]).max(240.);
        self.height = n(&self.view["height"]).max(240.);
        let mobile = self.width < 700. || b(&self.view["coarse"]);
        let generation = n(&self.model["generation"]) as u64;
        if b(&self.model["running"]) && generation != self.mobile_generation {
            self.mobile_controls = mobile;
            self.mobile_generation = generation;
            self.mobile_repeat_count = 1;
            self.mobile_repeat_configured = false;
            self.mobile_repeat_open = false;
        }
        if b(&self.model["topOpen"]) || b(&self.model["settingsOpen"]) {
            self.history_open = false;
            self.status_open = false;
        }
        if !b(&self.model["settingsOpen"]) && !b(&self.model["topOpen"]) {
            self.dropdown.clear();
        }
        if !mobile || b(&self.model["topOpen"]) || !b(&self.model["running"]) {
            self.mobile_operations = false;
            self.mobile_repeat_open = false;
        }
        if b(&self.model["settingsOpen"]) || self.model["frame"]["ui"]["window"].is_object()
            || b(&self.model["frame"]["ui"]["movement_direction"]) {
            self.mobile_repeat_open = false;
        }
        let scope = if self.mobile_repeat_open {
            "repeat-count".into()
        } else if self.status_open {
            "status".into()
        } else if self.history_open {
            "history".into()
        } else if b(&self.model["topOpen"]) {
            "top".into()
        } else if b(&self.model["settingsOpen"]) {
            "settings".into()
        } else if self.mobile_operations {
            "mobile-operations".into()
        } else if self.model["frame"]["ui"]["window"].is_object() {
            format!(
                "dialog:{}",
                s(&self.model["frame"]["ui"]["window"]["title"])
            )
        } else if b(&self.model["frame"]["ui"]["movement_direction"]) {
            "throw-direction".into()
        } else {
            "game".into()
        };
        if scope != self.scope {
            self.gestures = gestures::Gestures::default();
            self.hud.selected.clear();
            self.drag = None;
            self.widgets.pressed.clear();
            self.widgets.hover.clear();
            self.widgets.focus.clear();
            self.scope = scope;
            if self.scope.starts_with("dialog") {
                self.scrolls.insert("dialog".into(), 0.);
                self.active_row = Value::Null;
                if self.inventory_list_visible() { self.inventory_tabs.reveal = true; }
            }
        }
        self.fullscreen = b(&self.view["fullscreen"]) && !b(&self.model["topOpen"]);
        self.widgets.clear();
        self.regions.clear();
        self.map_rect = None;
        self.hud.layout = Value::Null;
        self.widgets
            .rect(Rect::new(0., 0., self.width, self.height), BG);
        self.animate_zoom();
        if b(&self.model["topOpen"]) {
            self.draw_top();
        } else if mobile {
            self.draw_mobile();
        } else {
            self.draw_game();
        }
        if self.history_open {
            self.draw_history();
        }
        if self.status_open {
            self.draw_status();
        }
        if self.mobile_repeat_open {
            self.draw_repeat_count();
        }
        self.draw_dropdown();
        self.paint_count += 1;
        json!({"commands":self.widgets.commands,"diagnostics":self.diagnostics(),"animate":self.zoom_animating()})
    }
    pub fn diagnostics(&self) -> Value {
        json!({"renderer":"canvas2d","uiOwner":"rust","paintCount":self.paint_count,"fullscreen":self.fullscreen,
            "pointer":{"activeId":self.drag.as_ref().map(|d|d.id),"capturedIds":self.captured_ids(),"pressedId":self.widgets.pressed,"hoverId":self.widgets.hover,"focusId":self.widgets.focus},
            "width":self.width,"height":self.height,"scope":self.scope,"statusOpen":self.status_open,"controls":self.widgets.controls,
            "text":self.widgets.text_runs.iter().map(|v|s(&v["text"])).collect::<Vec<_>>(),"icons":self.widgets.icons,"hud":self.hud.layout,
            "camera":self.camera,"mapRect":self.map_rect,"dialogRect":self.dialog_rect,"scrolls":self.scrolls,"regions":self.regions,
            "inventory":self.inventory_preference()})
    }
}
