use super::*;
impl Browser {
    pub(super) fn paint(self: &Rc<Self>) -> Result<(), JsValue> {
        let captured: Vec<_> = self.captured.borrow().iter().copied().collect();
        let response = self.request(json!({"type":"render","captured":captured,"view":{"width":self.surface.client_width(),"height":self.surface.client_height(),"ratio":self.window.device_pixel_ratio(),"coarse":self.coarse(),"fullscreen":self.document.fullscreen_element().is_some(),"visible":!self.document.hidden(),"now":js_sys::Date::now()}}));
        let surface = &response["surface"];
        let ratio = number(&surface["ratio"]);
        let width = (number(&surface["width"]) * ratio).round() as u32;
        let height = (number(&surface["height"]) * ratio).round() as u32;
        if self.canvas.width() != width || self.canvas.height() != height {
            self.canvas.set_width(width);
            self.canvas.set_height(height);
        }
        let commands = response["commands"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        {
            let mut renderer = self.renderer.borrow_mut();
            renderer
                .render(width, height, ratio, commands, &mut self.tiles.borrow_mut())
                .map_err(|e| JsValue::from_str(&e))?;
            let data = ImageData::new_with_u8_clamped_array_and_sh(
                wasm_bindgen::Clamped(renderer.rgba()),
                width,
                height,
            )?;
            self.context.put_image_data(&data, 0., 0.)?;
        }
        self.draw_count.set(
            commands
                .iter()
                .filter(|c| text(&c["op"]) == "image")
                .count() as u32,
        );
        for effect in response["effects"].as_array().into_iter().flatten() {
            self.effect(effect)?;
        }
        self.accessibility()?;
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
