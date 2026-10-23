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
    Some(modified_key(e, code))
}
fn modified_key(e: &Value, code: u32) -> u32 {
    (code & RG_EVENT_SCALAR_MASK)
        | if b(&e["ctrlKey"]) { RG_EVENT_CTRL } else { 0 }
        | if b(&e["shiftKey"]) { RG_EVENT_SHIFT } else { 0 }
        | if b(&e["altKey"]) { RG_EVENT_ALT } else { 0 }
        | if b(&e["repeat"]) { RG_EVENT_REPEAT } else { 0 }
}
fn game_key(e: &Value, kind: &str) -> Option<u32> {
    if matches!(kind, "command" | "direction") {
        // Physical codes work with NumLock on and off. The number row stays numeric.
        let code = match s(&e["code"]) {
            "Numpad1" => Some(RG_KEY_END),
            "Numpad2" => Some(RG_KEY_DOWN),
            "Numpad3" => Some(RG_KEY_PAGE_DOWN),
            "Numpad4" => Some(RG_KEY_LEFT),
            "Numpad5" => Some(u32::from(b'.')),
            "Numpad6" => Some(RG_KEY_RIGHT),
            "Numpad7" => Some(RG_KEY_HOME),
            "Numpad8" => Some(RG_KEY_UP),
            "Numpad9" => Some(RG_KEY_PAGE_UP),
            _ => None,
        };
        if let Some(code) = code {
            return Some(modified_key(e, code));
        }
    }
    raw_key(e)
}

