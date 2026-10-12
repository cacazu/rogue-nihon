//! Compact phone status and a complete window share the public HUD data.
use super::*;
include!(concat!(env!("OUT_DIR"), "/experience_levels.rs"));

impl BrowserUi {
    fn status_metrics(&self) -> Vec<hud::Metric> {
        hud::HudWidget::metrics(&self.model["frame"]["ui"]["status"], &|id| {
            self.t(match id {
                "hud.depth" => "status.depth",
                "hud.hp" => "status.hp",
                "hud.hunger" => "status.hunger",
                _ => id,
            })
        })
    }

    fn status_icon(&mut self, metric: &hud::Metric, rect: Rect) {
        match metric.icon {
            "strength" => {
                self.widgets
                    .glyph_icon("strength", "💪", rect, metric.color, self.measure);
            }
            "level" => {
                self.widgets
                    .glyph_icon("level", "👑", rect, metric.color, self.measure);
            }
            _ => {
                self.widgets.icon(metric.icon, rect, metric.color);
            }
        }
    }

    pub(super) fn open_status(&mut self) {
        self.status_open = true;
        self.mobile_operations = false;
        self.scrolls.insert("status".into(), 0.);
    }

    pub(super) fn draw_mobile_status(&mut self, rect: Rect) {
        let metrics = self.status_metrics();
        let metric = |id: &str| metrics.iter().find(|m| m.id == id).expect("status metric");
        let depth = metric("depth");
        let hp = metric("hp");
        let armor = metric("armor");
        let hunger = metric("hunger");
        let strength = metric("strength");
        let gold = metric("gold");
        let level = metric("level");
        let experience = metric("experience");
        let depth_value = &depth.values[0];
        let hp_value = hp.values.join("/");
        let armor_value = &armor.values[0];
        let gold_value = hud::compact_number(&gold.values[0], 1);
        let strength_value = &strength.values[0];
        let value_width = |text: &str| (self.measure)(text, 17., true, false).width + 20.;
        let depth_width = value_width(depth_value);
        let hunger_width = value_width(&hunger.detail).max(value_width(&gold_value));
        let ability_width = value_width(armor_value).max(value_width(strength_value));
        let min_gauge_width = (self.measure)(&hp_value, 17., true, false)
            .width
            .max((self.measure)(&level.values[0], 17., true, false).width)
            + 8.;
        let gauge_width =
            (rect.w - 8. - depth_width - ability_width - hunger_width - 32.).max(min_gauge_width);
        let content_width = 8. + depth_width + gauge_width + ability_width + hunger_width + 32.;
        let max = (content_width - rect.w).max(0.);
        let offset = clamp(self.scrolls["hud"], 0., max);
        let depth_x = rect.x + 4. - offset;
        let gauge_x = depth_x + depth_width + 24.;
        let ability_x = gauge_x + gauge_width + 4.;
        let hunger_x = ability_x + ability_width + 4.;
        let top = Rect::new(rect.x, rect.y, rect.w, 24.);
        let bottom = Rect::new(rect.x, rect.y + 24., rect.w, 24.);
        let hp_gauge = Rect::new(gauge_x, top.y + 4., gauge_width, 16.);
        let exp_gauge = Rect::new(gauge_x, bottom.y + 4., gauge_width, 16.);
        self.regions.insert("hud".into(), Region { rect, max });
        self.scrolls.insert("hud".into(), offset);
        self.widgets.begin_clip(rect);
        let content_start = self.widgets.commands.len();
        let depth_cell = self.draw_status_cell(
            depth,
            depth_value,
            Rect::new(depth_x, top.y, depth_width, top.h),
            false,
        );
        let armor_cell = self.draw_status_cell(
            armor,
            armor_value,
            Rect::new(ability_x, bottom.y, ability_width, bottom.h),
            false,
        );
        let hunger_cell = self.draw_status_cell(
            hunger,
            &hunger.detail,
            Rect::new(hunger_x, top.y, hunger_width, top.h),
            false,
        );
        let strength_cell = self.draw_status_cell(
            strength,
            strength_value,
            Rect::new(ability_x, top.y, ability_width, top.h),
            false,
        );
        let gold_cell = self.draw_status_cell(
            gold,
            &gold_value,
            Rect::new(hunger_x, bottom.y, hunger_width, bottom.h),
            false,
        );
        let current_hp = hp.values[0].parse::<f64>().unwrap_or(0.);
        let max_hp = hp.values[1].parse::<f64>().unwrap_or(0.);
        let hp_progress = if max_hp > 0. {
            clamp(current_hp / max_hp, 0., 1.)
        } else {
            0.
        };
        self.draw_status_gauge(hp_gauge, hp_progress, hp.color);
        let hp_label = self.draw_status_cell(
            hp,
            &hp_value,
            Rect::new(gauge_x, top.y, gauge_width, top.h),
            true,
        );
        let level_index = level.values[0].parse::<usize>().unwrap_or(1).max(1) - 1;
        let current = experience.values[0].parse::<i64>().unwrap_or(0);
        let previous = level_index
            .checked_sub(1)
            .and_then(|i| EXPERIENCE_LEVELS.get(i))
            .copied()
            .unwrap_or(0);
        let next = EXPERIENCE_LEVELS.get(level_index).copied();
        let progress = next.map_or(1., |next| {
            clamp(
                (current - previous) as f64 / (next - previous) as f64,
                0.,
                1.,
            )
        });
        self.draw_status_gauge(exp_gauge, progress, experience.color);
        let level_label = self.draw_status_cell(
            level,
            &level.values[0],
            Rect::new(gauge_x, bottom.y, gauge_width, bottom.h),
            true,
        );
        for command in &mut self.widgets.commands[content_start..] {
            if matches!(s(&command["op"]), "text" | "path") {
                command["outline"] = json!({"color":"#000","width":2.});
            }
        }
        self.widgets.end_clip();
        self.widgets.hit_target(
            "status-open",
            &self.t("status.title"),
            rect,
            json!({"kind":"status","open":true}),
        );
        self.hud.layout = json!({"row":rect,"rows":[top,bottom],"metrics":["depth","hp","strength","hunger","level","experience","armor","gold"],
            "items":{"depth":depth_cell,"armor":armor_cell,"hunger":hunger_cell,"strength":strength_cell,"gold":gold_cell},
            "hp":{"rect":hp_gauge,"current":current_hp,"maximum":max_hp,"progress":hp_progress,"label":hp_label},
            "experience":{"rect":exp_gauge,"current":current,"previous":previous,"next":next,"progress":progress,"label":level_label},
            "rowEnd":hunger_x+hunger_width,"fontSize":17,"offset":offset,"maxScroll":max});
    }

