//! Phone composition. Uses the existing controller actions and game descriptors;
//! this component never changes the game input decoder or window contents.
use super::*;

const TARGET: f64 = 48.;
const FONT: f64 = 17.;

impl BrowserUi {
    fn mobile_button(&mut self, id: &str, label: &str, r: Rect, disabled: bool) {
        self.button(
            id,
            label,
            r,
            ControlStyle {
                size: FONT,
                disabled,
                ..Default::default()
            },
        );
    }

    fn mobile_context_command(&self) -> (u32, &'static str) {
        let frame = &self.model["frame"];
        let ui = &frame["ui"];
        if b(&ui["map_controls"]["stairs"]["ascend"]) {
            return (60, "mobile.ascend");
        }
        if b(&ui["map_controls"]["stairs"]["descend"]) {
            return (62, "action.descend_short");
        }
        if frame["map_player_surface"]["tile"].as_u64().is_some_and(|tile| (14..=22).contains(&tile))
            && !b(&ui["player_state"]["levitating"]) {
            return (44, "mobile.pickup");
        }
        let x = frame["player"]["x"].as_i64().unwrap_or(-10);
        let y = frame["player"]["y"].as_i64().unwrap_or(-10);
        let width = frame["width"].as_i64().unwrap_or(80).max(1);
        let height = frame["height"].as_i64().unwrap_or(24);
        let nearby_trap = array(&frame["map_tiles"]).iter().enumerate().any(|(index, tile)| {
            let px = index as i64 % width;
            let py = index as i64 / width;
            tile == 7 && py > 0 && py < height - 1 && (px-x).abs() <= 1 && (py-y).abs() <= 1
        });
        if frame["map_player_surface"]["tile"] == 7 || nearby_trap {
            return (94, "mobile.trap");
        }
        (115, "mobile.search")
    }

    pub(super) fn mobile_activate(&mut self, control: &Control, effects: &mut Vec<Value>) -> bool {
        match control.id.as_str() {
            "mobile-controls" => {
                self.mobile_controls = !self.mobile_controls;
                self.mobile_operations = false;
                effects.push(json!({"kind":"invoke","id":"settings-close"}));
                true
            }
            "mobile-operations" => {
                self.mobile_operations = true;
                self.scrolls.insert("mobile-operations".into(), 0.);
                true
            }
            "mobile-operations-close" => {
                self.mobile_operations = false;
                true
            }
            "mobile-movement" => {
                self.mobile_movement = (self.mobile_movement + 1) % 3;
                true
            }
            "touch-again" => {
                if self.model["input"]["kind"] == "command" && !self.mobile_repeat_open {
                    let mut keys = if self.mobile_repeat_count > 1 {
                        self.mobile_repeat_count.to_string().bytes().map(u32::from).collect::<Vec<_>>()
                    } else { Vec::new() };
                    keys.push(97);
                    effects.push(json!({"kind":"send","keys":keys}));
                }
                true
            }
            "repeat-count-close" => {
                self.mobile_repeat_open = false;
                effects.push(json!({"kind":"canvas-focus"}));
                true
            }
            "repeat-count-submit" => {
                effects.push(json!({"kind":"submit","id":"repeat-count"}));
                true
            }
            "mobile-map" => {
                self.mobile_full_map = false;
                self.mobile_overview = !self.mobile_overview;
                self.center_key.clear();
                true
            }
            "mobile-full-map" => {
                self.mobile_full_map = !self.mobile_full_map;
                self.mobile_overview = self.mobile_full_map;
                self.mobile_operations = false;
                self.center_key.clear();
                true
            }
            id if id.starts_with("mobile-system-") => {
                if b(&self.model["running"]) && !b(&self.model["savePending"]) {
                    effects.push(json!({"kind":"invoke","id":"settings-close"}));
                    effects.push(control.action.clone());
                }
                true
            }
            id if id.starts_with("mobile-op-") => {
                self.mobile_operations = false;
                false
            }
            _ => false,
        }
    }