impl BrowserUi {
    pub(super) fn hit(&self, x: f64, y: f64) -> Option<Control> {
        self.widgets
            .controls
            .iter()
            .rev()
            .find(|c| c.rect.contains(x, y))
            .cloned()
    }
    fn region_at(&self, x: f64, y: f64) -> String {
        [
            "commands",
            "status",
            "settings",
            "mobile-operations",
            "inventory-tabs",
            "dialog",
            "top",
            "log",
            "hud",
            "map",
        ]
        .into_iter()
        .find(|id| self.regions.get(*id).is_some_and(|r| r.rect.contains(x, y)))
        .unwrap_or("")
        .into()
    }
    fn scroll_by(&mut self, id: &str, delta: f64) {
        if let Some(region) = self.regions.get(id).copied() {
            let scroll = clamp(
                self.scrolls.get(id).copied().unwrap_or(0.) + delta,
                0.,
                region.max,
            );
            self.scrolls.insert(id.into(), scroll);
            if id == "dialog" && self.inventory_list_visible() { self.remember_inventory_scroll(scroll); }
            if id == "inventory-tabs" { self.inventory_tabs.horizontal = scroll; }
            if id == "log" {
                self.follow_log = scroll >= region.max - 4.;
            }
        }
    }
    fn cancel_pointer(&mut self, clear_hover: bool, effects: &mut Vec<Value>) {
        self.stop_hold();
        if let Some(drag) = self.drag.take() {
            effects.push(json!({"kind":"release","id":drag.id}));
        }
        self.widgets.pressed.clear();
        if clear_hover {
            self.widgets.hover.clear();
        }
    }
    pub(super) fn activate(&mut self, control: &Control, _value: &Value, effects: &mut Vec<Value>) {
        if control.disabled {
            return;
        }
        if self.mobile_activate(control, effects) {
            return;
        }
        match s(&control.action["kind"]) {
            "inventory-tab" => {
                self.inventory_tabs.tab = s(&control.action["tab"]).into();
                self.inventory_tabs.reveal = true;
                self.widgets.focus = control.id.clone();
            }
            "dropdown" => {
                self.dropdown = s(&control.action["id"]).into();
                let selected = s(&self.model[if self.dropdown == "language" {
                    "language"
                } else {
                    "displayMode"
                }]);
                self.widgets.focus = format!("select-{}-{selected}", self.dropdown);
            }
            "dropdown-close" => self.dropdown.clear(),
            "dropdown-choice" => {
                self.dropdown.clear();
                effects.push(json!({"kind":"select","id":control.action["id"],"value":control.action["value"]}));
            }
            "commands" => {
                self.commands_open = b(&control.action["open"]);
                self.stop_hold();
                if self.commands_open {
                    self.history_open = false;
                    self.status_open = false;
                    self.mobile_operations = false;
                    self.scrolls.insert("commands".into(), 0.);
                }
            }
            "history" => {
                self.history_open = b(&control.action["open"]);
                self.follow_log = true;
            }
            "status" => {
                if b(&control.action["open"]) {
                    self.open_status();
                } else {
                    self.status_open = false;
                }
            }
            "send" => {
                if control.action["key"] == 64 && self.model["input"]["kind"] == "command" {
                    self.open_status();
                }
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
        if self.touch_gesture(&event, &mut effects) {
            return json!({"consumed":true,"effects":effects,"diagnostics":self.diagnostics()});
        }
        match s(&event["type"]) {
            "hold-tick" => self.repeat_hold(&event, &mut effects),
            "raw-key" => return json!({"raw":raw_key(&event),"diagnostics":self.diagnostics()}),
            "center" => self.center_key.clear(),
            "cancel" => {
                self.gestures.wait_key.clear();
                if event["id"].is_null() || self.drag.as_ref().is_some_and(|d| d.id == id) {
                    self.cancel_pointer(true, &mut effects);
                }
                if b(&event["clearFocus"]) {
                    self.widgets.focus.clear();
                }
            }
            "leave" => self.widgets.hover.clear(),
            "down" => {
                self.gestures.wait_key.clear();
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
                    let touch_scroll = event["pointerType"] == "touch"
                        && self.regions.get(&self.region_at(x, y)).is_some_and(|r| r.max > 0.);
                    if let Some(c) = hit.as_ref().filter(|c| c.kind == "field" && !touch_scroll) {
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
                            activated: false,
                            hit,
                            region: self.region_at(x, y),
                        });
                        effects.push(json!({"kind":"capture","id":id}));
                        effects.push(json!({"kind":"canvas-focus"}));
                        if let Some(control) = self.drag.as_ref().and_then(|d| d.hit.clone()) {
                            self.start_hold(&control, id, &mut effects);
                            if self.holding(id)
                                && let Some(drag) = &mut self.drag
                            {
                                drag.activated = true;
                            }
                        }
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
                            let touch_scroll = event["pointerType"] == "touch"
                                && self.regions.get(&drag.region).is_some_and(|r| r.max > 0.)
                                && drag.region != "map"
                                && !drag.hit.as_ref().is_some_and(|c| c.kind == "slider");
                            if drag.moved
                                && (drag.hit.is_none()
                                    || drag.region == "hud"
                                    || drag.region == "inventory-tabs"
                                    || drag.region == "log"
                                    || touch_scroll)
                            {
                                if drag.region == "hud" || drag.region == "inventory-tabs" {
                                    self.scroll_by(&drag.region, -dx);
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
                            if drag.moved || !drag.hit.as_ref().is_some_and(|c| c.rect.contains(x, y)) {
                                self.stop_hold();
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
                        && !drag.activated
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
                    if region == "hud" || region == "inventory-tabs" {
                        self.scroll_by(
                            &region,
                            if n(&event["dx"]) != 0. {
                                n(&event["dx"])
                            } else {
                                n(&event["dy"])
                            },
                        );
                    } else if region == "map" {
                        self.wheel_zoom(&event, &mut effects);
                    } else {
                        self.scroll_by(&region, n(&event["dy"]));
                    }
                }
            }
            "key" => {
                self.stop_hold();
                self.gestures.wait_key.clear();
                consumed = self.key_event(&event, &mut effects);
                if b(&event["repeat"]) && self.model["input"]["kind"] == "command"
                    && effects.iter().any(|effect| effect["kind"] == "send"
                        && effect["key"].as_u64().is_some_and(|key|
                            key as u32 & !RG_EVENT_REPEAT == u32::from(b'.'))) {
                    self.gestures.wait_key = if s(&event["code"]).is_empty() {
                        s(&event["key"]).into()
                    } else { s(&event["code"]).into() };
                }
            }
            "keyup" => {
                if self.gestures.wait_key == s(&event["code"])
                    || self.gestures.wait_key == s(&event["key"]) {
                    self.gestures.wait_key.clear();
                }
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
            || self.mobile_operations
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
    fn activate_shortcut(&mut self, event: &Value, scope: &str, effects: &mut Vec<Value>) -> bool {
        if b(&self.view["coarse"]) || b(&event["ctrlKey"]) || b(&event["altKey"])
            || self.widgets.shortcut_context != self.shortcut_context(scope) { return false; }
        let key = s(&event["key"]);
        // Enter/Space still activate a choice explicitly focused with Tab.
        if matches!(key, "Enter" | " ")
            && let Some(control) = self.widgets.controls.iter().find(|control|
                !control.disabled && control.kind != "field" && control.id == self.widgets.focus).cloned()
        {
            self.activate(&control, &Value::Null, effects);
            return true;
        }
        let controls = &self.widgets.controls;
        // Exact case takes priority: f and F are distinct original commands.
        let control = controls.iter().find(|c| !c.disabled && c.shortcut.as_deref() == Some(key))
            .or_else(|| controls.iter().find(|c| !c.disabled && key.len() == 1
                && c.shortcut.as_deref().is_some_and(|shortcut| shortcut.len() == 1
                    && shortcut.as_bytes()[0].is_ascii_lowercase() && shortcut.eq_ignore_ascii_case(key)))).cloned();
        if let Some(control) = control {
            self.activate(&control, &Value::Null, effects);
            true
        } else { false }
    }
    fn key_event(&mut self, e: &Value, effects: &mut Vec<Value>) -> bool {
        if self.model.is_null() || b(&e["composing"]) || b(&e["metaKey"]) {
            return false;
        }
        let key = s(&e["key"]);
        let native = s(&e["native"]);
        if self.commands_open {
            if self.activate_shortcut(e, "commands", effects) { return true; }
            match key {
                "Escape" => self.commands_open = false,
                "ArrowDown" => self.scroll_by("commands", 40.),
                "ArrowUp" => self.scroll_by("commands", -40.),
                "PageDown" => self.scroll_by("commands", self.regions.get("commands").map_or(200., |r| r.rect.h)),
                "PageUp" => self.scroll_by("commands", -self.regions.get("commands").map_or(200., |r| r.rect.h)),
                "Home" => self.scroll_by("commands", -f64::MAX),
                "End" => self.scroll_by("commands", f64::MAX),
                "Tab" => self.widgets.focus = "commands-close".into(),
                "Enter" | " " if self.widgets.focus == "commands-close" => self.commands_open = false,
                _ => {}
            }
            return true;
        }
        if self.mobile_repeat_open {
            if native.is_empty() && !(key == "Enter" && self.widgets.focus == "repeat-count-close")
                && self.activate_shortcut(e, "repeat-count", effects) { return true; }
            match key {
                "Escape" => {
                    self.mobile_repeat_open = false;
                    effects.push(json!({"kind":"canvas-focus"}));
                    return true;
                }
                "Enter" => {
                    if self.widgets.focus == "repeat-count-close" {
                        self.mobile_repeat_open = false;
                        effects.push(json!({"kind":"canvas-focus"}));
                    } else {
                        effects.push(json!({"kind":"submit","id":"repeat-count"}));
                    }
                    return true;
                }
                "Tab" => {}
                _ => return native != "repeat-count",
            }
        }
        if !self.dropdown.is_empty() {
            if self.activate_shortcut(e, "dropdown", effects) { return true; }
            self.dropdown_key(key, effects);
            return true;
        }
        if self.status_open {
            if self.activate_shortcut(e, "status", effects) { return true; }
            match key {
                "Escape" => self.status_open = false,
                "ArrowDown" | "PageDown" => self.scroll_by("status", 150.),
                "ArrowUp" | "PageUp" => self.scroll_by("status", -150.),
                "Enter" | " " if self.widgets.focus == "status-close" => self.status_open = false,
                "Tab" => self.widgets.focus = "status-close".into(),
                _ => {}
            }
            return true;
        }
        if self.history_open {
            if self.activate_shortcut(e, "history", effects) { return true; }
            match key {
                "Escape" => self.history_open = false,
                "ArrowDown" | "PageDown" => self.scroll_by("log", 180.),
                "ArrowUp" | "PageUp" => self.scroll_by("log", -180.),
                _ => {}
            }
            return true;
        }
        if self.inventory_list_visible() && self.widgets.focus.starts_with("inventory-tab-")
            && matches!(key,"ArrowLeft" | "ArrowRight") {
            let tabs = self.inventory_available_tabs(&self.model["frame"]["ui"]);
            let index = tabs.iter().position(|tab| *tab == self.inventory_tabs.tab).unwrap_or(0);
            let next = (index as i64 + if key == "ArrowRight" { 1 } else { -1 }).rem_euclid(tabs.len() as i64) as usize;
            self.inventory_tabs.tab = tabs[next].into();
            self.inventory_tabs.reveal = true;
            self.widgets.focus = format!("inventory-tab-{}",tabs[next]);
            return true;
        }
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
                                "inventory-tab-",
                                "inventory-history",
                                "inventory-return",
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
            if next.id.starts_with("inventory-tab-") { self.inventory_tabs.reveal = true; }
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
            if self.activate_shortcut(e, "settings", effects) { return true; }
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
        if self.mobile_operations {
            if self.activate_shortcut(e, "mobile-operations", effects) { return true; }
            match key {
                "Escape" => self.mobile_operations = false,
                "PageDown" | "PageUp" | "ArrowDown" | "ArrowUp" => self.scroll_by(
                    "mobile-operations",
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
                _ => {}
            }
            return true;
        }
        if self.model["frame"]["ui"]["window"].is_object()
            && self.activate_shortcut(e, "dialog", effects) { return true; }
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
        if self.model["frame"]["ui"]["window"].is_object()
            && self.model["input"]["kind"] != "direction"
            && matches!(key, "PageDown" | "PageUp") {
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
                && let Some(raw) = game_key(e, s(&self.model["input"]["kind"]))
            {
                let redraw = key == "@" && self.model["input"]["kind"] == "command";
                if redraw {
                    self.open_status();
                }
                // A forwarded key has no new map to paint. Its Worker reply
                // supplies the next visual state; local UI changes paint now.
                effects.push(json!({"kind":"send","key":raw,"redraw":redraw}));
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keypad_movement_preserves_text_number_row_and_modifier_contracts() {
        for (digit, unlocked, direction) in [
            (1,"End",RG_KEY_END),(2,"ArrowDown",RG_KEY_DOWN),(3,"PageDown",RG_KEY_PAGE_DOWN),
            (4,"ArrowLeft",RG_KEY_LEFT),(5,"Clear",46),(6,"ArrowRight",RG_KEY_RIGHT),
            (7,"Home",RG_KEY_HOME),(8,"ArrowUp",RG_KEY_UP),(9,"PageUp",RG_KEY_PAGE_UP),
        ] {
            for key in [digit.to_string(),unlocked.into()] {
                let event = json!({"key":key,"code":format!("Numpad{digit}"),"location":3,
                    "shiftKey":true,"ctrlKey":true,"repeat":true});
                for kind in ["command","direction"] {
                    assert_eq!(game_key(&event,kind),Some(direction | RG_EVENT_SHIFT | RG_EVENT_CTRL | RG_EVENT_REPEAT));
                }
                for kind in ["text","item","confirm","symbol","option_bool"] {
                    assert_eq!(game_key(&event,kind),raw_key(&event));
                }
            }
            let event=json!({"key":digit.to_string(),"code":format!("Digit{digit}")});
            assert_eq!(game_key(&event,"command"),Some(b'0' as u32+digit));
        }
    }
}