    fn draw_status_cell(
        &mut self,
        metric: &hud::Metric,
        value: &str,
        row: Rect,
        center: bool,
    ) -> Value {
        let text_width = (self.measure)(value, 17., true, false).width;
        let x = if center { row.x - 20. } else { row.x };
        let icon_rect = Rect::new(x, row.y + 3., 18., 18.);
        self.status_icon(metric, icon_rect);
        let text_rect = self.widgets.single_line(
            value,
            if center {
                row
            } else {
                Rect::new(x + 20., row.y, text_width, row.h)
            },
            LineStyle {
                text: TextStyle::new(17., if center { TEXT } else { metric.color }, true),
                center,
                ellipsis: false,
            },
            self.measure,
        );
        json!({"rect":row,"iconRect":icon_rect,"textRect":text_rect,"text":value})
    }

    fn draw_status_gauge(&mut self, rect: Rect, progress: f64, color: &str) {
        self.widgets.box_rect(rect, "#0008", Some("#000"), 3.);
        if progress > 0. {
            self.widgets.box_rect(
                Rect::new(
                    rect.x + 1.,
                    rect.y + 1.,
                    (rect.w - 2.) * progress,
                    rect.h - 2.,
                ),
                color,
                None,
                2.,
            );
        }
    }
    pub(super) fn draw_status(&mut self) {
        self.widgets.controls.clear();
        self.regions.clear();
        self.map_rect = None;
        self.widgets
            .rect(Rect::new(0., 0., self.width, self.height), "#0009");
        let width = (self.width - 16.).min(540.);
        let x = (self.width - width) / 2.;
        self.widgets.box_rect(
            Rect::new(x, 8., width, self.height - 16.),
            PANEL,
            Some(LINE),
            12.,
        );
        self.text(
            &self.t("status.title"),
            x + 16.,
            24.,
            width - 88.,
            22.,
            TEXT,
            true,
        );
        self.control(
            "status-close",
            &self.t("action.cancel_short"),
            Rect::new(x + width - 56., 16., 48., 48.),
            json!({"kind":"status","open":false}),
            ControlStyle {
                icon: Some("close"),
                icon_size: 24.,
                ..Default::default()
            },
        );
        let viewport = Rect::new(x + 16., 76., width - 32., self.height - 100.);
        let offset = *self.scrolls.get("status").unwrap_or(&0.);
        let mut row = viewport.y - offset;
        self.widgets.begin_clip(viewport);
        let name = s(&self.model["frame"]["ui"]["name"]).to_string();
        self.widgets
            .icon("person", Rect::new(viewport.x, row + 9., 24., 24.), TEXT);
        self.status_row(&self.t("form.name"), &name, viewport, row);
        row += 50.;
        for metric in self.status_metrics() {
            let value = if metric.values.is_empty() {
                metric.detail.clone()
            } else {
                metric.values.join(" / ")
            };
            self.status_icon(&metric, Rect::new(viewport.x, row + 9., 24., 24.));
            self.status_row(&metric.label, &value, viewport, row);
            row += 50.;
        }
        self.widgets.end_clip();
        let total = row - viewport.y + offset;
        let max = (total - viewport.h).max(0.);
        self.regions.insert(
            "status".into(),
            Region {
                rect: viewport,
                max,
            },
        );
        self.scrolls.insert("status".into(), clamp(offset, 0., max));
        self.widgets.scrollbar(viewport, total, offset);
    }

    fn status_row(&mut self, name: &str, value: &str, viewport: Rect, y: f64) {
        let value_x = viewport.x + viewport.w * 0.5;
        let style = || LineStyle {
            text: TextStyle::new(17., TEXT, false),
            center: false,
            ellipsis: true,
        };
        self.widgets.single_line(
            name,
            Rect::new(viewport.x + 34., y, value_x - viewport.x - 38., 44.),
            style(),
            self.measure,
        );
        self.widgets.single_line(
            value,
            Rect::new(value_x, y, viewport.w * 0.5, 44.),
            style(),
            self.measure,
        );
    }
}
