//! Browser surface composition and interaction, independent of DOM/Canvas APIs.
mod actions;
mod commands;
mod control_preferences;
mod controls_editor;
mod keybindings;
mod desktop;
mod direction_overlay;
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
mod projectiles;
mod repeat_count;
mod resume;
mod screens;
mod settings;
mod status;
mod tombstone;
#[cfg(test)]
mod tests;
pub mod tiles;
pub mod pixels;
use crate::widgets::*;
use actions::{WebAction, WEB_COMMANDS, web_command};
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
    controls_preferences: control_preferences::ControlsPreferences,
    binding_capture: Option<keybindings::BindingCapture>,
    direction_origin: Option<direction_overlay::DirectionOrigin>,
    keyboard_dispatch: bool,
    controls_editor: Option<controls_editor::ControlEditor>,
    dock_targets: Vec<controls_editor::DockTarget>,
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
    hover_point: Option<(f64, f64)>,
    active_row: Value,
    hud: hud::HudWidget,
    mobile_controls: bool,
    commands_open: bool,
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
    selection_tabs: inventory_tabs::InventoryTabs,
    selection_context: String,
}
impl BrowserUi {
    pub(super) fn pc_controls(&self)->bool {!b(&self.view["coarse"])}
    /// Synchronize host lifecycle observations before an input event, even when
    /// its requested repaint has not run yet. Interaction rules stay in Rust.
    pub fn set_context(&mut self, model: Value) {
        let generation_changed = self.model["generation"] != model["generation"];
        self.model = model;
        if generation_changed || !b(&self.model["settingsOpen"]) { self.controls_editor=None; }
        if generation_changed || self.model["frame"]["ui"]["input"]["kind"] != "item" { self.selection_context.clear(); }
        if generation_changed { self.hover_point = None;self.binding_capture=None; }
        self.sync_direction_origin();
        self.sync_direction_window();
        if generation_changed || !self.wait_available() {
            self.stop_hold();
            self.gestures.wait_key.clear();
        }
    }
    fn sync_direction_window(&mut self) {
        if !self.mobile_controls && !self.pc_controls() && b(&self.model["frame"]["ui"]["movement_direction"])
            && self.model["frame"]["ui"]["window"].is_null()
        {
            // The map pad is optional, but every C direction wait needs a
            // visible selector. Reuse the ordinary dialog actions/shortcuts.
            let mut ui = self.model["frame"]["ui"].clone();
            ui["movement_direction"] = json!(false);
            self.model["frame"]["ui"]["window"] = crate::game_window::render(&ui, s(&self.model["language"]));
        }
    }
    pub fn new(measure: MeasureText) -> Self {
        Self {
            widgets: Widgets::default(),
            model: Value::Null,
            controls_preferences: control_preferences::ControlsPreferences::default(),
            binding_capture: None,
            direction_origin: None,
            keyboard_dispatch: false,
            controls_editor: None,
            dock_targets: Vec::new(),
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
            hover_point: None,
            active_row: Value::Null,
            hud: hud::HudWidget::default(),
            mobile_controls: true,
            commands_open: false,
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
            selection_tabs: inventory_tabs::InventoryTabs::default(),
            selection_context: String::new(),
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
    // A scrollable sheet follows its measured content until the viewport is full.
    // Keep its header and edge padding identical across settings, status and history.
    fn sheet_layout(&self, width: f64, content_height: f64) -> (Rect, Rect) {
        let x = (self.width - width) / 2.;
        let height = (68. + content_height + 16.).ceil().min(self.height - 16.);
        let panel = Rect::new(x, 8., width, height);
        let viewport = Rect::new(x + 16., 76., width - 32., (height - 84.).max(1.));
        (panel, viewport)
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
    /// A choice owns the same shortcut in its visible label and activation.
    fn pc_shortcut(&self, key: &str) -> Option<String> {
        (!b(&self.view["coarse"])).then(|| key.to_string())
    }
    fn choice_shortcut(&self, index: usize) -> Option<String> {
        u8::try_from(index).ok().filter(|index| *index < 26)
            .and_then(|index| self.pc_shortcut(&((b'a' + index) as char).to_string()))
    }
    fn shortcut_context(&self, scope: &str) -> Value {
        if self.binding_capture.is_some() {return json!("key-binding");}
        match scope {
            "dialog" => json!([scope, self.model["generation"], self.model["input"], self.model["frame"]["ui"]["window"]]),
            "dropdown" => json!([scope, self.dropdown]),
            _ => json!(scope),
        }
    }
    fn begin_choices(&mut self, scope: &str) {
        self.widgets.controls.clear();
        self.widgets.shortcut_context = self.shortcut_context(scope);
    }
    fn control(&mut self, id: &str, label: &str, r: Rect, action: Value, style: ControlStyle<'_>) {
        self.widgets
            .control(id, label, r, action, style, self.measure);
    }
    fn button(&mut self, id: &str, label: &str, r: Rect, style: ControlStyle<'_>) {
        self.control(id, label, r, json!({"kind":"invoke","id":id}), style);
    }
    fn field_error_text(&self, id: &str) -> String {
        let error = &self.model["fieldErrors"][id];
        if error["id"].is_string() { self.label(s(&error["id"]), &error["args"]) } else { String::new() }
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
        if self.model["generation"] != model["generation"] || b(&model["topOpen"]) { self.hover_point = None; }
        self.model = model;
        self.widgets.theme = crate::theme::Theme::named(s(&self.model["theme"]));
        self.view = view;
        let old_size=(self.width,self.height);
        self.width = n(&self.view["width"]).max(240.);
        self.height = n(&self.view["height"]).max(240.);
        let mobile = self.width < 700. || b(&self.view["coarse"]);
        let form=self.control_form();
        if self.controls_editor.as_ref().is_some_and(|editor|editor.form!=form) {self.controls_editor=None;}
        if old_size!=(self.width,self.height) {
            if let Some(editor)=self.controls_editor.as_mut() {editor.drag=None;}
            self.widgets.pressed.clear();
        }
        self.widgets.fit_control_captions = b(&self.view["coarse"]);
        if !self.item_selection_visible() { self.selection_context.clear(); }
        let generation = n(&self.model["generation"]) as u64;
        if b(&self.model["running"]) && generation != self.mobile_generation {
            self.mobile_controls = true;
            self.mobile_generation = generation;
            self.mobile_repeat_count = 1;
            self.mobile_repeat_configured = false;
            self.mobile_repeat_open = false;
        }
        self.sync_direction_origin();
        self.sync_direction_window();
        if b(&self.model["topOpen"]) || b(&self.model["settingsOpen"]) {
            self.commands_open = false;
            self.history_open = false;
            self.status_open = false;
        }
        if !b(&self.model["settingsOpen"]) && !b(&self.model["topOpen"]) {
            self.dropdown.clear();
        }
        if !mobile || b(&self.model["topOpen"]) || !b(&self.model["running"]) {
            self.mobile_operations = false;
        }
        if b(&self.model["topOpen"]) || !b(&self.model["running"]) {
            self.mobile_repeat_open = false;
        }
        if b(&self.model["settingsOpen"]) || self.model["frame"]["ui"]["window"].is_object()
            || b(&self.model["frame"]["ui"]["movement_direction"]) {
            self.mobile_repeat_open = false;
        }
        let scope = if self.controls_editor.is_some() {
            "controls-editor".into()
        } else if self.mobile_repeat_open {
            "repeat-count".into()
        } else if self.commands_open {
            "commands".into()
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
                if self.inventory_list_visible() { self.list_tabs_mut().reveal = true; }
            }
        }
        self.fullscreen = b(&self.view["fullscreen"]) && !b(&self.model["topOpen"]);
        self.widgets.clear();
        self.dock_targets.clear();
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
        if self.commands_open {
            self.draw_commands();
        }
        if self.pc_controls() && b(&self.model["frame"]["ui"]["movement_direction"]) && !b(&self.model["settingsOpen"]) && !self.commands_open && !self.history_open && !self.status_open && !self.mobile_repeat_open {self.draw_desktop_direction();}
        self.draw_dropdown();
        if self.controls_editor.is_some() {self.draw_controls_editor();}
        if self.binding_capture.is_some() {self.draw_binding_capture();}
        // Resolve color annotations attached after a widget was painted.
        for command in &mut self.widgets.commands { self.widgets.theme.paint(command); }
        self.paint_count += 1;
        let mut result = json!({"diagnostics":self.diagnostics(),"animate":self.zoom_animating()});
        result["commands"] = Value::Array(std::mem::take(&mut self.widgets.commands));
        result
    }
    pub fn diagnostics(&self) -> Value {
        json!({"renderer":"canvas2d","uiOwner":"rust","paintCount":self.paint_count,"fullscreen":self.fullscreen,
            "pointer":{"activeId":self.drag.as_ref().map(|d|d.id),"capturedIds":self.captured_ids(),"pressedId":self.widgets.pressed,"hoverId":self.widgets.hover,"focusId":self.widgets.focus},
            "width":self.width,"height":self.height,"scope":self.scope,"statusOpen":self.status_open,"controls":self.widgets.controls,
            "text":self.widgets.text_runs.iter().map(|v|s(&v["text"])).collect::<Vec<_>>(),"icons":self.widgets.icons,"hud":self.hud.layout,
            "camera":self.camera,"mapRect":self.map_rect,"dialogRect":self.dialog_rect,"scrolls":self.scrolls,"regions":self.regions,
            "inventory":self.inventory_preference(),"directionOrigin":self.direction_origin.as_ref().map(|origin|json!({"control":origin.control,"point":origin.point,"seen":origin.seen})),"controlsEditor":self.controls_editor.as_ref().map(|editor|json!({"mode":format!("{:?}",editor.mode),"form":editor.form,"selected":editor.selected,"draft":editor.draft}))})
    }
}
