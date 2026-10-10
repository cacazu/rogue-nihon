use super::*;
use rogue_contract::*;
fn raw_key(e: &Value) -> Option<u32> {
    let key = s(&e["key"]);
    let code = match key {
        "ArrowUp" => RG_KEY_UP,
        "ArrowDown" => RG_KEY_DOWN,
        "ArrowLeft" => RG_KEY_LEFT,
        "ArrowRight" => RG_KEY_RIGHT,
        "Home" => RG_KEY_HOME,
        "End" => RG_KEY_END,
        "PageUp" => RG_KEY_PAGE_UP,
        "PageDown" => RG_KEY_PAGE_DOWN,
        "Escape" => 27,
        "Enter" => 13,
        "Backspace" => 8,
        "Tab" => 9,
        "Delete" => 127,
        _ => {
            let mut chars = key.chars();
            let code = chars.next()? as u32;
            if chars.next().is_some() {
                return None;
            }
            code
        }
    };
    Some(
        (code & RG_EVENT_SCALAR_MASK)
            | if b(&e["ctrlKey"]) { RG_EVENT_CTRL } else { 0 }
            | if b(&e["shiftKey"]) { RG_EVENT_SHIFT } else { 0 }
            | if b(&e["altKey"]) { RG_EVENT_ALT } else { 0 }
            | if b(&e["repeat"]) { RG_EVENT_REPEAT } else { 0 },
    )
}
impl BrowserUi {
    fn hit(&self, x: f64, y: f64) -> Option<Control> {
        self.widgets
            .controls
            .iter()
            .rev()
            .find(|c| c.rect.contains(x, y))
            .cloned()
    }
    fn region_at(&self, x: f64, y: f64) -> String {
        ["settings", "dialog", "top", "log", "hud", "map"]
            .into_iter()
            .find(|id| self.regions.get(*id).is_some_and(|r| r.rect.contains(x, y)))
            .unwrap_or("")
            .into()
    }
    fn scroll_by(&mut self, id: &str, delta: f64) {
        if let Some(region) = self.regions.get(id) {
            let scroll = clamp(
                self.scrolls.get(id).copied().unwrap_or(0.) + delta,
                0.,
                region.max,
            );
            self.scrolls.insert(id.into(), scroll);
            if id == "log" {
                self.follow_log = scroll >= region.max - 4.;
            }
        }
    }
    fn cancel_pointer(&mut self, clear_hover: bool, effects: &mut Vec<Value>) {
        if let Some(drag) = self.drag.take() {
            effects.push(json!({"kind":"release","id":drag.id}));
        }
        self.widgets.pressed.clear();
        if clear_hover {
            self.widgets.hover.clear();
        }
    }
    fn activate(&mut self, control: &Control, value: &Value, effects: &mut Vec<Value>) {
        if control.disabled {
            return;
        }
        match s(&control.action["kind"]) {
            "send" => {
                if b(&self.model["running"])
                    && !b(&self.model["topOpen"])
                    && !b(&self.model["settingsOpen"])
                    && !b(&self.model["returnAfterEnd"])
                {
                    effects.push(control.action.clone());
                }
            }
            "hud" => {
                let id = s(&control.action["id"]);
                self.hud.selected = if self.hud.selected == id {
                    String::new()
                } else {
                    id.into()
                };
            }
            "zoom" => {
                if value.is_null() {
                    return;
                }
                let sizes = self.zoom_sizes();
                let index = sizes
                    .iter()
                    .position(|&v| v == n(&self.model["tileSize"]))
                    .unwrap_or(0);
                let next = if value.is_number() {
                    (n(value) * (sizes.len() - 1) as f64).round()
                } else {
                    match s(value) {
                        "Home" => 0.,
                        "End" => (sizes.len() - 1) as f64,
                        "ArrowRight" => index as f64 + 1.,
                        _ => index as f64 - 1.,
                    }
                };
                effects.push(json!({"kind":"zoom","index":clamp(next,0.,(sizes.len()-1) as f64)}));
            }
            "focus" => {
                self.widgets.focus = control.id.clone();
                effects.push(control.action.clone());
            }
            _ => effects.push(control.action.clone()),
        }
    }
    /// Raw browser observations in; host API effects out. Never calls C or RNG.
    pub fn event(&mut self, event: Value) -> Value {
        let mut effects = Vec::new();
        let mut consumed = false;
        let x = n(&event["x"]);
        let y = n(&event["y"]);
        let id = event["id"].as_i64().unwrap_or(0);
        let mouse = event["pointerType"] == "mouse";
        match s(&event["type"]) {
            "raw-key" => return json!({"raw":raw_key(&event),"diagnostics":self.diagnostics()}),
            "center" => self.center_key.clear(),
            "cancel" => {
                if event["id"].is_null() || self.drag.as_ref().is_some_and(|d| d.id == id) {
                    self.cancel_pointer(true, &mut effects);
                }
                if b(&event["clearFocus"]) {
                    self.widgets.focus.clear();
                }
            }
            "leave" => self.widgets.hover.clear(),
            "down" => {
                if self.drag.is_some() && !b(&event["captured"]) {
                    self.cancel_pointer(true, &mut effects);
                }
                if n(&event["button"]) != 0. || event["primary"] == false || self.drag.is_some() {
                    consumed = event["pointerType"] == "touch";
                } else {
                    consumed = true;
                    let hit = self.hit(x, y);
                    if !hit.as_ref().is_some_and(|c| c.id.starts_with("hud-")) {
                        self.hud.selected.clear();
                    }
                    self.widgets.focus.clear();
                    self.widgets.hover = if mouse {
                        hit.as_ref().map(|c| c.id.clone()).unwrap_or_default()
                    } else {
                        String::new()
                    };
                    if let Some(c) = hit.as_ref().filter(|c| c.kind == "field") {
                        self.activate(c, &Value::Null, &mut effects);
                    } else {
                        self.widgets.pressed = hit
                            .as_ref()
                            .filter(|c| !c.disabled)
                            .map(|c| c.id.clone())
                            .unwrap_or_default();
                        self.drag = Some(Drag {
                            id,
                            scope: self.scope.clone(),
                            x,
                            y,
                            last_x: x,
                            last_y: y,
                            moved: false,
                            hit,
                            region: self.region_at(x, y),
                        });
                        effects.push(json!({"kind":"capture","id":id}));
                        effects.push(json!({"kind":"canvas-focus"}));
                    }
                }
            }
            "move" => {
                if self.drag.as_ref().is_none_or(|d| d.id == id) {
                    let hit = self.hit(x, y);
                    self.widgets.hover = if mouse {
                        hit.as_ref().map(|c| c.id.clone()).unwrap_or_default()
                    } else {
                        String::new()
                    };
                    let cursor = hit
                        .as_ref()
                        .map(|c| {
                            if c.disabled {
                                "default"
                            } else if c.kind == "field" {
                                "text"
                            } else {
                                "pointer"
                            }
                        })
                        .unwrap_or("default");
                    effects.push(json!({"kind":"cursor","value":cursor}));
                    if let Some(mut drag) = self.drag.take() {
                        if n(&event["buttons"]) == 0. || !b(&event["captured"]) {
                            self.drag = Some(drag);
                            self.cancel_pointer(true, &mut effects);
                        } else {
                            let dx = x - drag.last_x;
                            let dy = y - drag.last_y;
                            drag.last_x = x;
                            drag.last_y = y;
                            drag.moved |= (x - drag.x).hypot(y - drag.y) > 6.;
                            self.widgets.pressed = drag
                                .hit
                                .as_ref()
                                .filter(|c| {
                                    !c.disabled
                                        && !drag.moved
                                        && hit.as_ref().is_some_and(|h| h.id == c.id)
                                })
                                .map(|c| c.id.clone())
                                .unwrap_or_default();
                            if let Some(c) = drag
                                .hit
                                .as_ref()
                                .filter(|c| c.kind == "slider" && !c.disabled)
                            {
                                self.activate(
                                    c,
                                    &json!(clamp((x - c.full_rect.x) / c.full_rect.w, 0., 1.)),
                                    &mut effects,
                                );
                            }
                            if drag.moved && (drag.hit.is_none() || drag.region == "hud") {
                                if drag.region == "hud" {
                                    self.scroll_by("hud", -dx);
                                } else if drag.region == "map" {
                                    if let Some(c) = &mut self.camera {
                                        c.left -= dx;
                                        c.top -= dy;
                                    }
                                    self.constrain_camera();
                                } else {
                                    self.scroll_by(&drag.region, -dy);
                                }
                            }
                            self.drag = Some(drag);
                        }
                    } else if !b(&self.model["settingsOpen"])
                        && !self.model["frame"]["ui"]["window"].is_object()
                        && self.map_rect.is_some_and(|r| r.contains(x, y))
                        && let Some(cell) = self.map_cell(x, y)
                    {
                        let f = &self.model["frame"];
                        let index = n(&cell["y"]) * n(&f["width"]) + n(&cell["x"]);
                        let tile = n(&f["map_tiles"][index as usize]) as usize;
                        self.description = s(&self.model["tileDescriptions"][tile]).into();
                    }
                }
            }
            "up" => {
                if self.drag.as_ref().is_some_and(|d| d.id == id) {
                    let drag = self.drag.clone().unwrap();
                    self.cancel_pointer(!mouse, &mut effects);
                    if b(&event["captured"])
                        && drag.scope == self.scope
                        && !drag.moved
                        && (x - drag.x).hypot(y - drag.y) <= 6.
                    {
                        let hit = self.hit(x, y);
                        if let Some(original) = drag.hit {
                            if let Some(hit) = hit.filter(|c| c.id == original.id && !c.disabled) {
                                if hit.kind == "slider" {
                                    self.widgets.focus = hit.id.clone();
                                    self.activate(
                                        &hit,
                                        &json!(clamp(
                                            (x - hit.full_rect.x) / hit.full_rect.w,
                                            0.,
                                            1.
                                        )),
                                        &mut effects,
                                    );
                                } else {
                                    self.activate(&hit, &Value::Null, &mut effects);
                                }
                            }
                        } else if hit.is_none() {
                            if b(&self.model["settingsOpen"]) {
                                effects.push(json!({"kind":"invoke","id":"settings-close"}));
                            } else if drag.region == "map"
                                && !b(&self.model["topOpen"])
                                && !self.model["frame"]["ui"]["window"].is_object()
                                && self.map_rect.is_some_and(|r| r.contains(x, y))
                                && let Some(cell) = self.map_cell(x, y)
                            {
                                self.move_to_cell(&cell, &mut effects);
                            }
                        }
                    }
                }
            }
            "wheel" => {
                let region = self.region_at(x, y);
                if !region.is_empty() {
                    consumed = true;
                    if region == "hud" {
                        self.scroll_by(
                            "hud",
                            if n(&event["dx"]) != 0. {
                                n(&event["dx"])
                            } else {
                                n(&event["dy"])
                            },
                        );
                    } else if region == "map" {
                        if let Some(c) = &mut self.camera {
                            c.top += n(&event["dy"]);
                            c.left += n(&event["dx"]);
                        }
                        self.constrain_camera();
                    } else {
                        self.scroll_by(&region, n(&event["dy"]));
                    }
                }
            }
            "key" => {
                consumed = self.key_event(&event, &mut effects);
            }
            _ => {}
        }
        json!({"consumed":consumed,"effects":effects,"diagnostics":self.diagnostics()})
    }
    fn move_to_cell(&self, cell: &Value, effects: &mut Vec<Value>) {
        let f = &self.model["frame"];
        if !b(&self.model["running"])
            || f["ui"]["mode"] != "game"
            || b(&self.model["returnAfterEnd"])
            || b(&self.model["topOpen"])
            || b(&self.model["settingsOpen"])
        {
            return;
        }
        let dx = n(&cell["x"]) - n(&f["player"]["x"]);
        let dy = n(&cell["y"]) - n(&f["player"]["y"]);
        if dx.abs() > 1. || dy.abs() > 1. || (dx == 0. && dy == 0.) {
            return;
        }
        let key = if dy < 0. {
            if dx < 0. {
                RG_KEY_HOME
            } else if dx > 0. {
                RG_KEY_PAGE_UP
            } else {
                RG_KEY_UP
            }
        } else if dy > 0. {
            if dx < 0. {
                RG_KEY_END
            } else if dx > 0. {
                RG_KEY_PAGE_DOWN
            } else {
                RG_KEY_DOWN
            }
        } else if dx < 0. {
            RG_KEY_LEFT
        } else {
            RG_KEY_RIGHT
        };
        effects.push(json!({"kind":"send","key":key}));
    }
    fn key_event(&mut self, e: &Value, effects: &mut Vec<Value>) -> bool {
        if self.model.is_null() || b(&e["composing"]) || b(&e["metaKey"]) {
            return false;
        }
        let key = s(&e["key"]);
        let native = s(&e["native"]);
        if key == "Tab" {
            let modal =
                self.model["frame"]["ui"]["window"].is_object() && !b(&self.model["settingsOpen"]);
            let controls: Vec<_> = self
                .widgets
                .controls
                .iter()
                .filter(|c| {
                    !c.disabled
                        && (!modal
                            || [
                                "item-",
                                "window-",
                                "submit-text",
                                "prompt-text",
                                "command-key",
                                "result-top",
                            ]
                            .iter()
                            .any(|prefix| c.id.starts_with(prefix)))
                })
                .cloned()
                .collect();
            if controls.is_empty() {
                return false;
            }
            let current = if native.is_empty() {
                &self.widgets.focus
            } else {
                native
            };
            let index = controls
                .iter()
                .position(|c| c.id == current)
                .map(|i| i as i64)
                .unwrap_or(-1);
            let step = if b(&e["shift"]) { -1 } else { 1 };
            let next = &controls[(index + step).rem_euclid(controls.len() as i64) as usize];
            self.widgets.focus = next.id.clone();
            if next.id.starts_with("hud-") {
                let row: Rect =
                    serde_json::from_value(self.hud.layout["row"].clone()).expect("HUD row");
                let rect = next.full_rect;
                let delta = if rect.x < row.x {
                    rect.x - row.x
                } else {
                    (rect.x + rect.w - row.x - row.w).max(0.)
                };
                let offset = n(&self.hud.layout["offset"]) + delta;
                self.scrolls.insert(
                    "hud".into(),
                    clamp(offset, 0., n(&self.hud.layout["maxScroll"])),
                );
            }
            if next.kind == "field" {
                self.activate(next, &Value::Null, effects);
            } else {
                effects.push(json!({"kind":"canvas-focus"}));
            }
            return true;
        }
        if !native.is_empty() {
            if key == "Enter" {
                effects.push(json!({"kind":"submit","id":native}));
                return true;
            }
            if key == "Escape" {
                if matches!(native, "prompt-text" | "command-key") {
                    effects.push(json!({"kind":"send","key":27}));
                }
                effects.push(json!({"kind":"canvas-focus"}));
                self.widgets.focus.clear();
                return true;
            }
            return false;
        }
        if b(&self.model["settingsOpen"]) {
            match key {
                "Escape" => effects.push(json!({"kind":"invoke","id":"settings-close"})),
                "PageDown" | "PageUp" | "ArrowDown" | "ArrowUp" => self.scroll_by(
                    "settings",
                    match key {
                        "PageDown" => 180.,
                        "PageUp" => -180.,
                        "ArrowDown" => 36.,
                        _ => -36.,
                    },
                ),
                "Enter" | " " => {
                    if let Some(c) = self
                        .widgets
                        .controls
                        .iter()
                        .find(|c| c.id == self.widgets.focus && !c.disabled)
                        .cloned()
                    {
                        self.activate(&c, &Value::Null, effects);
                    }
                }
                "ArrowLeft" | "ArrowRight" | "Home" | "End" => {
                    if let Some(c) = self
                        .widgets
                        .controls
                        .iter()
                        .find(|c| c.id == self.widgets.focus && c.kind == "slider" && !c.disabled)
                        .cloned()
                    {
                        self.activate(&c, &json!(key), effects);
                    }
                }
                _ => {}
            }
            return true;
        }
        if key == "Escape"
            && (!self.hud.selected.is_empty()
                || self.widgets.hover.starts_with("hud-")
                || self.widgets.focus.starts_with("hud-"))
        {
            self.hud.selected.clear();
            self.widgets.hover.clear();
            self.widgets.focus.clear();
            return true;
        }
        if matches!(key, "Enter" | " ")
            && let Some(c) = self
                .widgets
                .controls
                .iter()
                .find(|c| c.id == self.widgets.focus && !c.disabled)
                .cloned()
        {
            self.activate(&c, &Value::Null, effects);
            return true;
        }
        if self.model["frame"]["ui"]["window"].is_object() && matches!(key, "PageDown" | "PageUp") {
            self.scroll_by("dialog", if key == "PageDown" { 200. } else { -200. });
            return true;
        }
        if b(&self.model["topOpen"]) && key == "Enter" {
            effects.push(json!({"kind":"invoke","id":"new-game"}));
            return true;
        }
        if !b(&self.model["topOpen"]) && !b(&self.model["returnAfterEnd"]) {
            if key == "Escape"
                && !self.model["frame"]["ui"]["window"].is_object()
                && !b(&self.model["frame"]["ui"]["movement_direction"])
                && b(&self.view["fullscreen"])
            {
                effects.push(json!({"kind":"invoke","id":"fullscreen"}));
                return true;
            }
            if b(&self.model["running"])
                && let Some(raw) = raw_key(e)
            {
                effects.push(json!({"kind":"send","key":raw}));
                return true;
            }
        }
        false
    }
}
