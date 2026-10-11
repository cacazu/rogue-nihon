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
            "mobile-map" => {
                self.mobile_full_map = false;
                self.mobile_overview = !self.mobile_overview;
                self.center_key.clear();
                true
            }
            "mobile-full-map" => {
                self.mobile_full_map = true;
                self.mobile_overview = true;
                self.mobile_operations = false;
                self.center_key.clear();
                true
            }
            "mobile-rest" => {
                self.mobile_rest_activate(effects);
                true
            }
            "mobile-log" => {
                self.mobile_log = !self.mobile_log;
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
        let dock = self.mobile_controls
            && b(&self.model["running"])
            && !self.model["frame"]["ui"]["window"].is_object();
        let dock_height = if dock { 184. } else { 0. };
        let map = Rect::new(
            0.,
            64.,
            self.width,
            (self.height - 148. - dock_height).max(1.),
        );
        self.map_rect = Some(map);
        self.regions
            .insert("map".into(), Region { rect: map, max: 0. });
        self.widgets.rect(map, MAP);
        if self.model["frame"].is_object() {
            self.draw_map(map);
            self.mobile_status(map.y + map.h);
            if !self.model["frame"]["ui"]["window"].is_object() && !b(&self.model["settingsOpen"]) {
                self.mobile_message();
            }
        }
        if self.model["frame"]["ui"]["window"].is_object() && !b(&self.model["settingsOpen"]) {
            // Same window renderer, rows, actions and input as the desktop UI.
            self.draw_dialog(game);
        }
        if dock && !b(&self.model["settingsOpen"]) {
            self.mobile_dock(self.height - dock_height);
        }
        self.button(
            "header-fullscreen",
            &self.t(if b(&self.view["fullscreen"]) {
                "action.exit_fullscreen"
            } else {
                "action.fullscreen"
            }),
            Rect::new(self.width - 112., 8., TARGET, TARGET),
            ControlStyle {
                icon: Some(if b(&self.view["fullscreen"]) {
                    "collapse"
                } else {
                    "expand"
                }),
                icon_size: 24.,
                ..Default::default()
            },
        );
        self.button(
            "settings-toggle",
            &self.t("action.settings"),
            Rect::new(self.width - 56., 8., TARGET, TARGET),
            ControlStyle {
                icon: Some("settings"),
                icon_size: 26.,
                ..Default::default()
            },
        );
        if self.mobile_operations && !b(&self.model["settingsOpen"]) {
            self.mobile_operations_sheet(game);
        }
        if b(&self.model["settingsOpen"]) {
            self.mobile_settings(game);
        }
    }

    fn mobile_status(&mut self, y: f64) {
        let args = self.model["frame"]["ui"]["status"]["args"].clone();
        let v = |i: usize| args[i]["value"].as_i64().unwrap_or(0);
        let en = self.model["language"] == "en";
        self.widgets.rect(Rect::new(0., y, self.width, 84.), PANEL);
        let first = if en {
            format!(
                "Depth {}   HP {}/{}   XL {} / {}",
                v(0),
                v(2),
                v(3),
                v(7),
                v(8)
            )
        } else {
            format!(
                "地下{}階   HP {}/{}   経験 {}/{}",
                v(0),
                v(2),
                v(3),
                v(7),
                v(8)
            )
        };
        let second = if en {
            format!("Gold {}   Str {}/{}   Armor {}", v(1), v(4), v(5), v(6))
        } else {
            format!("金 {}   腕力 {}/{}   防御 {}", v(1), v(4), v(5), v(6))
        };
        self.text(&first, 12., y + 4., self.width - 24., FONT, TEXT, true);
        self.text(&second, 12., y + 30., self.width - 24., FONT, MUTED, false);
        let hunger = s(&args[9]["value"])
            .strip_prefix("status.hunger.")
            .filter(|h| matches!(*h, "0" | "1" | "2" | "3"))
            .unwrap_or("0");
        let color = match hunger {
            "0" => ACCENT,
            "1" => "#efd18e",
            _ => ERROR,
        };
        self.text(
            &self.t(&format!("hud.hunger.{hunger}")),
            12.,
            y + 56.,
            self.width - 24.,
            FONT,
            color,
            true,
        );
    }

    fn mobile_message(&mut self) {
        // The current result belongs to the game screen; history stays in settings.
        let message = array(&self.model["entries"])
            .iter()
            .rfind(|e| e["source"] == "game" && !s(&e["text"]).is_empty())
            .map(|e| s(&e["text"]).to_string())
            .unwrap_or_default();
        let width = self.width - 132.;
        let lines = self.wrap(&message, width, FONT);
        for (i, line) in lines.iter().take(2).enumerate() {
            let text = if i == 1 && lines.len() > 2 {
                format!("{line}…")
            } else {
                line.clone()
            };
            self.widgets.single_line(
                &text,
                Rect::new(12., 6. + i as f64 * 26., width, 26.),
                LineStyle {
                    text: TextStyle::new(FONT, ACCENT, false),
                    center: false,
                    ellipsis: true,
                },
                self.measure,
            );
        }
    }

    fn mobile_settings(&mut self, game: Rect) {
        self.widgets.controls.clear();
        self.regions.clear();
        self.map_rect = None;
        self.widgets.rect(game, "#0009");
        let panel = Rect::new(8., 8., self.width - 16., self.height - 16.);
        self.widgets.box_rect(panel, PANEL, Some(LINE), 12.);
        self.text(
            &self.t("settings.title"),
            24.,
            24.,
            panel.w - 80.,
            22.,
            TEXT,
            true,
        );
        self.button(
            "settings-close",
            &self.t("action.close_settings"),
            Rect::new(self.width - 64., 16., TARGET, TARGET),
            ControlStyle {
                icon: Some("close"),
                icon_size: 24.,
                ..Default::default()
            },
        );
        if self.mobile_log {
            self.draw_log(Rect::new(16., 76., self.width - 32., self.height - 148.));
            self.mobile_button(
                "mobile-log",
                &self.t("action.cancel_short"),
                Rect::new(24., self.height - 64., self.width - 48., TARGET),
                false,
            );
            return;
        }
        let viewport = Rect::new(24., 76., self.width - 48., self.height - 104.);
        let mut row = viewport.y - self.scrolls["settings"];
        self.widgets.begin_clip(viewport);
        let top = b(&self.model["topOpen"]);
        let busy = b(&self.model["starting"]) || b(&self.model["savePending"]);
        if !top {
            self.mobile_button(
                "mobile-controls",
                &self.t(if self.mobile_controls {
                    "mobile.hide_controls"
                } else {
                    "mobile.show_controls"
                }),
                Rect::new(viewport.x, row, viewport.w, TARGET),
                !b(&self.model["running"]),
            );
            row += 60.;
        }
        if top {
            for id in ["name", "seed"] {
                self.text(
                    &self.t(&format!("form.{id}")),
                    viewport.x,
                    row,
                    viewport.w,
                    FONT,
                    MUTED,
                    false,
                );
                row += 30.;
                self.field(
                    id,
                    Rect::new(viewport.x, row, viewport.w - 104., TARGET),
                    busy,
                );
                self.mobile_button(
                    &format!("random-{id}"),
                    &self.t("action.random"),
                    Rect::new(viewport.x + viewport.w - 96., row, 96., TARGET),
                    busy,
                );
                row += 60.;
            }
            self.mobile_button(
                "new-game",
                &self.t("action.new"),
                Rect::new(viewport.x, row, viewport.w, TARGET),
                busy || !b(&self.model["ready"]),
            );
            row += 60.;
        } else {
            self.mobile_button(
                "save",
                &self.t("action.save"),
                Rect::new(viewport.x, row, viewport.w, TARGET),
                busy || !b(&self.model["running"]) || b(&self.model["returnAfterEnd"]),
            );
            row += 60.;
        }
        self.mobile_button(
            if top { "load" } else { "settings-load" },
            &self.t("action.load"),
            Rect::new(viewport.x, row, viewport.w, TARGET),
            busy || !b(&self.model["saved"]),
        );
        row += 60.;
        if b(&self.model["saved"]) {
            self.mobile_button(
                "download-save",
                &self.t("action.download"),
                Rect::new(viewport.x, row, viewport.w, TARGET),
                busy,
            );
            row += 60.;
        }
        self.mobile_button(
            "import-save",
            &self.t("action.import"),
            Rect::new(viewport.x, row, viewport.w, TARGET),
            busy,
        );
        row += 60.;
        if !top {
            self.mobile_button(
                "mobile-log",
                &self.t("mobile.log"),
                Rect::new(viewport.x, row, viewport.w, TARGET),
                false,
            );
            row += 60.;
        }
        let notice = array(&self.model["entries"])
            .iter()
            .rfind(|e| e["source"] == "system")
            .map(|e| s(&e["text"]).to_string())
            .unwrap_or_default();
        if !notice.is_empty() {
            row += self.text(&notice, viewport.x, row, viewport.w, FONT, ACCENT, false) + 12.;
        }
        self.text(
            &self.t("form.language"),
            viewport.x,
            row,
            viewport.w,
            FONT,
            MUTED,
            false,
        );
        row += 30.;
        for (i, lang) in ["ja", "en"].iter().enumerate() {
            self.control(
                &format!("language-{lang}"),
                &self.t(&format!("language.{lang}")),
                Rect::new(
                    viewport.x + i as f64 * (viewport.w + 8.) / 2.,
                    row,
                    (viewport.w - 8.) / 2.,
                    TARGET,
                ),
                json!({"kind":"select","id":"language","value":lang}),
                ControlStyle {
                    size: FONT,
                    primary: self.model["language"] == *lang,
                    disabled: busy || !top,
                    ..Default::default()
                },
            );
        }
        row += 60.;
        self.text(
            &self.t("form.display_mode"),
            viewport.x,
            row,
            viewport.w,
            FONT,
            MUTED,
            false,
        );
        row += 30.;
        for (i, mode) in ["ascii", "tiles", "pixels"].iter().enumerate() {
            self.control(
                &format!("view-{mode}"),
                &self.t(&format!("view.{mode}")),
                Rect::new(
                    viewport.x + i as f64 * (viewport.w + 8.) / 3.,
                    row,
                    (viewport.w - 16.) / 3.,
                    TARGET,
                ),
                json!({"kind":"select","id":"display-mode","value":mode}),
                ControlStyle {
                    size: FONT,
                    primary: self.model["displayMode"] == *mode,
                    ..Default::default()
                },
            );
        }
        row += 60.;
        if self.model["displayMode"] != "ascii" {
            self.text(
                &format!(
                    "{} {}%",
                    self.t("form.zoom"),
                    (n(&self.model["tileSize"]) / 32. * 100.).round()
                ),
                viewport.x,
                row,
                viewport.w,
                FONT,
                ACCENT,
                false,
            );
            row += 30.;
            let r = Rect::new(viewport.x, row, viewport.w, TARGET);
            self.control(
                "tile-zoom",
                "",
                r,
                json!({"kind":"zoom"}),
                ControlStyle {
                    kind: Some("slider"),
                    ..Default::default()
                },
            );
            self.widgets
                .rect(Rect::new(r.x + 14., r.y + 22., r.w - 28., 4.), "#527769");
            let sizes = self.zoom_sizes();
            let index = sizes
                .iter()
                .position(|&v| v == n(&self.model["tileSize"]))
                .unwrap_or(0);
            self.widgets.circle(
                r.x + 14. + (r.w - 28.) * index as f64 / (sizes.len() - 1) as f64,
                r.y + 24.,
                10.,
                ACCENT,
            );
            row += 60.;
        }
        for (id, label) in [
            ("center-map", "action.center"),
            (
                "fullscreen",
                if b(&self.view["fullscreen"]) {
                    "action.exit_fullscreen"
                } else {
                    "action.fullscreen"
                },
            ),
            ("settings-top", "action.top"),
            ("credits-repository", "credits.repository"),
        ] {
            self.mobile_button(
                id,
                &self.t(label),
                Rect::new(viewport.x, row, viewport.w, TARGET),
                busy,
            );
            row += 60.;
        }
        if !top {
            for (key, label) in [
                (111, "help.options"),
                (81, "help.quit"),
                (118, "help.version"),
                (18, "help.redraw"),
                (16, "help.recall"),
                (33, "help.shell"),
            ] {
                self.mobile_command(
                    &format!("mobile-system-{key}"),
                    key,
                    &self.mobile_help(label),
                    Rect::new(viewport.x, row, viewport.w, TARGET),
                    busy || !b(&self.model["running"]),
                );
                row += 60.;
            }
        }
        self.widgets.end_clip();
        let total = row - viewport.y + self.scrolls["settings"];
        let max = (total - viewport.h).max(0.);
        self.regions.insert(
            "settings".into(),
            Region {
                rect: viewport,
                max,
            },
        );
        self.scrolls
            .insert("settings".into(), clamp(self.scrolls["settings"], 0., max));
        self.widgets
            .scrollbar(viewport, total, self.scrolls["settings"]);
    }

    fn mobile_help(&self, id: &str) -> String {
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
        let stairs = !direction
            && ui["input"]["kind"] == "command"
            && array(&ui["map_controls"]["actions"])
                .iter()
                .any(|a| a["id"] == "action.descend" || a["id"] == "mobile.ascend");
        for (i, a) in array(&ui["map_controls"]["actions"]).iter().enumerate() {
            if stairs && (a["id"] == "action.descend" || a["id"] == "mobile.ascend") {
                self.mobile_stair_controls(Rect::new(x, y + 124., w, 52.), n(&a["key"]) as u32);
                continue;
            }
            if a["id"] == "action.help" {
                let weapon = ui["input"]["kind"] == "command";
                self.mobile_button(
                    "mobile-operations",
                    &self.t("action.help"),
                    Rect::new(
                        x + if weapon { (w + 8.) / 2. } else { 0. },
                        y + 8. + i as f64 * 58.,
                        if weapon { (w - 8.) / 2. } else { w },
                        52.,
                    ),
                    false,
                );
                if weapon {
                    self.mobile_command(
                        "touch-wield",
                        119,
                        &self.t("mobile.weapon"),
                        Rect::new(x, y + 8. + i as f64 * 58., (w - 8.) / 2., 52.),
                        false,
                    );
                }
            } else {
                let id = s(&a["id"]);
                let (ax, aw) = if i == 2 {
                    (x + (w + 8.) / 2., (w - 8.) / 2.)
                } else if id == "action.inventory" && ui["input"]["kind"] == "command" {
                    (x, (w - 8.) / 2.)
                } else {
                    (x, w)
                };
                self.mobile_command(
                    &format!("touch-action-{id}"),
                    n(&a["key"]) as u32,
                    &self.t(match id {
                        "action.descend" => "action.descend_short",
                        "action.cancel" => "action.cancel_short",
                        other => other,
                    }),
                    Rect::new(ax, y + 8. + i as f64 * 58., aw, 52.),
                    false,
                );
                if id == "action.inventory" && ui["input"]["kind"] == "command" {
                    self.mobile_command(
                        "touch-throw",
                        116,
                        &self.t("mobile.throw"),
                        Rect::new(
                            x + (w + 8.) / 2.,
                            y + 8. + i as f64 * 58.,
                            (w - 8.) / 2.,
                            52.,
                        ),
                        false,
                    );
                }
            }
        }
        if !direction && array(&ui["map_controls"]["actions"]).len() < 3 {
            self.mobile_button(
                "mobile-map",
                &self.t(if self.mobile_overview {
                    "mobile.near"
                } else {
                    "mobile.wide"
                }),
                Rect::new(x + (w + 8.) / 2., y + 124., (w - 8.) / 2., 52.),
                false,
            );
        }
        if !direction && !stairs {
            self.mobile_command(
                "touch-search",
                115,
                &self.t("mobile.search"),
                Rect::new(x, y + 124., (w - 8.) / 2., 52.),
                false,
            );
        }
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
        self.mobile_armor_controls(Rect::new(viewport.x, row, viewport.w, TARGET));
        row += 60.;
        self.mobile_button(
            "mobile-movement",
            &self.t(match self.mobile_movement {
                1 => "mobile.run",
                2 => "mobile.run_adjacent",
                _ => "mobile.step",
            }),
            Rect::new(viewport.x, row, viewport.w, TARGET),
            false,
        );
        row += 60.;
        self.mobile_button(
            "mobile-map",
            &self.t(if self.mobile_overview {
                "mobile.near"
            } else {
                "mobile.wide"
            }),
            Rect::new(viewport.x, row, viewport.w, TARGET),
            false,
        );
        row += 60.;
        self.mobile_button(
            "mobile-full-map",
            &self.t("mobile.full_map"),
            Rect::new(viewport.x, row, viewport.w, TARGET),
            false,
        );
        row += 60.;
        self.mobile_rest_control(Rect::new(viewport.x, row, viewport.w, TARGET));
        row += 60.;
        for (key, label) in [
            (105, "help.inventory"),
            (115, "help.search"),
            (116, "help.throw"),
            (113, "help.quaff"),
            (114, "help.read"),
            (101, "help.eat"),
            (122, "help.zap"),
            (119, "help.wield"),
            (80, "help.put_ring"),
            (82, "help.remove_ring"),
            (100, "help.drop"),
            (44, "help.pickup"),
            (109, "help.move_without_pickup"),
            (102, "help.fight_carefully"),
            (70, "help.fight_to_death"),
            (46, "help.rest"),
            (97, "help.again"),
            (62, "help.downstairs"),
            (60, "help.upstairs"),
            (99, "help.call"),
            (73, "help.inventory_one"),
            (68, "help.discoveries"),
            (47, "help.identify"),
            (94, "help.trap"),
            (41, "help.weapon"),
            (93, "help.armor"),
            (61, "help.rings"),
            (64, "help.stats"),
            (63, "help.help"),
            (27, "help.cancel"),
        ] {
            let ui = &self.model["frame"]["ui"];
            if key == 60 && !b(&ui["player_state"]["amulet"]) {
                continue;
            }
            let stair_disabled = match key {
                60 => !b(&ui["map_controls"]["stairs"]["ascend"]),
                62 => !b(&ui["map_controls"]["stairs"]["descend"]),
                _ => false,
            };
            self.mobile_command(
                &format!("mobile-op-{key}"),
                key,
                &self.mobile_help(label),
                Rect::new(viewport.x, row, viewport.w, TARGET),
                !b(&self.model["running"]) || stair_disabled,
            );
            row += 60.;
        }
        for key in 48..=57 {
            self.mobile_command(
                &format!("mobile-op-{key}"),
                key,
                &format!(
                    "{} {}",
                    self.t("mobile.count"),
                    char::from_u32(key).unwrap()
                ),
                Rect::new(viewport.x, row, viewport.w, TARGET),
                false,
            );
            row += 60.;
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
