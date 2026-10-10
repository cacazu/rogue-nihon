//! Browser surface composition and interaction, independent of DOM/Canvas APIs.
pub mod hud;
mod interaction;
mod screens;
#[cfg(test)]
mod tests;
pub mod tiles;
use crate::widgets::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

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
    description: String,
    active_row: Value,
    hud: hud::HudWidget,
}
impl BrowserUi {
    /// Synchronize host lifecycle observations before an input event, even when
    /// its requested repaint has not run yet. Interaction rules stay in Rust.
    pub fn set_context(&mut self, model: Value) {
        self.model = model;
    }
    fn draw_hud(&mut self, map: Rect) {
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
            description: String::new(),
            active_row: Value::Null,
            hud: hud::HudWidget::default(),
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
        let scope = if b(&self.model["topOpen"]) {
            "top".into()
        } else if b(&self.model["settingsOpen"]) {
            "settings".into()
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
            self.hud.selected.clear();
            self.drag = None;
            self.widgets.pressed.clear();
            self.widgets.hover.clear();
            self.widgets.focus.clear();
            self.scope = scope;
            if self.scope.starts_with("dialog") {
                self.scrolls.insert("dialog".into(), 0.);
                self.active_row = Value::Null;
            }
        }
        self.fullscreen = b(&self.view["fullscreen"]) && !b(&self.model["topOpen"]);
        self.widgets.clear();
        self.regions.clear();
        self.map_rect = None;
        self.hud.layout = Value::Null;
        self.widgets
            .rect(Rect::new(0., 0., self.width, self.height), BG);
        if !self.fullscreen {
            let playing = !b(&self.model["topOpen"]);
            let inline_fullscreen = self.width >= 500.;
            let title = self.t("app.heading");
            let title_width = self.width
                - if playing {
                    if inline_fullscreen { 136. } else { 88. }
                } else {
                    32.
                };
            let mut title_size = if self.width < 700. { 24. } else { 30. };
            while title_size > 18.
                && (self.measure)(&title, title_size, true, false).width > title_width
            {
                title_size -= 1.;
            }
            self.widgets.single_line(
                &title,
                Rect::new(16., 12., title_width, 48.),
                LineStyle {
                    text: TextStyle::new(title_size, TEXT, true),
                    center: false,
                    ellipsis: true,
                },
                self.measure,
            );
            if playing {
                self.settings_button(Rect::new(
                    self.width - if inline_fullscreen { 108. } else { 60. },
                    14.,
                    44.,
                    44.,
                ));
                if inline_fullscreen {
                    self.button(
                        "header-fullscreen",
                        &self.t("action.fullscreen"),
                        Rect::new(self.width - 60., 14., 44., 44.),
                        ControlStyle {
                            icon: Some("expand"),
                            icon_size: 24.,
                            ..Default::default()
                        },
                    );
                }
            }
            self.footer();
        }
        if b(&self.model["topOpen"]) {
            self.draw_top();
        } else {
            self.draw_game();
        }
        self.paint_count += 1;
        json!({"commands":self.widgets.commands,"diagnostics":self.diagnostics()})
    }
    pub fn diagnostics(&self) -> Value {
        json!({"renderer":"canvas2d","uiOwner":"rust","paintCount":self.paint_count,"fullscreen":self.fullscreen,
            "pointer":{"activeId":self.drag.as_ref().map(|d|d.id),"pressedId":self.widgets.pressed,"hoverId":self.widgets.hover,"focusId":self.widgets.focus},
            "width":self.width,"height":self.height,"scope":self.scope,"controls":self.widgets.controls,
            "text":self.widgets.text_runs.iter().map(|v|s(&v["text"])).collect::<Vec<_>>(),"icons":self.widgets.icons,"hud":self.hud.layout,
            "camera":self.camera,"mapRect":self.map_rect,"dialogRect":self.dialog_rect,"scrolls":self.scrolls,"regions":self.regions})
    }
}
