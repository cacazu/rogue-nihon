use super::*;
#[derive(Default)]
pub struct HudWidget {
    pub selected: String,
    pub layout: Value,
    detail: Option<Metric>,
}
#[derive(Clone)]
struct Metric {
    id: String,
    icon: &'static str,
    label: String,
    values: Vec<String>,
    detail: String,
    color: &'static str,
    warning: bool,
}
struct Item {
    metric: Metric,
    text: String,
    width: f64,
}
struct Layout {
    items: Vec<Item>,
    size: f64,
    compact: u32,
    gap: f64,
    icon_size: f64,
    width: f64,
}
fn compact_number(value: &str, precision: u32) -> String {
    if let Ok(number) = value.parse::<f64>() {
        for (unit, suffix) in [(1e9, "b"), (1e6, "m"), (1e3, "k")] {
            if number.abs() >= unit {
                let factor = 10_f64.powi(precision as i32);
                return format!("{}{suffix}", (number / unit * factor).trunc() / factor);
            }
        }
    }
    value.into()
}
pub struct HudData<'a> {
    pub map: Rect,
    pub viewport_height: f64,
    pub name: &'a str,
    pub status: &'a Value,
    pub settings_disabled: bool,
    pub label: &'a dyn Fn(&str) -> String,
}
impl HudWidget {
    fn metrics(status: &Value, label: &dyn Fn(&str) -> String) -> Vec<Metric> {
        let args = &status["args"];
        let value = |index: usize| {
            let v = &args[index]["value"];
            if v.is_null() {
                "—".into()
            } else if v.is_string() {
                s(v).into()
            } else {
                v.to_string()
            }
        };
        let mut metrics = Vec::new();
        for (id, icon, indexes, color) in [
            ("depth", "stairs", &[0][..], "#b9cee8"),
            ("gold", "coins", &[1][..], "#efd18e"),
            ("hp", "heart", &[2, 3][..], "#f5a6aa"),
            ("strength", "strength", &[4, 5][..], "#d0bbef"),
            ("armor", "shield", &[6][..], "#9dcbe9"),
            ("experience", "experience", &[7, 8][..], "#a6d0be"),
        ] {
            metrics.push(Metric {
                id: id.into(),
                icon,
                label: label(&format!("hud.{id}")),
                values: indexes.iter().map(|&i| value(i)).collect(),
                detail: String::new(),
                color,
                warning: false,
            });
        }
        let term = value(9);
        let hunger = term
            .strip_prefix("status.hunger.")
            .filter(|h| matches!(*h, "0" | "1" | "2" | "3"))
            .unwrap_or("0");
        metrics.push(Metric {
            id: "hunger".into(),
            icon: "food",
            label: label("hud.hunger"),
            values: Vec::new(),
            detail: label(&format!("hud.hunger.{hunger}")),
            color: if hunger == "0" {
                ACCENT
            } else if hunger == "1" {
                "#efd18e"
            } else {
                ERROR
            },
            warning: hunger != "0",
        });
        metrics
    }
    fn measure_hud(
        metrics: &[Metric],
        size: f64,
        compact: u32,
        gap: f64,
        icon_size: f64,
        measure: MeasureText,
    ) -> Layout {
        let items: Vec<_> = metrics
            .iter()
            .map(|metric| {
                let text = metric
                    .values
                    .iter()
                    .map(|v| {
                        if compact > 0 {
                            compact_number(v, if compact == 2 { 0 } else { 1 })
                        } else {
                            v.clone()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("/");
                let width = icon_size
                    + if text.is_empty() {
                        0.
                    } else {
                        3. + (measure)(&text, size, true, false).width
                    }
                    + 4.;
                Item {
                    metric: metric.clone(),
                    text,
                    width,
                }
            })
            .collect();
        let width = items.iter().map(|i| i.width).sum::<f64>() + (items.len() - 1) as f64 * gap;
        Layout {
            items,
            size,
            compact,
            gap,
            icon_size,
            width,
        }
    }
    pub fn draw(&mut self, widgets: &mut Widgets, data: HudData<'_>, measure: MeasureText) {
        let HudData {
            map,
            viewport_height,
            name,
            status,
            settings_disabled,
            label,
        } = data;
        let short = viewport_height < 500.;
        let panel = Rect::new(
            map.x + 12.,
            map.y + 12.,
            map.w - 24.,
            if short { 60. } else { 78. },
        );
        let header = if short { 26. } else { 36. };
        widgets.box_rect(panel, "#101b20ef", Some(LINE), 9.);
        widgets.control(
            "settings-toggle",
            &label("action.settings"),
            Rect::new(panel.x + 4., panel.y + 3., 36., header),
            json!({"kind":"invoke","id":"settings-toggle"}),
            ControlStyle {
                icon: Some("settings"),
                icon_size: 22.,
                disabled: settings_disabled,
                ..Default::default()
            },
            measure,
        );
        widgets.begin_clip(panel);
        widgets.single_line(
            name,
            Rect::new(panel.x + 50., panel.y + 3., panel.w - 60., header),
            LineStyle {
                text: TextStyle::new(13., ACCENT, true),
                center: false,
                ellipsis: true,
            },
            measure,
        );
        widgets.end_clip();
        let row = Rect::new(
            panel.x + 6.,
            panel.y + header + 6.,
            panel.w - 12.,
            if short { 26. } else { 32. },
        );
        let metrics = Self::metrics(status, label);
        let mut layout = Self::measure_hud(&metrics, 10., 2, 2., 14., measure);
        'choose: for compact in [0, 1, 2] {
            for size in [13., 12., 11., 10.] {
                layout = Self::measure_hud(
                    &metrics,
                    size,
                    compact,
                    if size >= 12. { 6. } else { 2. },
                    if size >= 12. { 16. } else { 14. },
                    measure,
                );
                if layout.width <= row.w {
                    break 'choose;
                }
            }
        }
        let scale = (row.w / layout.width).min(1.);
        let gap = layout.gap * scale;
        let extra = (row.w - layout.width * scale).max(0.) / layout.items.len() as f64;
        let mut x = row.x;
        let mut items = Vec::new();
        widgets.begin_clip(row);
        for item in &layout.items {
            let metric = &item.metric;
            let w = item.width * scale + extra;
            let r = Rect::new(x, row.y, w, row.h);
            let id = format!("hud-{}", metric.id);
            let icon_size = layout.icon_size * scale;
            let content_x = x + extra / 2.;
            widgets.control(
                &id,
                &metric.label,
                r,
                json!({"kind":"hud","id":metric.id}),
                ControlStyle {
                    flat: true,
                    custom: true,
                    ..Default::default()
                },
                measure,
            );
            let icon = widgets.icon(
                metric.icon,
                Rect::new(
                    content_x + 2.,
                    row.y + (row.h - icon_size) / 2.,
                    icon_size,
                    icon_size,
                ),
                metric.color,
            );
            let value = widgets.single_line(
                &item.text,
                Rect::new(
                    content_x + icon_size + if item.text.is_empty() { 2. } else { 5. },
                    row.y,
                    (item.width * scale - icon_size - 5.).max(0.),
                    row.h,
                ),
                LineStyle {
                    text: TextStyle::new(layout.size * scale, TEXT, true),
                    center: false,
                    ellipsis: false,
                },
                measure,
            );
            if metric.warning {
                widgets.circle(content_x + icon_size + 1., row.y + 5., 2.5, metric.color);
            }
            items.push(json!({"id":metric.id,"label":metric.label,"text":item.text,"values":metric.values,"rect":r,"iconRect":icon,"valueRect":value,"size":layout.size*scale}));
            x += w + gap;
        }
        widgets.end_clip();
        self.layout = json!({"panel":panel,"row":row,"items":items,"compact":layout.compact>0,"tooltip":null});
        self.detail = metrics
            .iter()
            .find(|metric| {
                format!("hud-{}", metric.id) == widgets.hover
                    || format!("hud-{}", metric.id) == widgets.focus
            })
            .or_else(|| metrics.iter().find(|metric| metric.id == self.selected))
            .cloned();
    }
    pub fn draw_details(
        &mut self,
        widgets: &mut Widgets,
        map: Rect,
        enabled: bool,
        measure: MeasureText,
    ) {
        if !enabled {
            return;
        }
        let Some(active) = self.detail.clone() else {
            return;
        };
        let panel: Rect = serde_json::from_value(self.layout["panel"].clone()).expect("HUD panel");
        let detail = if active.detail.is_empty() {
            active.values.join(" / ")
        } else {
            active.detail
        };
        let text = format!("{}：{detail}", active.label);
        let w = panel.w.min(
            150_f64.max(
                Widgets::wrap(&text, panel.w - 24., 12., measure)
                    .iter()
                    .map(|line| (measure)(line, 12., false, false).width)
                    .fold(0_f64, f64::max)
                    + 24.,
            ),
        );
        let h = Widgets::wrap(&text, w - 24., 12., measure).len() as f64 * 20. + 20.;
        let item = array(&self.layout["items"])
            .iter()
            .find(|i| i["id"] == active.id)
            .expect("HUD item");
        let r: Rect = serde_json::from_value(item["rect"].clone()).expect("HUD rectangle");
        let obstacles: Vec<_> = widgets
            .controls
            .iter()
            .filter(|c| c.id.starts_with("touch-"))
            .map(|c| c.rect)
            .collect();
        let y = (panel.y + panel.h + 5.).min(map.y + map.h - h - 4.);
        let preferred = r.x + (r.w - w) / 2.;
        let mut xs = vec![preferred];
        for r in &obstacles {
            xs.extend([r.x + r.w + 6., r.x - w - 6.]);
        }
        xs.extend([panel.x, panel.x + panel.w - w]);
        let candidates: Vec<_> = xs
            .iter()
            .map(|&x| Rect::new(clamp(x, panel.x, panel.x + panel.w - w), y, w, h))
            .collect();
        let r = candidates
            .iter()
            .find(|r| obstacles.iter().all(|&o| !r.overlaps(o)))
            .copied()
            .unwrap_or(candidates[0]);
        widgets.box_rect(r, PANEL, Some(active.color), 9.);
        widgets.text(
            &text,
            Rect::new(r.x + 12., r.y + 10., w - 24., 0.),
            12.,
            TEXT,
            false,
            measure,
        );
        self.layout["tooltip"] = json!({"id":active.id,"text":text,"rect":r});
    }
}
