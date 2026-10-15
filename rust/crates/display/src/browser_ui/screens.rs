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
        self.draw_mobile_top();
        let fullscreen = b(&self.view["fullscreen"]);
        self.top_language_control(Rect::new(self.width - 56., 8., 48., 48.));
        self.button(
            "header-fullscreen",
            &self.t(if fullscreen {
                "action.exit_fullscreen"
            } else {
                "action.fullscreen"
            }),
            Rect::new(self.width - 56., 8., 48., 48.),
            ControlStyle {
                icon: Some(if fullscreen { "collapse" } else { "expand" }),
                icon_size: 24.,
                ..Default::default()
            },
        );
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
        let visual_player = array(&f["map_animation"]).iter().find(|actor| actor["id"] == 0);
        let player_x = visual_player.and_then(|actor| actor["displayX"].as_f64()).unwrap_or(n(&f["player"]["x"]));
        let player_y = visual_player.and_then(|actor| actor["displayY"].as_f64()).unwrap_or(n(&f["player"]["y"]));
        let key = format!(
            "{}:{}:{}:{size}:{}:{}",
            self.model["generation"], player_x, player_y, map.w, map.h
        );
        if self.center_key != key {
            self.center_key = key;
            self.camera = Some(Camera {
                size,
                cell_h,
                left: player_x * size + size / 2. - map.w / 2.,
                top: (player_y - 1.) * cell_h + cell_h / 2. - map.h / 2.,
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
            if (self.width < 700. || b(&self.view["coarse"])) && b(&e["mobile_keyboard_hint"]) {
                continue;
            }
            let mut runs = self.log_runs(e,self.width < 700. || b(&self.view["coarse"]));
            if e["source"] == "system" { runs.insert(0,json!({"text":"ⓘ "})); }
            let lines = self.log_lines(&runs,viewport.w-8.,18.);
            let height = lines.len() as f64 * 30. + 8.;
            rows.push((lines, e.clone(), height, total));
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
        for (lines, e, height, top) in rows {
            let y = viewport.y + top - self.scrolls["log"];
            if y + height < viewport.y || y > viewport.y + viewport.h {
                continue;
            }
            let color = if b(&e["error"]) {
                    ERROR
                } else if e["source"] == "game" {
                    "#d6e6da"
                } else {
                    "#9dcbe9"
                };
            for (index,line) in lines.iter().enumerate() {
                self.draw_log_line(line,viewport.x,y+index as f64*30.,18.,color);
            }
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
    fn after_use_naming_effects(&self, ui: &Value) -> Vec<Value> {
        let id = s(&ui["window"]["message"]["id"]);
        if ui["mode"] != "game" || self.model["input"]["kind"] != "text"
            || !matches!(id, "misc.call_it.call_it" | "misc.call_it.what_do_you_want_to_call_it") {
            return Vec::new();
        }
        let entries = array(&self.model["entries"]);
        let Some(prompt) = entries.iter().rposition(|entry| entry["source"] == "game" && entry["id"] == id) else {
            return Vec::new();
        };
        let mut effects = Vec::new();
        for entry in entries[..prompt].iter().rev().filter(|entry| entry["source"] == "game") {
            // The selection prompt marks this use; never include an earlier
            // item's effect or infer a hidden identity from the consumed item.
            if b(&entry["mobile_keyboard_hint"]) || s(&entry["id"]).starts_with("pack.get_item.")
                || s(&entry["id"]).starts_with("misc.call_it.") {
                break;
            }
            if !s(&entry["text"]).trim().is_empty() { effects.push(entry.clone()); }
        }
        effects.reverse();
        effects
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
        let naming_effects = self.after_use_naming_effects(&ui);
        if !naming_effects.is_empty() {
            let label = self.t("naming.effect");
            let height = self.wrap(&label, inner - 8., 17.).len() as f64 * 27. + 8.;
            rows.push((label, json!({"naming_effect_label":true}), height, total, false));
            total += height;
            for entry in naming_effects {
                let lines = self.log_lines(&self.log_runs(&entry, mobile), inner - 8., font);
                let height = lines.len() as f64 * line_h + 16.;
                rows.push((String::new(), json!({"naming_effect":entry}), height, total, false));
                total += height;
            }
        }
        for source_line in array(&ui["lines"]) {
            let line = self.inventory_item_row(source_line, mobile);
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
            let height = if line["item_runs"].is_array() {
                self.inventory_item_height(&line, inner - if b(&line["selectable"]) { 28. } else { 12. },font)
            } else { self
                .wrap(
                    &text,
                    inner - if b(&line["selectable"]) { 28. } else { 12. },
                    font,
                )
                .len() as f64
                * line_h }
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
        let item_history = b(&self.model["itemHistoryOpen"]) && !b(&ui["inventory"]);
        let title = if item_history { self.t("inventory.history") } else { s(&d["title"]).to_string() };
        let title_width = if inventory_list || item_history {
            (self.measure)(&title, 20., true, false).width
        } else { inner - 56. };
        let title_height = 20.;
        let mut title_x = x + 16.;
        if inventory_list || item_history {
            let label = self.t(if item_history { "action.inventory" } else { "inventory.history" });
            let available = (inner - 56. - title_width - 8.).max(48.);
            let width = ((self.measure)(&label, 17., false, false).width + 16.).min(available);
            let button_x = if item_history { title_x } else { title_x + title_width + 8. };
            self.control(
                if item_history { "inventory-return" } else { "inventory-history" }, &label,
                Rect::new(button_x, y + 15., width, title_height),
                if item_history { json!({"kind":"invoke","id":"inventory-return"}) } else { json!({"kind":"send","key":68}) },
                ControlStyle { custom: true, key: if item_history { None } else { Some(json!(68)) },
                    disabled: b(&self.model["windowClosing"]), ..Default::default() },
            );
            self.widgets.single_line(&label,Rect::new(button_x,y+15.,width,title_height),
                LineStyle { text:TextStyle::new(17.,TEXT,false),center:true,ellipsis:false },self.measure);
            if item_history { title_x += width + 8.; }
        }
        self.text(&title, title_x, y + 15., title_width, title_height, TEXT, true);
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
            if line["naming_effect"].is_object() {
                let lines = self.log_lines(&self.log_runs(&line["naming_effect"], mobile), viewport.w - 8., font);
                for (index, value) in lines.iter().enumerate() {
                    self.draw_log_line(value, viewport.x + 4., ry + 4. + index as f64 * line_h, font, ACCENT);
                }
                continue;
            }
            if b(&line["naming_effect_label"]) {
                self.text(&text, viewport.x + 4., ry + 4., viewport.w - 12., 17., MUTED, true);
                continue;
            }
            let key = s(&line["key"]);
            if b(&line["selectable"]) && key.chars().count() == 1 {
                let rect = Rect::new(viewport.x, ry, viewport.w - 8., height - 3.);
                self.control(
                    &format!("item-{key}"),
                    &if !s(&line["equipped_slot"]).is_empty() { format!("{text} {}",s(&line["equipped_slot"])) } else { text.clone() },
                    rect,
                    json!({"kind":"send","key":key.chars().next().unwrap() as u32}),
                    ControlStyle {
                        left: true,
                        size: font,
                        custom: line["item_runs"].is_array(),
                        key: Some(json!(key)),
                        disabled: !b(&self.model["running"]) || b(&self.model["windowClosing"]),
                        ..Default::default()
                    },
                );
                if line["item_runs"].is_array() { self.draw_inventory_item(&line,rect,true,font); }
            } else {
                if line["item_runs"].is_array() {
                    self.draw_inventory_item(&line,Rect::new(viewport.x,ry,viewport.w,height),false,font);
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
