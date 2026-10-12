use super::*;
impl BrowserUi {
    pub(super) fn settings_button(&mut self, rect: Rect) {
        self.button(
            "settings-toggle",
            &self.t("action.settings"),
            rect,
            ControlStyle {
                icon: Some("settings"),
                icon_size: 26.,
                disabled: b(&self.model["returnAfterEnd"]),
                ..Default::default()
            },
        );
    }
    fn game_buttons(&mut self, map: Rect) {
        if !b(&self.model["topOpen"]) {
            self.settings_button(Rect::new(map.x + map.w - 104., map.y + 10., 44., 44.));
        }
        self.button(
            "header-fullscreen",
            &self.t(if b(&self.view["fullscreen"]) {
                "action.exit_fullscreen"
            } else {
                "action.fullscreen"
            }),
            Rect::new(map.x + map.w - 52., map.y + 10., 44., 44.),
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
    }
    pub(super) fn draw_top(&mut self) {
        let mobile = self.width < 700.;
        let w = 960_f64.min(self.width - 32.);
        let x = (self.width - w) / 2.;
        let viewport = Rect::new(0., 12., self.width, self.height - 64.);
        let content_height = if mobile { 880. } else { 610. };
        let max = (content_height - viewport.h).max(0.);
        self.regions.insert(
            "top".into(),
            Region {
                rect: viewport,
                max,
            },
        );
        self.scrolls
            .insert("top".into(), clamp(self.scrolls["top"], 0., max));
        self.widgets.begin_clip(viewport);
        let mut y = 28. - self.scrolls["top"];
        y += 66.;
        let left_w = if mobile { w } else { (w * 0.57).floor() };
        let right_x = if mobile { x } else { x + left_w + 20. };
        let right_w = if mobile { w } else { w - left_w - 20. };
        self.widgets
            .box_rect(Rect::new(x, y, left_w, 360.), PANEL, Some(LINE), 9.);
        let mut row = y + 24.;
        self.text(
            &self.t("action.new"),
            x + 22.,
            row,
            left_w - 44.,
            20.,
            TEXT,
            true,
        );
        row += 40.;
        for id in ["name", "seed"] {
            self.text(
                &self.t(&format!("form.{id}")),
                x + 22.,
                row,
                left_w - 44.,
                16.,
                MUTED,
                false,
            );
            row += 25.;
            let r = Rect::new(x + 22., row, left_w - 128., 42.);
            self.field(id, r, b(&self.model["starting"]));
            self.button(
                &format!("random-{id}"),
                &self.t("action.random"),
                Rect::new(r.x + r.w + 8., row, 76., 42.),
                ControlStyle {
                    disabled: b(&self.model["starting"]),
                    size: 16.,
                    ..Default::default()
                },
            );
            row += 70.;
        }
        self.button(
            "new-game",
            &self.t("action.new"),
            Rect::new(x + 22., y + 292., left_w - 44., 44.),
            ControlStyle {
                primary: true,
                disabled: !b(&self.model["ready"]) || b(&self.model["starting"]),
                ..Default::default()
            },
        );
        let ry = if mobile { y + 380. } else { y };
        self.widgets.box_rect(
            Rect::new(right_x, ry, right_w, if mobile { 220. } else { 360. }),
            PANEL,
            Some(LINE),
            9.,
        );
        self.text(
            &self.t("action.load"),
            right_x + 22.,
            ry + 24.,
            right_w - 44.,
            20.,
            TEXT,
            true,
        );
        self.resume_buttons(
            Rect::new(
                right_x + 22.,
                ry + if mobile { 98. } else { 224. },
                right_w - 44.,
                48.,
            ),
            b(&self.model["starting"]),
        );
        self.button(
            "credits-repository",
            &self.t("credits.repository"),
            Rect::new(
                right_x + 22.,
                ry + if mobile { 154. } else { 280. },
                right_w - 44.,
                48.,
            ),
            ControlStyle {
                size: 17.,
                ..Default::default()
            },
        );
        let ny = if mobile { ry + 240. } else { y + 380. };
        if b(&self.model["topNotice"]["error"]) {
            let value = self.label(
                s(&self.model["topNotice"]["id"]),
                &self.model["topNotice"]["args"],
            );
            let h = self.wrap(&value, w - 32., 16.).len() as f64 * 27. + 24.;
            let error = b(&self.model["topNotice"]["error"]);
            self.widgets.box_rect(
                Rect::new(x, ny, w, h),
                BG,
                Some(if error { "#76534a" } else { LINE }),
                9.,
            );
            self.text(
                &value,
                x + 16.,
                ny + 12.,
                w - 32.,
                16.,
                if error { ERROR } else { "#b9dcec" },
                false,
            );
        }
        self.widgets.end_clip();
        self.top_language_control(Rect::new(self.width - 52., 10., 44., 44.));
        self.game_buttons(Rect::new(0., 0., self.width, self.height));
        if b(&self.model["settingsOpen"]) {
            self.draw_settings(Rect::new(0., 0., self.width, self.height - 52.));
        }
    }
    pub(super) fn draw_game(&mut self) {
        let mobile = self.width < 700. || b(&self.view["coarse"]);
        let game = Rect::new(0., 0., self.width, self.height);
        let map = Rect::new(
            0.,
            game.y,
            if mobile {
                self.width
            } else {
                (self.width * 0.8).floor()
            },
            if mobile {
                (game.h * 0.68).floor()
            } else {
                game.h
            },
        );
        self.map_rect = Some(map);
        self.regions
            .insert("map".into(), Region { rect: map, max: 0. });
        self.widgets.rect(map, MAP);
        if self.model["frame"].is_object() {
            self.draw_map(map);
        }
        self.draw_hud(map);
        let log = if mobile {
            Rect::new(0., map.y + map.h, self.width, game.h - map.h)
        } else {
            Rect::new(map.w, game.y, self.width - map.w, game.h)
        };
        if !b(&self.model["settingsOpen"]) {
            self.draw_log(log);
            self.history_target(log);
        }
        if self.mobile_controls
            && b(&self.model["running"])
            && !self.model["frame"]["ui"]["window"].is_object()
            && !b(&self.model["settingsOpen"])
        {
            self.touch_controls(map);
        }
        if self.model["frame"]["ui"]["window"].is_object() && !b(&self.model["settingsOpen"]) {
            self.draw_dialog(game);
        }
        self.game_buttons(map);
        self.draw_hud_details(map);
        if b(&self.model["settingsOpen"]) {
            self.draw_settings(game);
        }
    }
    pub(super) fn draw_map(&mut self, map: Rect) {
        if self.mobile_full_map && (self.width < 700. || b(&self.view["coarse"])) {
            self.draw_mobile_full_map(map);
            return;
        }
        let f = self.model["frame"].clone();
        let ascii = self.model["displayMode"] == "ascii";
        let size = if self.mobile_overview && (self.width < 700. || b(&self.view["coarse"])) {
            16.
        } else {
            n(&self.model["tileSize"])
        };
        let cell_h = size;
        let key = format!(
            "{}:{}:{}:{size}:{}:{}",
            self.model["generation"], f["player"]["x"], f["player"]["y"], map.w, map.h
        );
        if self.center_key != key {
            self.center_key = key;
            self.camera = Some(Camera {
                size,
                cell_h,
                left: n(&f["player"]["x"]) * size + size / 2. - map.w / 2.,
                top: (n(&f["player"]["y"]) - 1.) * cell_h + cell_h / 2. - map.h / 2.,
                width: map.w,
                height: map.h,
            });
        }
        self.apply_zoom_anchor();
        self.constrain_camera();
        let cam = self.camera.expect("map camera");
        self.widgets.begin_clip(map);
        if !ascii {
            self.widgets.commands.extend(tiles::plan(
                &f,
                &json!(cam),
                map,
                n(&self.view["ratio"]).max(1.),
                s(&self.model["displayMode"]),
            ));
        } else {
            for y in 1..n(&f["height"]) as usize - 1 {
                for x in 0..n(&f["width"]) as usize {
                    let index = y * n(&f["width"]) as usize + x;
                    let glyph = s(&f["map_cells"]).get(index..index + 1).unwrap_or("");
                    if glyph.is_empty() || glyph == " " {
                        continue;
                    }
                    let px = map.x + x as f64 * size - cam.left;
                    let py = map.y + (y - 1) as f64 * cell_h - cam.top;
                    if px < map.x - size
                        || py < map.y - cell_h
                        || px > map.x + map.w
                        || py > map.y + map.h
                    {
                        continue;
                    }
                    self.widgets.raw_text(
                        glyph,
                        px + (size - (self.measure)(glyph, size * 0.75, false, true).width) / 2.,
                        py + size * 0.125,
                        TextStyle {
                            size: size * 0.75,
                            color: if glyph == "@" {
                                "#9ef0c3"
                            } else if "/!?=:)]*,".contains(glyph) {
                                "#ebcf91"
                            } else {
                                "#c5d0d3"
                            },
                            bold: false,
                            mono: true,
                        },
                    );
                }
            }
        }
        self.widgets.end_clip();
    }
    pub(super) fn constrain_camera(&mut self) {
        if let Some(c) = &mut self.camera {
            let f = &self.model["frame"];
            c.left = clamp(
                c.left,
                -c.width / 2.,
                n(&f["width"]) * c.size - c.width / 2.,
            );
            c.top = clamp(
                c.top,
                -c.height / 2.,
                (n(&f["height"]) - 2.) * c.cell_h - c.height / 2.,
            );
        }
    }
    pub(super) fn map_cell(&self, x: f64, y: f64) -> Option<Value> {
        let c = self.camera?;
        let r = self.map_rect?;
        let f = &self.model["frame"];
        let x = ((x - r.x + c.left) / c.size).floor();
        let y = 1. + ((y - r.y + c.top) / c.cell_h).floor();
        (x >= 0. && x < n(&f["width"]) && y >= 1. && y < n(&f["height"]) - 1.)
            .then(|| json!({"x":x,"y":y}))
    }
    pub(super) fn draw_log(&mut self, r: Rect) {
        self.widgets.box_rect(r, "#111b20", Some(LINE), 0.);
        let title = if self.description.is_empty() {
            self.t("log.title")
        } else {
            self.description.clone()
        };
        self.text(
            &title,
            r.x + 12.,
            r.y + 11.,
            r.w - 24.,
            18.,
            "#c9e4d5",
            false,
        );
        let viewport = Rect::new(r.x + 10., r.y + 52., r.w - 20., (r.h - 60.).max(10.));
        let mut rows = Vec::new();
        let mut total = 0.;
        for e in array(&self.model["entries"]) {
            let text = format!(
                "{}{}",
                if e["source"] == "system" { "ⓘ " } else { "" },
                s(&e["text"])
            );
            let height = self.wrap(&text, viewport.w - 8., 18.).len() as f64 * 30. + 8.;
            rows.push((text, e.clone(), height, total));
            total += height;
        }
        let max = (total - viewport.h).max(0.);
        if self.follow_log {
            self.scrolls.insert("log".into(), max);
        }
        self.scrolls
            .insert("log".into(), clamp(self.scrolls["log"], 0., max));
        self.regions.insert(
            "log".into(),
            Region {
                rect: viewport,
                max,
            },
        );
        self.widgets.begin_clip(viewport);
        for (text, e, height, top) in rows {
            let y = viewport.y + top - self.scrolls["log"];
            if y + height < viewport.y || y > viewport.y + viewport.h {
                continue;
            }
            self.text(
                &text,
                viewport.x,
                y,
                viewport.w - 8.,
                18.,
                if b(&e["error"]) {
                    ERROR
                } else if e["source"] == "game" {
                    "#d6e6da"
                } else {
                    "#9dcbe9"
                },
                false,
            );
        }
        self.widgets.end_clip();
        self.widgets.scrollbar(viewport, total, self.scrolls["log"]);
    }
    fn touch_controls(&mut self, r: Rect) {
        if !b(&self.model["running"]) {
            return;
        }
        let ui = self.model["frame"]["ui"].clone();
        let direction = b(&ui["movement_direction"]);
        let size = if self.height < 500. { 32. } else { 36. };
        for a in array(&ui["map_controls"]["directions"]) {
            let key = char::from_u32(n(&a["key"]) as u32)
                .unwrap_or(' ')
                .to_string();
            self.control(
                &format!("touch-{key}"),
                s(&a["text"]),
                Rect::new(
                    10. + n(&a["column"]) * (size + 3.),
                    r.y + r.h - 3. * (size + 3.) - 10. + n(&a["row"]) * (size + 3.),
                    size,
                    size,
                ),
                json!({"kind":"send","key":a["key"]}),
                ControlStyle {
                    throw_direction: direction,
                    size: 22.,
                    key: Some(json!(key)),
                    ..Default::default()
                },
            );
        }
        let actions = array(&ui["map_controls"]["actions"]);
        let rows = actions.len().div_ceil(2) as f64;
        for (i, a) in actions.iter().enumerate() {
            let key = if a["key"] == 27 {
                "Escape".into()
            } else {
                char::from_u32(n(&a["key"]) as u32)
                    .unwrap_or(' ')
                    .to_string()
            };
            let label_id = match s(&a["id"]) {
                "action.descend" => "action.descend_short",
                "action.cancel" => "action.cancel_short",
                id => id,
            };
            self.control(
                &format!("touch-action-{}", s(&a["id"])),
                &self.t(label_id),
                Rect::new(
                    r.x + r.w - 176. + (i % 2) as f64 * 86.,
                    r.y + r.h - rows * 48. - 10. + (i / 2) as f64 * 48.,
                    80.,
                    44.,
                ),
                json!({"kind":"send","key":a["key"]}),
                ControlStyle {
                    size: 16.,
                    key: Some(json!(key)),
                    ..Default::default()
                },
            );
        }
    }
    pub(super) fn draw_dialog(&mut self, game: Rect) {
        self.widgets.controls.clear();
        self.widgets.rect(game, "#0006");
        // Keep the in-game buttons visible and clear of modal contents.
        let game = Rect::new(game.x, game.y + 60., game.w, (game.h - 60.).max(1.));
        let ui = self.model["frame"]["ui"].clone();
        let d = &ui["window"];
        let inventory_list = self.inventory_list_visible();
        if inventory_list { self.sync_inventory_tabs(&ui); }
        let mobile = self.width < 700. || b(&self.view["coarse"]);
        let w = if b(&d["map_view"]) { 920_f64 } else { 600_f64 }.min(self.width - 28.);
        let x = (self.width - w) / 2.;
        let font = 18.;
        let line_h = (font * 1.65_f64).ceil();
        let inner = w - 32.;
        let mut rows = Vec::new();
        let mut total = 0.;
        for source_line in array(&ui["lines"]) {
            let line = self.inventory_item_row(source_line);
            if inventory_list && !self.inventory_row_visible(&line) { continue; }
            if mobile
                && matches!(
                    s(&line["id"]),
                    "options.hint.bool" | "options.hint.inventory"
                )
            {
                continue;
            }
            if matches!(
                s(&line["id"]),
                "ui.continue"
                    | "ui.close"
                    | "ui.next_page"
                    | "ui.ending.space"
                    | "ui.ending.return"
            ) && matches!(s(&ui["input"]["kind"]), "space" | "space_cancel" | "enter")
            {
                continue;
            }
            if ui["more"].is_object()
                && line["id"] == ui["more"]["id"]
                && line["text"] == ui["more"]["text"]
            {
                continue;
            }
            if mobile
                && line["id"] == "ui.help.entry"
                && matches!(
                    s(&line["args"][1]["value"]),
                    "help.shell" | "help.redraw" | "help.version" | "help.recall"
                )
            {
                continue;
            }
            let text = if mobile && line["id"] == "ui.help.entry" {
                self.mobile_help(s(&line["args"][1]["value"]))
            } else if mobile && b(&line["selectable"]) && !s(&line["key"]).is_empty() {
                let prefix = format!("{}) ", s(&line["key"]));
                s(&line["text"])
                    .strip_prefix(&prefix)
                    .unwrap_or(s(&line["text"]))
                    .to_string()
            } else if mobile && s(&line["id"]).starts_with("help.") {
                self.mobile_help(s(&line["id"]))
            } else {
                s(&line["text"]).to_string()
            };
            let text = if mobile
                && (b(&ui["inventory"])
                    || ui["input"]["kind"] == "item"
                    || matches!(s(&d["kind"]), "inventory_actions" | "inventory_details"))
                && text.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
                && text.get(1..3) == Some(") ")
            {
                text[3..].to_string()
            } else {
                text
            };
            let height = self
                .wrap(
                    &text,
                    inner - if b(&line["selectable"]) { 28. } else { 12. }
                        - if b(&line["equipped_icon"]) { 26. } else { 0. },
                    font,
                )
                .len() as f64
                * line_h
                + if b(&line["selectable"]) { 18. } else { 8. };
            rows.push((text, line.clone(), height, total, false));
            total += height;
        }
        if ui["mode"] == "game"
            && !s(&d["message"]["text"]).is_empty()
            && !(mobile
                && matches!(
                    s(&ui["input"]["kind"]),
                    "direction" | "hand" | "help" | "discovery"
                ))
        {
            let text = if mobile && ui["input"]["kind"] == "item" {
                let hint = crate::display::message_language(
                    "pack.get_item.for_list",
                    &json!([]),
                    "",
                    s(&self.model["language"]),
                )
                .text;
                s(&d["message"]["text"]).replace(
                    &hint,
                    if self.model["language"] == "ja" {
                        "？"
                    } else {
                        "?"
                    },
                )
            } else {
                s(&d["message"]["text"]).to_string()
            };
            let height = self.wrap(&text, inner - 8., font).len() as f64 * line_h + 8.;
            rows.push((text, json!({}), height, total, false));
            total += height;
        }
        if b(&d["map_view"]) {
            let height = inner / 80. * 22. * 1.5;
            rows.push((String::new(), Value::Null, height, total, true));
            total += height + 8.;
        }
        let field = if self.model["input"]["kind"] == "text" {
            Some("prompt-text")
        } else if b(&d["key_entry"]) && (!mobile || self.model["input"]["kind"] == "symbol") {
            Some("command-key")
        } else {
            None
        };
        let ending = matches!(s(&ui["mode"]), "death" | "tombstone" | "score" | "victory");
        let cols = if mobile { 2 } else { 3 };
        let close_id = if ending {
            "result-top"
        } else if array(&d["actions"]).iter().any(|a| a["key"] == 27)
            && !matches!(s(&d["kind"]), "inventory_actions" | "inventory_details")
        {
            "window-27"
        } else if array(&d["actions"]).iter().any(|a| a["key"] == 32)
            && (ui["input"]["id"] == "input.close" || b(&ui["inventory"]))
        {
            "window-32"
        } else {
            "window-close"
        };
        let actions: Vec<_> = array(&d["actions"]).iter().filter(|a| {
            let key = n(&a["key"]) as u32;
            let back = matches!(s(&d["kind"]), "inventory_actions" | "inventory_details");
            !(key == 27 && !back
                || key == 32 && (ui["input"]["id"] == "input.close" || b(&ui["inventory"])))
        }).collect();
        let action_rows = actions.len().div_ceil(cols) as f64;
        let prompt = if mobile {
            String::new()
        } else {
            [
                &d["prompt"],
                &self.model["input"]["text"],
                &ui["more"]["text"],
            ]
            .into_iter()
            .find(|v| !s(v).is_empty())
            .map(s)
            .unwrap_or("")
            .to_string()
        };
        let prompt_height = if prompt.is_empty() {
            0.
        } else {
            self.wrap(&prompt, inner, if mobile { 17. } else { 16. })
                .len() as f64
                * 27.
                + 8.
        };
        let bottom = action_rows * 46.
            + if field.is_some() { 56. } else { 0. }
            + prompt_height
            + 12.;
        let header = if inventory_list { 120. } else { 64. };
        let h = (game.h - 28.).min(180_f64.max(total + bottom + header + 20.));
        let y = game.y + 24_f64.min(8_f64.max((game.h - h) / 3.));
        let panel = Rect::new(x, y, w, h);
        self.widgets.box_rect(panel, PANEL, Some("#81978e"), 9.);
        let history = inventory_list;
        let title_width = if history {
            (self.measure)(s(&d["title"]), 20., true, false).width
        } else { inner - 56. };
        let title_height = 20.;
        self.text(s(&d["title"]), x + 16., y + 15., title_width, title_height, TEXT, true);
        if history {
            let label = self.t("inventory.history");
            let available = (inner - 56. - title_width - 8.).max(48.);
            let width = ((self.measure)(&label, 17., false, false).width + 16.).min(available);
            self.control(
                "inventory-history", &label,
                Rect::new(x + 16. + title_width + 8., y + 15., width, title_height),
                json!({"kind":"send","key":68}),
                ControlStyle { custom: true, key: Some(json!(68)), ..Default::default() },
            );
            self.widgets.single_line(&label,Rect::new(x+16.+title_width+8.,y+15.,width,title_height),
                LineStyle { text:TextStyle::new(17.,TEXT,false),center:true,ellipsis:false },self.measure);
        }
        self.control(
            close_id,
            &self.t("mobile.dialog.close"),
            Rect::new(x + w - 56., y + 8., 48., 48.),
            json!({"kind":"invoke","id":if ending { "result-top" } else { "window-close" }}),
            ControlStyle {
                icon: Some("close"),
                icon_size: 24.,
                key: Some(json!(27)),
                disabled: b(&self.model["returnAfterEnd"]) || b(&self.model["windowClosing"]),
                ..Default::default()
            },
        );
        if inventory_list { self.draw_inventory_tabs(&ui,Rect::new(x+16.,y+64.,inner,48.)); }
        let viewport = Rect::new(x + 16., y + header, inner, (h - header - 10. - bottom).max(16.));
        let max = (total - viewport.h).max(0.);
        let mut scroll = clamp(if inventory_list { self.inventory_scroll() } else { self.scrolls["dialog"] }, 0., max);
        if !d["active_row"].is_null() && d["active_row"] != self.active_row {
            if let Some(row) = rows
                .iter()
                .find(|r| r.1["scope"] == "options" && r.1["row"] == d["active_row"])
            {
                scroll = clamp(row.3, 0., max);
            }
            self.active_row = d["active_row"].clone();
        }
        self.scrolls.insert("dialog".into(), scroll);
        if inventory_list { self.remember_inventory_scroll(scroll); }
        self.regions.insert(
            "dialog".into(),
            Region {
                rect: viewport,
                max,
            },
        );
        self.widgets.begin_clip(viewport);
        for (text, line, height, top, map) in rows {
            let ry = viewport.y + top - scroll;
            if ry + height < viewport.y || ry > viewport.y + viewport.h {
                continue;
            }
            if map {
                self.detection_map(Rect::new(viewport.x, ry, viewport.w, height));
                continue;
            }
            let key = s(&line["key"]);
            if b(&line["selectable"]) && key.chars().count() == 1 {
                let rect = Rect::new(viewport.x, ry, viewport.w - 8., height - 3.);
                self.control(
                    &format!("item-{key}"),
                    &if b(&line["equipped_icon"]) { format!("{} {text}",self.t("inventory.tab.equipped")) } else { text.clone() },
                    rect,
                    json!({"kind":"send","key":key.chars().next().unwrap() as u32}),
                    ControlStyle {
                        left: true,
                        size: font,
                        custom: b(&line["equipped_icon"]),
                        key: Some(json!(key)),
                        disabled: !b(&self.model["running"]) || b(&self.model["windowClosing"]),
                        ..Default::default()
                    },
                );
                if b(&line["equipped_icon"]) { self.draw_equipped_item(&text,rect,true,font); }
            } else {
                if b(&line["equipped_icon"]) {
                    self.draw_equipped_item(&text,Rect::new(viewport.x,ry,viewport.w,height),false,font);
                    continue;
                }
                if line["scope"] == "options" && line["row"] == d["active_row"] {
                    self.widgets.box_rect(
                        Rect::new(viewport.x, ry, viewport.w - 8., height),
                        "#283d34",
                        None,
                        3.,
                    );
                }
                self.text(
                    &text,
                    viewport.x + 4.,
                    ry + 4.,
                    viewport.w - 12.,
                    font,
                    TEXT,
                    false,
                );
            }
        }
        self.widgets.end_clip();
        self.widgets.scrollbar(viewport, total, scroll);
        let mut ay = y + h - bottom;
        if let Some(field) = field {
            self.field(field, Rect::new(x + 16., ay, inner - 104., 42.), false);
            self.control(
                "submit-text",
                &self.t("action.submit"),
                Rect::new(x + w - 112., ay, 96., 42.),
                json!({"kind":"submit","id":field}),
                ControlStyle {
                    size: 16.,
                    disabled: !b(&self.model["running"]),
                    ..Default::default()
                },
            );
            ay += 56.;
        }
        let gap = 6.;
        let bw = (inner - (cols - 1) as f64 * gap) / cols as f64;
        for (i, a) in actions.iter().enumerate() {
            self.control(
                &format!("window-{}", a["key"]),
                &if mobile {
                    self.mobile_dialog_action(&ui, d, a)
                } else {
                    s(&a["text"]).to_string()
                },
                Rect::new(
                    x + 16. + (i % cols) as f64 * (bw + gap),
                    ay + (i / cols) as f64 * 46.,
                    bw,
                    40.,
                ),
                json!({"kind":"send","key":a["key"]}),
                ControlStyle {
                    disabled: !b(&self.model["running"]) || b(&self.model["returnAfterEnd"]) || b(&self.model["windowClosing"]),
                    size: if mobile { 17. } else { 16. },
                    key: Some(a["key"].clone()),
                    ..Default::default()
                },
            );
        }
        ay += action_rows * 46.;
        if !prompt.is_empty() {
            self.text(
                &prompt,
                x + 16.,
                ay + 4.,
                inner,
                if mobile { 17. } else { 16. },
                "#cad7e2",
                false,
            );
        }
        self.dialog_rect = Some(panel);
    }
    fn detection_map(&mut self, r: Rect) {
        let f = &self.model["frame"];
        let width = n(&f["width"]) as usize;
        let height = n(&f["height"]) as usize;
        let cw = r.w / width as f64;
        let ch = r.h / (height - 2) as f64;
        self.widgets.rect(r, "#10191d");
        for y in 1..height - 1 {
            for x in 0..width {
                let i = y * width + x;
                for (glyph, color) in [
                    (s(&f["map_cells"]).get(i..i + 1).unwrap_or(" "), "#61727a"),
                    (s(&f["cells"]).get(i..i + 1).unwrap_or(" "), "#ffe483"),
                ] {
                    if glyph != " " {
                        self.widgets.raw_text(
                            glyph,
                            r.x + x as f64 * cw,
                            r.y + (y - 1) as f64 * ch,
                            TextStyle {
                                size: (ch * 0.8).max(5.),
                                color,
                                bold: false,
                                mono: true,
                            },
                        );
                    }
                }
            }
        }
    }
}
