//! Phone composition. Uses the existing controller actions and game descriptors;
//! this component never changes the game input decoder or window contents.
use super::*;

const TARGET: f64 = 48.;
const FONT: f64 = 17.;

impl BrowserUi {
    pub(super) fn left_handed(&self) -> bool {
        self.model["handedness"] == "left"
    }

    /// All candidates come from the current public frame. The phone uses the
    /// first; desktop can show every applicable operation without replacing Search.
    pub(super) fn map_context_commands(&self) -> Vec<(u32, &'static str)> {
        let frame = &self.model["frame"];
        let ui = &frame["ui"];
        let mut commands = Vec::new();
        if b(&ui["map_controls"]["stairs"]["ascend"]) {
            commands.push((60, "mobile.ascend"));
        }
        if b(&ui["map_controls"]["stairs"]["descend"]) {
            commands.push((62, "action.descend_short"));
        }
        if frame["map_player_surface"]["tile"].as_u64().is_some_and(|tile| (14..=22).contains(&tile))
            && !b(&ui["player_state"]["levitating"]) {
            commands.push((44, "mobile.pickup"));
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
            commands.push((94, "mobile.trap"));
        }
        commands
    }

    pub(super) fn mobile_context_command(&self) -> (u32, &'static str) {
        self.map_context_commands().into_iter().next().unwrap_or((115, "mobile.search"))
    }