    pub(super) fn draw_mobile(&mut self) {
        let game = Rect::new(0., 0., self.width, self.height);
        if b(&self.model["topOpen"]) {
            self.draw_mobile_top();
        } else {
            let dock = self.mobile_controls
                && b(&self.model["running"])
                && !self.model["frame"]["ui"]["window"].is_object();
            let dock_height = if dock { 184. } else { 0. };
            let map = Rect::new(
                0.,
                0.,
                self.width,
                (self.height - 64. - dock_height).max(1.),
            );
            self.map_rect = Some(map);
            self.regions
                .insert("map".into(), Region { rect: map, max: 0. });
            self.widgets.rect(map, MAP);
            if self.model["frame"].is_object() {
                self.draw_map(map);
                self.draw_mobile_status(Rect::new(0., 8., self.width - 64., 48.));
                if !self.model["frame"]["ui"]["window"].is_object()
                    && !b(&self.model["settingsOpen"])
                {
                    self.mobile_message(map.y + map.h);
                }
            }
            if self.model["frame"]["ui"]["window"].is_object() && !b(&self.model["settingsOpen"]) {
                // Same window renderer, rows, actions and input as the desktop UI.
                self.draw_dialog(game);
            }
            if dock && !b(&self.model["settingsOpen"]) {
                self.mobile_dock(self.height - dock_height);
            }
            if !self.model["frame"].is_object() {
                self.text(
                    &self.t("notice.loading"),
                    24.,
                    (self.height / 2. - 24.).max(80.),
                    self.width - 48.,
                    FONT,
                    MUTED,
                    false,
                );
            }
        }
        if b(&self.model["topOpen"]) {
            let fullscreen = b(&self.view["fullscreen"]);
            self.top_language_control(Rect::new(self.width - 56., 8., TARGET, TARGET));
            self.button(
                "header-fullscreen",
                &self.t(if fullscreen {
                    "action.exit_fullscreen"
                } else {
                    "action.fullscreen"
                }),
                Rect::new(self.width - 56., 8., TARGET, TARGET),
                ControlStyle {
                    icon: Some(if fullscreen { "collapse" } else { "expand" }),
                    icon_size: 24.,
                    ..Default::default()
                },
            );
        } else {
            self.button(
                "settings-toggle",
                &self.t("action.settings"),
                Rect::new(self.width - 56., 8., TARGET, TARGET),
                ControlStyle {
                    icon: Some("settings"),
                    icon_size: 22.,
                    ..Default::default()
                },
            );
            self.widgets
                .icon("expand", Rect::new(self.width - 52., 12., 40., 40.), TEXT);
        }
        if self.mobile_operations && !b(&self.model["settingsOpen"]) {
            self.mobile_operations_sheet(game);
        }
        if b(&self.model["settingsOpen"]) {
            self.draw_settings(game);
        }
    }

    fn mobile_message(&mut self, y: f64) {
        // The message area opens history without a game command.
        let width = self.width - 24.;
        self.history_target(Rect::new(0., y, self.width, 64.));
        let mut lines = Vec::new();
        for entry in array(&self.model["entries"])
            .iter()
            .rev()
            .filter(|e| e["source"] == "game" && !s(&e["text"]).trim().is_empty())
        {
            for line in self.wrap(s(&entry["text"]), width, FONT).into_iter().rev() {
                if !line.trim().is_empty() {
                    lines.push(line);
                }
                if lines.len() == 2 {
                    break;
                }
            }
            if lines.len() == 2 {
                break;
            }
        }
        lines.reverse();
        if lines.is_empty() {
            lines = self.wrap(&self.t("mobile.message_history"), width, FONT);
            lines.truncate(2);
        }
        for (i, line) in lines.iter().enumerate() {
            self.widgets.single_line(
                line,
                Rect::new(12., y + 6. + i as f64 * 26., width, 26.),
                LineStyle {
                    text: TextStyle::new(FONT, ACCENT, false),
                    center: false,
                    ellipsis: true,
                },
                self.measure,
            );
        }
    }

    pub(super) fn mobile_help(&self, id: &str) -> String {
        let text =
            crate::display::message_language(id, &json!([]), "", s(&self.model["language"])).text;
        text.rsplit_once('：')
            .map_or(text.trim_start_matches(':'), |(_, text)| text)
            .to_string()
    }

    fn mobile_command(&mut self, id: &str, key: u32, label: &str, r: Rect, disabled: bool) {
        self.control(
            id,
            label,
            r,
            json!({"kind":"send","key":key}),
            ControlStyle {
                size: FONT,
                key: Some(json!(key)),
                disabled,
                ..Default::default()
            },
        );
    }

    fn mobile_movement_control(&mut self, rect: Rect) {
        let label = self.t(match self.mobile_movement {
            1 => "mobile.run",
            2 => "mobile.run_adjacent",
            _ => "mobile.step",
        });
        self.control(
            "mobile-movement",
            &label,
            rect,
            json!({"kind":"invoke","id":"mobile-movement"}),
            ControlStyle {
                size: FONT,
                custom: true,
                ..Default::default()
            },
        );
        self.widgets.single_line(
            &label,
            Rect::new(rect.x + 2., rect.y, rect.w - 4., rect.h),
            LineStyle {
                text: TextStyle::new(FONT, TEXT, false),
                center: true,
                ellipsis: false,
            },
            self.measure,
        );
    }

