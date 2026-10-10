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
    separator: &'static str,
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
    gap: f64,
    separator_width: f64,
}
struct Layout {
    items: Vec<Item>,
    size: f64,
    compact: u32,
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
    pub name: &'a str,
    pub status: &'a Value,
    pub offset: f64,
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
            ("level", "level", &[7][..], "#a6d0be"),
            ("experience", "experience", &[8][..], "#a6d0be"),
        ] {
            metrics.push(Metric {
                id: id.into(),
                icon,
                separator: if id == "experience" { "=" } else { "" },
                label: label(&format!("hud.{id}")),
                values: indexes
                    .iter()
                    .map(|&i| {
                        let value = value(i);
                        if id == "depth" {
                            value
                                .parse::<u32>()
                                .map(|depth| {
                                    if depth == 0 {
                                        "0".into()
                                    } else {
                                        format!("-{depth}")
                                    }
                                })
                                .unwrap_or(value)
                        } else {
                            value
                        }
                    })
                    .collect(),
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
            separator: "",
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
            .enumerate()
            .map(|(index, metric)| {
                let values = metric
                    .values
                    .iter()
                    .map(|v| {
                        if compact > 0 {
                            compact_number(v, if compact == 2 { 0 } else { 1 })
                        } else {
                            v.clone()
                        }
                    })
                    .collect::<Vec<_>>();
                let text = values.join("/");
                let separator_width = if metric.separator.is_empty() {
                    0.
                } else {
                    (measure)(metric.separator, size, true, false).width + 2.
                };
                let width = separator_width
                    + icon_size
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
                    gap: if index == 0 || !metric.separator.is_empty() {
                        0.
                    } else {
                        gap
                    },
                    separator_width,
                }
            })
            .collect();
        let width = items.iter().map(|i| i.width + i.gap).sum::<f64>();
        Layout {
            items,
            size,
            compact,
            icon_size,
            width,
        }
    }
    pub fn draw(&mut self, widgets: &mut Widgets, data: HudData<'_>, measure: MeasureText) {
        let HudData {
            map,
            name,
            status,
            offset,
            label,
        } = data;
        let panel = Rect::new(map.x + 8., map.y + 8., map.w - 16., 48.);
        let row = Rect::new(panel.x + 8., panel.y + 4., panel.w - 16., 40.);
        let size = if map.w < 700. { 18. } else { 20. };
        let gap = 10.;
        let name_width = (measure)(name, size, true, false)
            .width
            .min((row.w * 0.25).clamp(64., 160.));
        let metrics = Self::metrics(status, label);
        let mut layout = Self::measure_hud(&metrics, size, 0, gap, 22., measure);
        if metrics
            .iter()
            .flat_map(|metric| &metric.values)
            .any(|value| {
                value
                    .parse::<f64>()
                    .is_ok_and(|number| number.abs() >= 1000.)
            })
        {
            layout = Self::measure_hud(&metrics, size, 1, gap, 22., measure);
        }
        let content_width = name_width + gap + layout.width;
        let max_scroll = (content_width - row.w).max(0.);
        let offset = offset.clamp(0., max_scroll);
        let name_rect = Rect::new(row.x - offset, row.y, name_width, row.h);
        widgets.box_rect(panel, "#101b20ef", Some(LINE), 9.);
        widgets.begin_clip(row);
        let name_value = widgets.single_line(
            name,
            name_rect,
            LineStyle {
                text: TextStyle::new(size, ACCENT, true),
                center: false,
                ellipsis: true,
            },
            measure,
        );
        let mut x = name_rect.x + name_width + gap;
        let mut items = Vec::new();
        for item in &layout.items {
            x += item.gap;
            let metric = &item.metric;
            let w = item.width;
            let r = Rect::new(x, row.y, w, row.h);
            let id = format!("hud-{}", metric.id);
            let icon_size = layout.icon_size;
            let content_x = x + item.separator_width;
            widgets.control(
                &id,
                &metric.label,
                r,
                json!({"kind":"hud","id":metric.id}),
                ControlStyle {
                    flat: true,
                    custom: true,
                    keep_offscreen: true,
                    ..Default::default()
                },
                measure,
            );
            let separator = if metric.separator.is_empty() {
                None
            } else {
                Some(widgets.single_line(
                    metric.separator,
                    Rect::new(x, row.y, item.separator_width, row.h),
                    LineStyle {
                        text: TextStyle::new(layout.size, TEXT, true),
                        center: false,
                        ellipsis: false,
                    },
                    measure,
                ))
            };
            let icon_rect = Rect::new(
                content_x + 2.,
                row.y + (row.h - icon_size) / 2.,
                icon_size,
                icon_size,
            );
            let icon = match metric.icon {
                "strength" => {
                    widgets.glyph_icon("strength", "💪", icon_rect, metric.color, measure)
                }
                "level" => widgets.glyph_icon("level", "👑", icon_rect, metric.color, measure),
                "experience" => {
                    widgets.glyph_icon("experience", "☆", icon_rect, metric.color, measure)
                }
                _ => widgets.icon(metric.icon, icon_rect, metric.color),
            };
            let value = widgets.single_line(
                &item.text,
                Rect::new(
                    content_x + icon_size + if item.text.is_empty() { 2. } else { 5. },
                    row.y,
                    (item.width - item.separator_width - icon_size - 5.).max(0.),
                    row.h,
                ),
                LineStyle {
                    text: TextStyle::new(layout.size, TEXT, true),
                    center: false,
                    ellipsis: false,
                },
                measure,
            );
            if metric.warning {
                widgets.circle(content_x + icon_size + 1., row.y + 5., 2.5, metric.color);
            }
            items.push(json!({"id":metric.id,"label":metric.label,"text":item.text,"values":metric.values,"separator":metric.separator,"separatorRect":separator,"rect":r,"iconRect":icon,"valueRect":value,"size":layout.size}));
            x += w;
        }
        widgets.end_clip();
        if max_scroll > 0. {
            let track = Rect::new(row.x, panel.y + panel.h - 4., row.w, 2.);
            widgets.rect(track, LINE);
            let width = row.w * row.w / content_width;
            widgets.rect(
                Rect::new(
                    track.x + (track.w - width) * offset / max_scroll,
                    track.y,
                    width,
                    track.h,
                ),
                ACCENT,
            );
        }
        self.layout = json!({"panel":panel,"row":row,"nameRect":name_rect,"nameValueRect":name_value,"items":items,"contentWidth":content_width,"offset":offset,"maxScroll":max_scroll,"compact":layout.compact>0,"tooltip":null});
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
                Widgets::wrap(&text, panel.w - 24., 16., measure)
                    .iter()
                    .map(|line| (measure)(line, 16., false, false).width)
                    .fold(0_f64, f64::max)
                    + 24.,
            ),
        );
        let h = Widgets::wrap(&text, w - 24., 16., measure).len() as f64 * 27. + 20.;
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
            16.,
            TEXT,
            false,
            measure,
        );
        self.layout["tooltip"] = json!({"id":active.id,"text":text,"rect":r});
    }
}