    pub(super) fn mobile_activate(&mut self, control: &Control, effects: &mut Vec<Value>) -> bool {
        match control.id.as_str() {
            "mobile-controls" => {
                self.mobile_controls = !self.mobile_controls;
                self.mobile_operations = false;
                effects.push(json!({"kind":"invoke","id":"settings-close"}));
                true
            }
            "mobile-operations-close" => {
                self.mobile_operations = false;
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
            id if id.starts_with("mobile-system-") => {
                if b(&self.model["running"]) && !b(&self.model["savePending"]) {
                    effects.push(json!({"kind":"invoke","id":"settings-close"}));
                    effects.push(control.action.clone());
                }
                true
            }
            id if id.starts_with("mobile-op-") => {
                if control.action["kind"] != "web" { self.mobile_operations = false; }
                false
            }
            _ => false,
        }
    }

    pub(super) fn draw_mobile(&mut self) {
        let game = Rect::new(0., 0., self.width, self.height);
        let dock = self.mobile_controls
            && b(&self.model["running"])
            && !self.model["frame"]["ui"]["window"].is_object();
        let dock_height = if dock { if self.width < 360. { 256. } else { 184. } } else { 0. };
        let bow = dock && b(&self.model["frame"]["ui"]["ranged"]["bow"]);
        let fire_height = if bow { 58. } else { 0. };
        let map = Rect::new(
            0.,
            0.,
            self.width,
            (self.height - 64. - dock_height - fire_height).max(1.),
        );
        self.map_rect = Some(map);
        self.regions
            .insert("map".into(), Region { rect: map, max: 0. });
        self.widgets.rect(map, MAP);
        if self.model["frame"].is_object() {
            self.draw_map(map);
            self.draw_status_bar(Rect::new(0., 8., self.width - 64., 48.));
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
            if bow {
                let y = self.height - dock_height - fire_height;
                self.widgets.rect(Rect::new(0., y, self.width, fire_height), BG);
                let ready = self.model["input"]["kind"] == "command"
                    && self.model["frame"]["ui"]["ranged"]["arrow_key"].as_u64().is_some_and(|key| (97..=122).contains(&key));
                self.web_control(
                    WebAction::Fire, "touch-fire", &self.t("mobile.fire"),
                    Rect::new(12., y + 3., self.width - 24., 52.),
                    ControlStyle { size: FONT, role: ControlRole::Command, disabled: !ready, ..Default::default() },
                );
            }
            self.mobile_dock(self.height - dock_height);
        }
        if b(&self.model["loading"]) {
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
        self.web_control(
            WebAction::Settings, "settings-toggle",
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
            .filter(|e| matches!(s(&e["source"]), "game" | "system") && !b(&e["transient_prompt"]) && !b(&e["mobile_keyboard_hint"]) && !s(&e["text"]).trim().is_empty())
        {
            for line in self.log_lines(&self.log_runs(entry,true),width,FONT).into_iter().rev() {
                if !line.is_empty() {
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
            lines = self.log_lines(&[json!({"text":self.t("mobile.message_history")})],width,FONT);
            lines.truncate(2);
        }
        for (i, line) in lines.iter().enumerate() {
            self.draw_log_line(line,12.,y+6.+i as f64*26.,FONT,ACCENT);
        }
    }

    pub(super) fn mobile_help(&self, id: &str) -> String {
        let text =
            crate::display::message_language(id, &json!([]), "", s(&self.model["language"])).text;
        let text = text.split_once('\t').map_or(text.as_str(), |(_, text)| text);
        text.rsplit_once(['：', ':'])
            .map_or(text, |(_, text)| text).trim().to_string()
    }

    fn mobile_command(&mut self, id: &str, key: u32, label: &str, r: Rect, disabled: bool) {
        self.control(
            id,
            label,
            r,
            json!({"kind":"send","key":key}),
            ControlStyle {
                size: FONT,
                role: ControlRole::Command,
                highlight: id == "touch-search" && key != 115,
                left: self.mobile_operations,
                shortcut: if self.mobile_operations { self.pc_shortcut(&char::from_u32(key).unwrap().to_string()) } else { None },
                keep_offscreen: self.mobile_operations,
                key: Some(json!(key)),
                disabled,
                ..Default::default()
            },
        );
    }

    pub(super) fn mobile_movement_control(&mut self, rect: Rect) {
        let label = self.t(match self.mobile_movement {
            1 => "mobile.run",
            2 => "mobile.run_adjacent",
            _ => "mobile.step",
        });
        self.web_control(
            WebAction::Movement, "mobile-movement",
            &label,
            rect,
            ControlStyle {
                size: FONT,
                custom: true,
                ..Default::default()
            },
        );
        self.widgets.begin_control_content(!self.web_available(WebAction::Movement));
        let caption = Widgets::shortcut_label(&label, self.pc_shortcut(web_command(WebAction::Movement).key).as_deref());
        self.widgets.single_line(
            &caption,
            Rect::new(rect.x + 2., rect.y, rect.w - 4., rect.h),
            LineStyle {
                text: TextStyle::new(FONT.min(FONT * (rect.w - 8.) / (self.measure)(&caption,FONT,false,false).width.max(1.)), TEXT, false),
                center: true,
                ellipsis: false,
            },
            self.measure,
        );
        self.widgets.end_control_content();
    }

    fn mobile_dock(&mut self, y: f64) {
        self.widgets
            .rect(Rect::new(0., y, self.width, self.height - y), BG);
        let ui = self.model["frame"]["ui"].clone();
        let direction = b(&ui["movement_direction"]);
        let mirrored = self.left_handed();
        let pad_x = if mirrored { self.width - 180. } else { 12. };
        let pad_y = y + (self.height - y - 168.)/2.;
        let row_height = if self.width < 360. { 76. } else { 52. };
        let row_step = row_height + 6.;
        for a in array(&ui["map_controls"]["directions"]) {
            let key = n(&a["key"]) as u32;
            let emitted = self.movement_key(key);
            let label = if key == 46 {
                self.t("mobile.wait")
            } else {
                s(&a["text"]).to_string()
            };
            self.control(
                &format!("touch-{}", char::from_u32(key).unwrap_or(' ')),
                &label,
                Rect::new(
                    pad_x + n(&a["column"]) * 58.,
                    pad_y + n(&a["row"]) * 58.,
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
        let screen_width = self.width;
        let place = |rect: Rect| if mirrored { Rect::new(screen_width - rect.x - rect.w,rect.y,rect.w,rect.h) } else { rect };
        if direction {
            for action in array(&ui["map_controls"]["actions"]) {
                self.mobile_command(
                    &format!("touch-action-{}", s(&action["id"])),
                    n(&action["key"]) as u32,
                    &self.t("action.cancel_short"),
                    place(Rect::new(x, y + 8., w, row_height)),
                    false,
                );
            }
            return;
        }
        let cell_width = (w - 8.) / 2.;
        self.mobile_movement_control(place(Rect::new(x, y + 8., cell_width, row_height)));
        self.mobile_command(
            "touch-action-action.inventory",
            105,
            &self.t("action.inventory"),
            place(Rect::new(x + cell_width + 8., y + 8., cell_width, row_height)),
            false,
        );
        let (context_key, context_label) = self.mobile_context_command();
        self.mobile_command(
            "touch-search",
            context_key,
            &self.t(context_label),
            place(Rect::new(x, y + 8. + row_step, cell_width, row_height)),
            false,
        );
        self.web_control(
            WebAction::FullMap, "mobile-full-map",
            &self.t("mobile.full_map"),
            place(Rect::new(x + cell_width + 8., y + 8. + row_step, cell_width, row_height)),
            ControlStyle {size:FONT,..Default::default()},
        );
        self.web_control(
            WebAction::Commands, "mobile-operations",
            &self.t("action.help"),
            place(Rect::new(x, y + 8. + row_step*2., cell_width, row_height)),
            ControlStyle {size:FONT,..Default::default()},
        );
        self.draw_repeat_button(place(Rect::new(x + cell_width + 8., y + 8. + row_step*2., cell_width, row_height)));
    }
    fn mobile_operations_sheet(&mut self, game: Rect) {
        self.begin_choices("mobile-operations");
        self.regions.clear();
        self.map_rect = None;
        self.widgets.rect(game, "@overlay.strong");
        // Keep every operation in its group. Availability never removes its row.
        let groups: Vec<_> = commands::GROUPS.iter().filter_map(|(title, entries)| {
            let originals = entries.iter().filter_map(|entry| {
                let (key, action) = match entry.phone_action? {
                    commands::GameAction::Key(key) => (key,json!({"kind":"send","key":key})),
                    commands::GameAction::Direction(key) => (key,json!({"kind":"movement","key":key})),
                };
                Some((format!("mobile-op-{key}"), self.mobile_help(entry.description), action, Some(key), None))
            });
            let web = WEB_COMMANDS.iter().filter(|command| command.group == *title).map(|command|
                (format!("mobile-op-web-{}", command.id), self.t(command.label),
                 json!({"kind":"web","id":command.id}), None, Some(command.action)));
            let operations: Vec<_> = originals.chain(web).collect();
            (!operations.is_empty()).then_some((*title, operations))
        }).collect();
        let total = groups.iter().map(|(_, operations)| 36. + operations.len() as f64 * 60. + 12.).sum::<f64>() - 24.;
        let (panel, viewport) = self.sheet_layout(self.width - 16., total);

        self.widgets.box_rect(
            panel,
            PANEL,
            Some(LINE),
            0.,
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
                shortcut: self.pc_shortcut("Escape"),
                ..Default::default()
            },
        );
        let max = (total - viewport.h).max(0.);
        let scroll = clamp(*self.scrolls.get("mobile-operations").unwrap_or(&0.), 0., max);
        let mut row = viewport.y - scroll;
        self.widgets.begin_clip(viewport);
        for (title, operations) in &groups {
            self.text(&self.t(title), viewport.x, row + 6., viewport.w, FONT, ACCENT, true);
            row += 36.;
            for (id, label, action, key, web) in operations {
                let ui = &self.model["frame"]["ui"];
                let available = self.command_ready() && match key {
                    Some(60) => b(&ui["map_controls"]["stairs"]["ascend"]),
                    Some(62) => b(&ui["map_controls"]["stairs"]["descend"]),
                    Some(44) => !b(&ui["player_state"]["levitating"]) && self.model["frame"]["map_player_surface"]["tile"].as_u64().is_some_and(|tile| (14..=22).contains(&tile)),
                    _ => true,
                } && web.is_none_or(|action| self.web_available(action));
                self.control(id, label, Rect::new(viewport.x, row, viewport.w, TARGET), action.clone(),
                    ControlStyle { size:FONT, left:true, role:ControlRole::Command,
                        key:key.map(|key| json!(key)), disabled:!available, keep_offscreen:true,
                        shortcut: if let Some(action) = web { self.pc_shortcut(web_command(*action).key) }
                            else { key.and_then(|key| char::from_u32(key)).and_then(|key| self.pc_shortcut(&key.to_string())) },
                        ..Default::default() });
                row += 60.;
            }
            row += 12.;
        }
        self.widgets.end_clip();

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