    fn mobile_dock(&mut self, y: f64) {
        self.widgets
            .rect(Rect::new(0., y, self.width, self.height - y), BG);
        let ui = self.model["frame"]["ui"].clone();
        let direction = b(&ui["movement_direction"]);
        for a in array(&ui["map_controls"]["directions"]) {
            let key = n(&a["key"]) as u32;
            let emitted = if direction || key == 46 {
                key
            } else {
                match self.mobile_movement {
                    1 => key - 32,
                    2 => key | rogue_contract::RG_EVENT_CTRL,
                    _ => key,
                }
            };
            let label = if key == 46 {
                self.t("mobile.wait")
            } else {
                s(&a["text"]).to_string()
            };
            self.control(
                &format!("touch-{}", char::from_u32(key).unwrap_or(' ')),
                &label,
                Rect::new(
                    12. + n(&a["column"]) * 58.,
                    y + 8. + n(&a["row"]) * 58.,
                    52.,
                    52.,
                ),
                json!({"kind":"send","key":emitted}),
                ControlStyle {
                    size: if key == 46 { FONT } else { 26. },
                    key: Some(json!(emitted)),
                    throw_direction: direction,
                    ..Default::default()
                },
            );
        }
        let x = if self.width >= 320. { 192. } else { 176. };
        let w = self.width - x - 12.;
        if direction {
            for action in array(&ui["map_controls"]["actions"]) {
                self.mobile_command(
                    &format!("touch-action-{}", s(&action["id"])),
                    n(&action["key"]) as u32,
                    &self.t("action.cancel_short"),
                    Rect::new(x, y + 8., w, 52.),
                    false,
                );
            }
            return;
        }
        let cell_width = (w - 8.) / 2.;
        self.mobile_movement_control(Rect::new(x, y + 8., cell_width, 52.));
        self.mobile_command(
            "touch-action-action.inventory",
            105,
            &self.t("action.inventory"),
            Rect::new(x + cell_width + 8., y + 8., cell_width, 52.),
            false,
        );
        let (context_key, context_label) = self.mobile_context_command();
        self.mobile_command(
            "touch-search",
            context_key,
            &self.t(context_label),
            Rect::new(x, y + 66., cell_width, 52.),
            false,
        );
        self.mobile_button(
            "mobile-full-map",
            &self.t("mobile.full_map"),
            Rect::new(x + cell_width + 8., y + 66., cell_width, 52.),
            false,
        );
        self.mobile_button(
            "mobile-operations",
            &self.t("action.help"),
            Rect::new(x, y + 124., cell_width, 52.),
            false,
        );
        self.draw_repeat_button(Rect::new(x + cell_width + 8., y + 124., cell_width, 52.));
    }
    fn mobile_operations_sheet(&mut self, game: Rect) {
        self.widgets.controls.clear();
        self.regions.clear();
        self.map_rect = None;
        self.widgets.rect(game, "#0009");
        self.widgets.box_rect(
            Rect::new(8., 8., self.width - 16., self.height - 16.),
            PANEL,
            Some(LINE),
            12.,
        );
        self.text(
            &self.t("action.help"),
            24.,
            24.,
            self.width - 96.,
            22.,
            TEXT,
            true,
        );
        self.button(
            "mobile-operations-close",
            &self.t("action.cancel_short"),
            Rect::new(self.width - 64., 16., TARGET, TARGET),
            ControlStyle {
                icon: Some("close"),
                icon_size: 24.,
                ..Default::default()
            },
        );
        let viewport = Rect::new(24., 76., self.width - 48., self.height - 104.);
        let scroll = *self.scrolls.get("mobile-operations").unwrap_or(&0.);
        let mut row = viewport.y - scroll;
        self.widgets.begin_clip(viewport);
        let context_key = self.mobile_context_command().0;
        for (title, operations) in [
            ("mobile.group.movement", &[
                (109, "help.move_without_pickup"), (44, "help.pickup"),
                (115, "help.search"), (94, "help.trap"),
                (62, "help.downstairs"), (60, "help.upstairs"),
            ][..]),
            ("mobile.group.combat", &[
                (102, "help.fight_carefully"), (70, "help.fight_to_death"),
            ][..]),
        ] {
            self.text(&self.t(title), viewport.x, row + 6., viewport.w, FONT, ACCENT, true);
            row += 36.;
            for (key, label) in operations {
                let ui = &self.model["frame"]["ui"];
                if *key == context_key || (*key == 60 && !b(&ui["player_state"]["amulet"])) {
                    continue;
                }
                let stair_disabled = match key {
                    60 => !b(&ui["map_controls"]["stairs"]["ascend"]),
                    62 => !b(&ui["map_controls"]["stairs"]["descend"]),
                    _ => false,
                };
                self.mobile_command(
                    &format!("mobile-op-{key}"), *key, &self.mobile_help(label),
                    Rect::new(viewport.x, row, viewport.w, TARGET),
                    !b(&self.model["running"]) || stair_disabled,
                );
                row += 60.;
            }
            row += 12.;
        }
        self.widgets.end_clip();
        let total = row - viewport.y + scroll;
        let max = (total - viewport.h).max(0.);
        self.regions.insert(
            "mobile-operations".into(),
            Region {
                rect: viewport,
                max,
            },
        );
        self.scrolls
            .insert("mobile-operations".into(), clamp(scroll, 0., max));
        self.widgets.scrollbar(viewport, total, scroll);
    }
}
