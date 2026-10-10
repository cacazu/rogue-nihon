use super::*;
impl BrowserUi {
    pub(super) fn footer(&mut self) {
        let y = self.height - 50.;
        self.text(
            &self.t("app.version"),
            16.,
            y,
            self.width - 32.,
            10.,
            MUTED,
            false,
        );
        self.button(
            "credits-repository",
            &self.t("credits.repository"),
            Rect::new(16., y + 20., 130_f64.min(self.width * 0.35), 24.),
            ControlStyle {
                size: 10.,
                ..Default::default()
            },
        );
        self.button(
            "credits-license",
            &self.t("credits.license"),
            Rect::new(
                160_f64.min(self.width * 0.4),
                y + 20.,
                260_f64.min(self.width * 0.57),
                24.,
            ),
            ControlStyle {
                size: 10.,
                ..Default::default()
            },
        );
    }
    pub(super) fn draw_top(&mut self) {
        let mobile = self.width < 700.;
        let w = 960_f64.min(self.width - 32.);
        let x = (self.width - w) / 2.;
        let viewport = Rect::new(0., 66., self.width, self.height - 124.);
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
        let mut y = 82. - self.scrolls["top"];
        self.text(
            &self.t("top.title"),
            x,
            y,
            if mobile { w } else { w - 220. },
            if mobile { 25. } else { 34. },
            TEXT,
            true,
        );
        y += if mobile { 106. } else { 66. };
        for (i, lang) in ["ja", "en"].iter().enumerate() {
            self.control(
                &format!("language-{lang}"),
                &self.t(&format!("language.{lang}")),
                Rect::new(
                    if mobile { x } else { x + w - 190. } + i as f64 * 96.,
                    y - 61.,
                    90.,
                    32.,
                ),
                json!({"kind":"select","id":"language","value":lang}),
                ControlStyle {
                    primary: self.model["language"] == *lang,
                    size: 12.,
                    disabled: b(&self.model["starting"]),
                    ..Default::default()
                },
            );
        }
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
        self.text(
            &self.t("top.new_help"),
            x + 22.,
            row,
            left_w - 44.,
            13.,
            MUTED,
            false,
        );
        row += 54.;
        for id in ["name", "seed"] {
            self.text(
                &self.t(&format!("form.{id}")),
                x + 22.,
                row,
                left_w - 44.,
                12.,
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
                    size: 12.,
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
        self.text(
            &self.t("top.load_help"),
            right_x + 22.,
            ry + 68.,
            right_w - 44.,
            13.,
            MUTED,
            false,
        );
        self.text(
            &self.t(if b(&self.model["saved"]) {
                "top.has_save"
            } else {
                "top.no_save"
            }),
            right_x + 22.,
            ry + 114.,
            right_w - 44.,
            13.,
            ACCENT,
            false,
        );
        self.button(
            "load",
            &self.t("action.load"),
            Rect::new(
                right_x + 22.,
                ry + if mobile { 158. } else { 292. },
                right_w - 44.,
                44.,
            ),
            ControlStyle {
                disabled: !b(&self.model["saved"]) || b(&self.model["starting"]),
                ..Default::default()
            },
        );
        let ny = if mobile { ry + 240. } else { y + 380. };
        if self.model["topNotice"].is_object() {
            let value = self.label(
                s(&self.model["topNotice"]["id"]),
                &self.model["topNotice"]["args"],
            );
            let h = self.wrap(&value, w - 32., 13.).len() as f64 * 22. + 24.;
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
                13.,
                if error { ERROR } else { "#b9dcec" },
                false,
            );
        }
        self.widgets.end_clip();
    }
    pub(super) fn draw_game(&mut self) {
        let mobile = self.width < 700. || b(&self.view["coarse"]);
        let game = Rect::new(
            0.,
            if self.fullscreen { 0. } else { 66. },
            self.width,
            self.height - if self.fullscreen { 0. } else { 124. },
        );
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
        self.draw_log(log);
        if mobile
            && !self.model["frame"]["ui"]["window"].is_object()
            && !b(&self.model["settingsOpen"])
        {
            self.touch_controls(map);
        }
        self.draw_hud_details(map);
        if self.model["frame"]["ui"]["window"].is_object() && !b(&self.model["settingsOpen"]) {
            self.draw_dialog(game);
        }
        if b(&self.model["settingsOpen"]) {
            self.draw_settings(game);
        }
    }
    fn draw_map(&mut self, map: Rect) {
        let f = self.model["frame"].clone();
        let ascii = self.model["displayMode"] == "ascii";
        let size = if ascii {
            12.
        } else {
            n(&self.model["tileSize"])
        };
        let cell_h = if ascii { 19. } else { size };
        let key = format!(
            "{}:{}:{}:{}:{size}:{}:{}",
            self.model["generation"],
            f["player"]["x"],
            f["player"]["y"],
            self.model["displayMode"],
            map.w,
            map.h
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
                        px,
                        py,
                        TextStyle {
                            size: 16.,
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
    fn draw_log(&mut self, r: Rect) {
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
            12.,
            "#c9e4d5",
            false,
        );
        let viewport = Rect::new(r.x + 10., r.y + 38., r.w - 20., (r.h - 46.).max(10.));
        let mut rows = Vec::new();
        let mut total = 0.;
        for e in array(&self.model["entries"]) {
            let text = format!(
                "{}{}",
                if e["source"] == "system" { "ⓘ " } else { "" },
                s(&e["text"])
            );
            let height = self.wrap(&text, viewport.w - 8., 13.).len() as f64 * 22. + 6.;
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
                13.,
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
        let size = if self.height < 500. { 29. } else { 34. };
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
                    size: 18.,
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
            self.control(
                &format!("touch-action-{}", s(&a["id"])),
                &self.t(s(&a["id"])),
                Rect::new(
                    r.x + r.w - 164. + (i % 2) as f64 * 78.,
                    r.y + r.h - rows * 40. - 10. + (i / 2) as f64 * 40.,
                    74.,
                    36.,
                ),
                json!({"kind":"send","key":a["key"]}),
                ControlStyle {
                    size: 11.,
                    key: Some(json!(key)),
                    ..Default::default()
                },
            );
        }
    }
    fn draw_dialog(&mut self, game: Rect) {
        self.widgets
            .controls
            .retain(|c| matches!(c.id.as_str(), "settings-toggle" | "header-fullscreen"));
        self.widgets.rect(game, "#0006");
        let ui = self.model["frame"]["ui"].clone();
        let d = &ui["window"];
        let mobile = self.width < 700.;
        let w = if b(&d["map_view"]) { 920_f64 } else { 600_f64 }.min(self.width - 28.);
        let x = (self.width - w) / 2.;
        let font = if mobile { 13. } else { 14. };
        let line_h = (font * 1.65_f64).ceil();
        let inner = w - 32.;
        let mut rows = Vec::new();
        let mut total = 0.;
        for line in array(&ui["lines"]) {
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
            let text = s(&line["text"]).to_string();
            let height = self
                .wrap(
                    &text,
                    inner - if b(&line["selectable"]) { 20. } else { 8. },
                    font,
                )
                .len() as f64
                * line_h
                + if b(&line["selectable"]) { 18. } else { 8. };
            rows.push((text, line.clone(), height, total, false));
            total += height;
        }
        if ui["mode"] == "game" && !s(&d["message"]["text"]).is_empty() {
            let text = s(&d["message"]["text"]).to_string();
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
        } else if b(&d["key_entry"]) {
            Some("command-key")
        } else {
            None
        };
        let ending = matches!(s(&ui["mode"]), "death" | "tombstone" | "score" | "victory");
        let cols = if mobile { 2 } else { 3 };
        let action_rows = array(&d["actions"]).len().div_ceil(cols) as f64;
        let prompt = [
            &d["prompt"],
            &self.model["input"]["text"],
            &ui["more"]["text"],
        ]
        .into_iter()
        .find(|v| !s(v).is_empty())
        .map(s)
        .unwrap_or("")
        .to_string();
        let prompt_height = if prompt.is_empty() {
            0.
        } else {
            self.wrap(&prompt, inner, 12.).len() as f64 * 20. + 8.
        };
        let bottom = action_rows * 46.
            + if field.is_some() { 56. } else { 0. }
            + if ending { 46. } else { 0. }
            + prompt_height
            + 12.;
        let h = (game.h - 28.).min(180_f64.max(total + bottom + 68.));
        let y = game.y + 24_f64.min(8_f64.max((game.h - h) / 3.));
        let panel = Rect::new(x, y, w, h);
        self.widgets.box_rect(panel, PANEL, Some("#81978e"), 9.);
        self.text(s(&d["title"]), x + 16., y + 15., inner, 16., TEXT, true);
        let viewport = Rect::new(x + 16., y + 48., inner, (h - 58. - bottom).max(16.));
        let max = (total - viewport.h).max(0.);
        let mut scroll = clamp(self.scrolls["dialog"], 0., max);
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
                self.control(
                    &format!("item-{key}"),
                    &text,
                    Rect::new(viewport.x, ry, viewport.w - 8., height - 3.),
                    json!({"kind":"send","key":key.chars().next().unwrap() as u32}),
                    ControlStyle {
                        left: true,
                        size: font,
                        key: Some(json!(key)),
                        disabled: !b(&self.model["running"]),
                        ..Default::default()
                    },
                );
            } else {
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
                    size: 12.,
                    disabled: !b(&self.model["running"]),
                    ..Default::default()
                },
            );
            ay += 56.;
        }
        let gap = 6.;
        let bw = (inner - (cols - 1) as f64 * gap) / cols as f64;
        for (i, a) in array(&d["actions"]).iter().enumerate() {
            self.control(
                &format!("window-{}", a["key"]),
                s(&a["text"]),
                Rect::new(
                    x + 16. + (i % cols) as f64 * (bw + gap),
                    ay + (i / cols) as f64 * 46.,
                    bw,
                    40.,
                ),
                json!({"kind":"send","key":a["key"]}),
                ControlStyle {
                    disabled: !b(&self.model["running"]) || b(&self.model["returnAfterEnd"]),
                    key: Some(a["key"].clone()),
                    ..Default::default()
                },
            );
        }
        ay += action_rows * 46.;
        if ending {
            self.button(
                "result-top",
                &self.t("action.top"),
                Rect::new(x + 16., ay, inner, 40.),
                ControlStyle {
                    disabled: b(&self.model["returnAfterEnd"]),
                    ..Default::default()
                },
            );
            ay += 46.;
        }
        if !prompt.is_empty() {
            self.text(&prompt, x + 16., ay + 4., inner, 12., "#cad7e2", false);
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
    fn draw_settings(&mut self, game: Rect) {
        self.widgets.controls.clear();
        self.widgets.rect(game, "#0007");
        let w = 390_f64.min(self.width - 24.);
        let x = 12.;
        let y = game.y + 10.;
        let h = game.h - 20.;
        self.widgets
            .box_rect(Rect::new(x, y, w, h), PANEL, Some(LINE), 9.);
        self.text(
            &self.t("settings.title"),
            x + 16.,
            y + 16.,
            w - 80.,
            18.,
            TEXT,
            true,
        );
        self.button(
            "settings-close",
            &self.t("action.close_settings"),
            Rect::new(x + w - 52., y + 8., 36., 36.),
            ControlStyle {
                icon: Some("close"),
                icon_size: 22.,
                ..Default::default()
            },
        );
        let viewport = Rect::new(x + 16., y + 58., w - 32., h - 70.);
        let mut row = viewport.y - self.scrolls["settings"];
        self.widgets.begin_clip(viewport);
        let saved = b(&self.model["saved"]);
        self.button(
            "save",
            &self.t("action.save"),
            Rect::new(
                viewport.x,
                row,
                if saved { viewport.w * 0.35 } else { viewport.w },
                42.,
            ),
            ControlStyle {
                disabled: !b(&self.model["running"])
                    || b(&self.model["savePending"])
                    || b(&self.model["returnAfterEnd"]),
                ..Default::default()
            },
        );
        if saved {
            self.button(
                "download-save",
                &self.t("action.download"),
                Rect::new(
                    viewport.x + viewport.w * 0.35 + 8.,
                    row,
                    viewport.w * 0.65 - 8.,
                    42.,
                ),
                ControlStyle {
                    size: 12.,
                    ..Default::default()
                },
            );
        }
        row += 70.;
        self.text(
            &self.t("form.display_mode"),
            viewport.x,
            row,
            viewport.w,
            12.,
            MUTED,
            false,
        );
        row += 26.;
        for (i, mode) in ["ascii", "tiles", "pixels"].iter().enumerate() {
            self.control(
                &format!("view-{mode}"),
                &self.t(&format!("view.{mode}")),
                Rect::new(
                    viewport.x + i as f64 * (viewport.w + 6.) / 3.,
                    row,
                    (viewport.w - 12.) / 3.,
                    40.,
                ),
                json!({"kind":"select","id":"display-mode","value":mode}),
                ControlStyle {
                    primary: self.model["displayMode"] == *mode,
                    size: 12.,
                    ..Default::default()
                },
            );
        }
        row += 62.;
        if self.model["displayMode"] != "ascii" {
            self.text(
                &format!(
                    "{}  {}%",
                    self.t("form.zoom"),
                    (n(&self.model["tileSize"]) / 32. * 100.).round()
                ),
                viewport.x,
                row,
                viewport.w,
                13.,
                ACCENT,
                false,
            );
            row += 28.;
            let r = Rect::new(viewport.x, row, viewport.w, 38.);
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
                .rect(Rect::new(r.x + 14., r.y + 17., r.w - 28., 4.), "#527769");
            let sizes = self.zoom_sizes();
            let index = sizes
                .iter()
                .position(|&v| v == n(&self.model["tileSize"]))
                .unwrap_or(0);
            self.widgets.circle(
                r.x + 14. + (r.w - 28.) * index as f64 / (sizes.len() - 1).max(1) as f64,
                r.y + 19.,
                8.,
                ACCENT,
            );
            row += 60.;
        }
        self.button(
            "center-map",
            &self.t("action.center"),
            Rect::new(viewport.x, row, viewport.w, 40.),
            Default::default(),
        );
        row += 52.;
        self.button(
            "fullscreen",
            &self.t(if b(&self.view["fullscreen"]) {
                "action.exit_fullscreen"
            } else {
                "action.fullscreen"
            }),
            Rect::new(viewport.x, row, viewport.w, 40.),
            Default::default(),
        );
        row += 62.;
        self.button(
            "settings-top",
            &self.t("action.top"),
            Rect::new(viewport.x, row, viewport.w, 42.),
            ControlStyle {
                disabled: b(&self.model["savePending"]) || b(&self.model["returnAfterEnd"]),
                ..Default::default()
            },
        );
        row += 54.;
        for (id, extra) in [
            ("settings.top_help", 20.),
            ("instruction.movement", 14.),
            ("instruction.prompts", 14.),
        ] {
            row += self.text(&self.t(id), viewport.x, row, viewport.w, 12., MUTED, false) + extra;
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
        if self.scrolls["settings"] > max {
            self.scrolls.insert("settings".into(), max);
        }
        self.widgets
            .scrollbar(viewport, total, self.scrolls["settings"]);
    }
    pub(super) fn zoom_sizes(&self) -> &'static [f64] {
        if self.model["displayMode"] == "pixels" {
            &[32., 64., 96., 128.]
        } else {
            &[16., 24., 32., 48., 64.]
        }
    }
}
