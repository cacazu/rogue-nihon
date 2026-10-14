use super::*;
impl Browser {
    pub(super) fn font(&self, size: f64, bold: bool, mono: bool) {
        self.context.set_font(&format!(
            "{}{size}px {}",
            if bold { "600 " } else { "" },
            if mono {
                "Consolas, \"Courier New\", monospace"
            } else {
                "system-ui, \"Yu Gothic\", sans-serif"
            }
        ));
        self.context.set_text_baseline("top");
    }
    pub(super) fn paint(self: &Rc<Self>) -> Result<(), JsValue> {
        let captured: Vec<_> = self.captured.borrow().iter().copied().collect();
        let response = self.request(json!({"type":"render","captured":captured,"view":{"width":self.surface.client_width(),"height":self.surface.client_height(),"ratio":self.window.device_pixel_ratio(),"coarse":self.coarse(),"fullscreen":self.document.fullscreen_element().is_some(),"now":js_sys::Date::now()}}));
        let surface = &response["surface"];
        let ratio = number(&surface["ratio"]);
        let width = (number(&surface["width"]) * ratio).round() as u32;
        let height = (number(&surface["height"]) * ratio).round() as u32;
        if self.canvas.width() != width || self.canvas.height() != height {
            self.canvas.set_width(width);
            self.canvas.set_height(height);
        }
        self.context.set_transform(ratio, 0., 0., ratio, 0., 0.)?;
        self.draw_count.set(0);
        for command in response["commands"].as_array().into_iter().flatten() {
            self.draw(command)?;
        }
        for effect in response["effects"].as_array().into_iter().flatten() {
            self.effect(effect)?;
        }
        self.accessibility()?;
        Ok(())
    }
    fn draw(&self, command: &Value) -> Result<(), JsValue> {
        let c = &self.context;
        let r = &command["rect"];
        let (x, y, w, h) = (
            number(&r["x"]),
            number(&r["y"]),
            number(&r["w"]),
            number(&r["h"]),
        );
        match text(&command["op"]) {
            "rect" => {
                c.set_fill_style_str(text(&command["color"]));
                c.fill_rect(x, y, w, h);
            }
            "box" => {
                c.begin_path();
                c.round_rect_with_f64(x, y, w.max(0.), h.max(0.), number(&command["radius"]))?;
                c.set_fill_style_str(text(&command["fill"]));
                c.fill();
                if command["stroke"].is_string() {
                    c.set_stroke_style_str(text(&command["stroke"]));
                    c.set_line_width(1.);
                    c.stroke();
                }
            }
            "circle" => {
                c.set_fill_style_str(text(&command["color"]));
                c.begin_path();
                c.arc(
                    number(&command["x"]),
                    number(&command["y"]),
                    number(&command["radius"]),
                    0.,
                    std::f64::consts::TAU,
                )?;
                c.fill();
            }
            "text" => {
                self.font(
                    number(&command["size"]),
                    command["bold"].as_bool().unwrap_or(false),
                    command["mono"].as_bool().unwrap_or(false),
                );
                c.set_fill_style_str(text(&command["color"]));
                let draw = || {
                    c.fill_text(
                        text(&command["text"]),
                        number(&command["x"]),
                        number(&command["y"]),
                    )
                };
                if command["outline"].is_object() {
                    c.save();
                    c.set_shadow_color(text(&command["outline"]["color"]));
                    c.set_shadow_blur(0.);
                    let scale = c.get_transform()?;
                    let width = number(&command["outline"]["width"]);
                    let d = std::f64::consts::FRAC_1_SQRT_2;
                    for (dx, dy) in [
                        (-1., 0.),
                        (1., 0.),
                        (0., -1.),
                        (0., 1.),
                        (-d, -d),
                        (d, -d),
                        (-d, d),
                        (d, d),
                    ] {
                        c.set_shadow_offset_x(dx * width * scale.a());
                        c.set_shadow_offset_y(dy * width * scale.d());
                        draw()?;
                    }
                    c.restore();
                }
                draw()?;
            }
            "save" => {
                c.save();
                c.set_global_alpha(number(&command["alpha"]));
            }
            "restore" => c.restore(),
            "clip" => {
                c.save();
                c.begin_path();
                c.rect(x, y, w, h);
                c.clip();
            }
            "path" => {
                c.save();
                c.translate(x, y)?;
                c.scale(w / 24., h / 24.)?;
                c.set_line_join("round");
                c.set_line_cap("round");
                let path = Path2d::new_with_path_string(text(&command["path"]))?;
                let fill = command["fill"].as_bool().unwrap_or(false);
                if command["outline"].is_object() {
                    c.set_stroke_style_str(text(&command["outline"]["color"]));
                    c.set_line_width(
                        if fill { 0. } else { 1.8 }
                            + 2. * number(&command["outline"]["width"]) * 24. / w,
                    );
                    c.stroke_with_path(&path);
                }
                c.set_stroke_style_str(text(&command["color"]));
                c.set_fill_style_str(text(&command["color"]));
                c.set_line_width(1.8);
                if fill {
                    c.fill_with_path_2d(&path);
                } else {
                    c.stroke_with_path(&path);
                }
                c.restore();
            }
            "image" => {
                c.set_image_smoothing_enabled(false);
                let mut tiles = self.tiles.borrow_mut();
                let set = tiles
                    .get_mut(text(&command["set"]))
                    .ok_or_else(|| JsValue::from_str("Missing tile set"))?;
                set.draw(c, command, x, y, w, h)?;
                self.draw_count.set(self.draw_count.get() + 1);
            }
            other => return Err(JsValue::from_str(&format!("Unknown draw command: {other}"))),
        }
        Ok(())
    }
    fn accessibility(&self) -> Result<(), JsValue> {
        let scene = self.scene.borrow();
        let state = self.state.borrow();
        let mut buttons = self.buttons.borrow_mut();
        let mut active = BTreeSet::new();
        for control in scene["controls"].as_array().into_iter().flatten() {
            let r = &control["rect"];
            if text(&control["type"]) != "button" || number(&r["w"]) <= 0. || number(&r["h"]) <= 0.
            {
                continue;
            }
            let id = text(&control["id"]).to_string();
            active.insert(id.clone());
            if !buttons.contains_key(&id) {
                let button: HtmlButtonElement =
                    self.document.create_element("button")?.dyn_into()?;
                button.set_type("button");
                button.set_tab_index(-1);
                button.set_attribute("data-control", &id)?;
                self.controls.append_child(&button)?;
                buttons.insert(id.clone(), button);
            }
            let button = &buttons[&id];
            button.set_attribute("aria-label", text(&control["label"]))?;
            button.set_disabled(control["disabled"].as_bool().unwrap_or(false));
            button.style().set_css_text(&format!("position:absolute;left:{}px;top:{}px;width:{}px;height:{}px;opacity:0;padding:0;border:0;pointer-events:auto;touch-action:none",number(&r["x"]),number(&r["y"]),number(&r["w"]),number(&r["h"])));
        }
        buttons.retain(|id, button| {
            if active.contains(id) {
                true
            } else {
                button.remove();
                false
            }
        });
        let frame = &state["frame"];
        let lines: Vec<_> = frame["ui"]["lines"].as_array().into_iter().flatten().map(|line| json!({"text":line["text"],"key":line["key"],"selectable":line["selectable"]})).collect();
        let messages: Vec<_> = state["messages"]
            .as_array()
            .into_iter()
            .flatten()
            .rev()
            .take(6)
            .map(|m| m["text"].clone())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        self.description.set_text_content(Some(&json!({"scope":scene["scope"],"status":frame["ui"]["status"]["text"],"player":frame["player"],"width":frame["width"],"height":frame["height"],"map":frame["map_cells"],"input":frame["ui"]["input"],"window":frame["ui"]["window"],"lines":lines,"messages":messages,"running":state["running"],"text":scene["text"]}).to_string()));
        Ok(())
    }
}
