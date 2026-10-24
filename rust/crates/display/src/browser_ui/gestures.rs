//! Browser gesture state; sends the existing input and display actions only.
use super::*;

#[derive(Default)]
pub(super) struct Gestures {
    touches: BTreeMap<i64, (f64, f64)>,
    pinch: Option<(f64, f64)>,
    pinching: bool,
    motion: Option<ZoomMotion>,
    anchor: Option<(f64, f64, f64, f64)>,
    hold: Option<MovementHold>,
    repeat_setting_hold: Option<(i64, u64)>,
}

#[derive(Clone)]
enum HoldSource {
    Pointer(i64),
    Keyboard { physical: String, modifiers: u32 },
}
#[derive(Clone)]
struct MovementHold {
    source: HoldSource,
    action: Value,
    last_request: u64,
    token: u64,
    repeating: bool,
}
impl HoldSource {
    fn pointer(&self) -> Option<i64> { match self {Self::Pointer(id)=>Some(*id),_=>None} }
}
fn physical_key(event: &Value) -> &str {
    if s(&event["code"]).is_empty() {s(&event["key"])} else {s(&event["code"])}
}
fn movement_intent(raw: u32) -> bool {
    use rogue_contract::*;
    if raw & RG_EVENT_ALT != 0 { return false; }
    match raw & RG_EVENT_SCALAR_MASK {
        RG_KEY_UP | RG_KEY_DOWN | RG_KEY_LEFT | RG_KEY_RIGHT | RG_KEY_HOME | RG_KEY_END | RG_KEY_PAGE_UP | RG_KEY_PAGE_DOWN => true,
        0..=127 => {let key=(raw & RG_EVENT_SCALAR_MASK) as u8;
            key==b'.' || b"hjklyubn".contains(&if (1..=26).contains(&key) {key+b'a'-1} else {key.to_ascii_lowercase()})},
        _=>false,
    }
}

struct ZoomMotion {
    current: f64,
    target: f64,
    last: f64,
    anchor: Option<(f64, f64, f64, f64)>,
}

impl BrowserUi {
    pub(super) fn captured_ids(&self) -> Vec<i64> {
        let mut ids: Vec<_> = self.gestures.touches.keys().copied().collect();
        if let Some(drag)=self.controls_editor.as_ref().and_then(|editor|editor.drag.as_ref()) {ids.push(drag.id);}
        if let Some(drag) = &self.drag {
            if !ids.contains(&drag.id) {
                ids.push(drag.id);
            }
        }
        ids
    }

    fn zoom_at(&mut self, size: f64, x: f64, y: f64, effects: &mut Vec<Value>) {
        let size = clamp(size, MIN_MAP_SIZE, MAX_MAP_SIZE);
        self.gestures.motion = None;
        if (size - n(&self.model["tileSize"])).abs() < 0.0001
            && !self.mobile_overview
            && !self.mobile_full_map
        {
            return;
        }
        if let (Some(camera), Some(map)) = (self.camera, self.map_rect) {
            self.gestures.anchor = Some((
                (camera.left + x - map.x) / camera.size,
                (camera.top + y - map.y) / camera.cell_h,
                x - map.x,
                y - map.y,
            ));
        }
        self.mobile_overview = false;
        self.mobile_full_map = false;
        effects.push(json!({"kind":"zoom","size":size}));
    }

    pub(super) fn apply_zoom_anchor(&mut self) {
        if let Some((wx, wy, x, y)) = self.gestures.anchor.take() {
            if let Some(camera) = &mut self.camera {
                camera.left = wx * camera.size - x;
                camera.top = wy * camera.cell_h - y;
            }
        }
    }

    pub(super) fn wheel_zoom(&mut self, event: &Value, effects: &mut Vec<Value>) {
        let delta = n(&event["dy"])
            * match n(&event["deltaMode"]) as u32 {
                1 => 24.,
                2 => self.height,
                _ => 1.,
            };
        if delta == 0. {
            return;
        }
        let actual = self
            .camera
            .map(|c| c.size)
            .unwrap_or(n(&self.model["tileSize"]));
        let previous = self
            .gestures
            .motion
            .as_ref()
            .map_or(actual, |motion| motion.target);
        let target = clamp(
            previous * (-delta * 0.002).exp(),
            MIN_MAP_SIZE,
            MAX_MAP_SIZE,
        );
        let anchor = self.camera.zip(self.map_rect).map(|(camera, map)| {
            (
                (camera.left + n(&event["x"]) - map.x) / camera.size,
                (camera.top + n(&event["y"]) - map.y) / camera.cell_h,
                n(&event["x"]) - map.x,
                n(&event["y"]) - map.y,
            )
        });
        self.gestures.motion = Some(ZoomMotion {
            current: actual,
            target,
            last: 0.,
            anchor,
        });
        self.mobile_overview = false;
        self.mobile_full_map = false;
        effects.push(json!({"kind":"zoom","size":target}));
    }

    pub(super) fn animate_zoom(&mut self) {
        let Some(motion) = &mut self.gestures.motion else {
            return;
        };
        let now = n(&self.view["now"]);
        let elapsed = if motion.last == 0. {
            0.
        } else {
            (now - motion.last).max(0.)
        };
        motion.last = now;
        motion.current += (motion.target - motion.current) * (1. - (-elapsed / 55.).exp());
        let complete = (motion.target - motion.current).abs() < 0.002;
        if complete {
            motion.current = motion.target;
        }
        self.model["tileSize"] = json!(motion.current);
        self.gestures.anchor = motion.anchor;
        if complete {
            self.gestures.motion = None;
        }
    }

    pub(super) fn zoom_animating(&self) -> bool {
        self.gestures.motion.is_some()
    }

    pub(super) fn touch_gesture(&mut self, event: &Value, effects: &mut Vec<Value>) -> bool {
        if event["type"] == "cancel" && event["id"].is_null() {
            for id in self.gestures.touches.keys() {
                effects.push(json!({"kind":"release","id":id}));
            }
            self.gestures = Gestures::default();
            return false;
        }
        let id = event["id"].as_i64().unwrap_or(0);
        let x = n(&event["x"]);
        let y = n(&event["y"]);
        match s(&event["type"]) {
            "down"
                if event["pointerType"] == "touch"
                    && self.map_rect.is_some_and(|r| r.contains(x, y))
                    && self.hit(x, y).is_none()
                    && !b(&self.model["settingsOpen"])
                    && !self.model["frame"]["ui"]["window"].is_object() =>
            {
                self.gestures.touches.insert(id, (x, y));
                if self.gestures.touches.len() >= 2 {
                    self.drag = None;
                    self.widgets.pressed.clear();
                    self.gestures.hold = None;
                    self.gestures.pinching = true;
                    self.gestures.motion = None;
                    let points: Vec<_> = self.gestures.touches.values().copied().take(2).collect();
                    let distance = (points[0].0 - points[1].0)
                        .hypot(points[0].1 - points[1].1)
                        .max(1.);
                    self.gestures.pinch = Some((
                        distance,
                        self.camera
                            .map(|c| c.size)
                            .unwrap_or(n(&self.model["tileSize"])),
                    ));
                    effects.push(json!({"kind":"capture","id":id}));
                    return true;
                }
            }
            "move" if self.gestures.pinching => {
                if let Some(point) = self.gestures.touches.get_mut(&id) {
                    *point = (x, y);
                }
                if let Some((distance, size)) = self.gestures.pinch {
                    let points: Vec<_> = self.gestures.touches.values().copied().take(2).collect();
                    if points.len() == 2 {
                        let target = size
                            * (points[0].0 - points[1].0).hypot(points[0].1 - points[1].1)
                            / distance;
                        self.zoom_at(
                            target,
                            (points[0].0 + points[1].0) / 2.,
                            (points[0].1 + points[1].1) / 2.,
                            effects,
                        );
                    }
                }
                return true;
            }
            "up" | "cancel" => {
                self.gestures.touches.remove(&id);
                if self.gestures.pinching {
                    effects.push(json!({"kind":"release","id":id}));
                    self.gestures.pinch = None;
                    if self.gestures.touches.is_empty() {
                        self.gestures.pinching = false;
                    }
                    return true;
                }
            }
            _ => {}
        }
        false
    }

    fn next_hold_token(&mut self) -> u64 {
        self.hold_nonce = self.hold_nonce.wrapping_add(1);
        self.hold_nonce
    }
    fn begin_movement_hold(&mut self, source: HoldSource, action: Value, effects: &mut Vec<Value>) {
        let token=self.next_hold_token();
        effects.push(json!({"kind":"hold-timer","id":source.pointer(),"token":token,"delay":350}));
        self.gestures.hold=Some(MovementHold {source,action,last_request:n(&self.model["inputRequests"]) as u64,token,repeating:false});
    }
    pub(super) fn start_hold(&mut self, control: &Control, id: i64, effects: &mut Vec<Value>) {
        if control.action["kind"] == "command" && control.action["id"] == "web.repeat" && !control.disabled
            && self.model["input"]["kind"] == "command" {
            let token=self.next_hold_token();
            self.gestures.repeat_setting_hold = Some((id,token));
            effects.push(json!({"kind":"hold-timer","id":id,"token":token,"delay":500}));
            return;
        }
        if control.id.starts_with("touch-") && control.id.len() == 7 && !control.disabled
            && self.model["input"]["kind"] == "command" && !b(&self.model["frame"]["ui"]["movement_direction"]) {
            self.activate(control, &Value::Null, effects);
            self.begin_movement_hold(HoldSource::Pointer(id),control.action.clone(),effects);
        }
    }
    pub(super) fn suppress_held_repeat(&mut self, event: &Value) -> bool {
        if !b(&event["repeat"]) {
            self.movement_presses.remove(physical_key(event));
            return false;
        }
        self.movement_presses.contains(physical_key(event))
    }
    pub(super) fn start_keyboard_hold(&mut self, event: &Value, command: bool, direction: bool, effects: &mut Vec<Value>) {
        if !s(&event["native"]).is_empty() || b(&event["composing"]) || n(&event["keyCode"])==229. || b(&event["metaKey"]) || !(command || direction) { return; }
        let Some(action)=effects.iter().find(|e|e["kind"]=="send" && e["key"].as_u64().is_some_and(|k|movement_intent(k as u32))).cloned() else {return;};
        let physical=physical_key(event).to_string();
        self.movement_presses.insert(physical.clone());
        if b(&event["repeat"]) {
            effects.retain(|e|e!=&action);
        } else if command && self.map_navigation_available() {
            let modifiers=if b(&event["shiftKey"]) {rogue_contract::RG_EVENT_SHIFT}else{0}
                | if b(&event["ctrlKey"]) {rogue_contract::RG_EVENT_CTRL}else{0}
                | if b(&event["altKey"]) {rogue_contract::RG_EVENT_ALT}else{0};
            self.begin_movement_hold(HoldSource::Keyboard {physical,modifiers},action,effects);
        }
    }
    pub(super) fn release_keyboard_hold(&mut self, event: &Value) {
        let physical=physical_key(event);
        self.movement_presses.remove(physical);
        if self.gestures.hold.as_ref().is_some_and(|hold|match &hold.source {
            HoldSource::Keyboard {physical:held,modifiers}=>held==physical
                || matches!(s(&event["key"]),"Shift") && modifiers & rogue_contract::RG_EVENT_SHIFT != 0
                || matches!(s(&event["key"]),"Control") && modifiers & rogue_contract::RG_EVENT_CTRL != 0
                || matches!(s(&event["key"]),"Alt") && modifiers & rogue_contract::RG_EVENT_ALT != 0,
            _=>false,
        }) {self.stop_hold();}
    }
    /// Local wait holds pause only the player presentation, never C turns.
    pub fn wait_held(&self) -> bool {
        self.gestures.hold.as_ref().is_some_and(|hold|hold.repeating
            && hold.action["key"].as_u64().is_some_and(|key|key as u32 & !rogue_contract::RG_EVENT_REPEAT == 46)) && self.wait_available()
    }
    pub(super) fn wait_available(&self) -> bool {
        b(&self.model["running"]) && !b(&self.model["topOpen"]) && !b(&self.model["settingsOpen"])
            && !b(&self.model["returnAfterEnd"]) && self.model["input"]["kind"] == "command"
            && !self.model["frame"]["ui"]["window"].is_object()
            && !self.commands_open && !self.history_open && !self.status_open
            && !self.mobile_operations && !self.mobile_repeat_open
    }
    pub fn map_navigation_available(&self) -> bool {
        self.wait_available() && !b(&self.model["frame"]["ui"]["movement_direction"])
    }
    pub(super) fn holding(&self, id: i64) -> bool {
        self.gestures.hold.as_ref().is_some_and(|h|h.source.pointer()==Some(id))
    }
    pub(super) fn stop_pointer_hold(&mut self) {
        if self.gestures.hold.as_ref().is_some_and(|hold|hold.source.pointer().is_some())
            || self.gestures.repeat_setting_hold.is_some() {self.stop_hold();}
    }
    pub(super) fn stop_hold(&mut self) {
        self.gestures.hold = None;
        self.gestures.repeat_setting_hold = None;
    }
    pub(super) fn repeat_hold(&mut self, event: &Value, effects: &mut Vec<Value>) {
        if let Some((id,token)) = self.gestures.repeat_setting_hold {
            if event["id"].as_i64()!=Some(id) || event["token"].as_u64()!=Some(token) {return;}
            self.gestures.repeat_setting_hold = None;
            if self.drag.as_ref().is_some_and(|d| d.id == id && !d.moved
                && d.scope == self.scope && d.hit.as_ref().is_some_and(|c| c.rect.contains(d.last_x,d.last_y)))
                && self.model["input"]["kind"] == "command" && b(&self.model["running"])
                && !b(&self.model["settingsOpen"]) && !self.mobile_operations
                && !self.model["frame"]["ui"]["window"].is_object() {
                if let Some(drag) = &mut self.drag { drag.activated = true; }
                self.open_repeat_count(effects);
            }
            return;
        }
        let Some(mut hold)=self.gestures.hold.clone() else {return;};
        if event["token"].as_u64()!=Some(hold.token) || event["id"].as_i64()!=hold.source.pointer() {return;}
        let source_valid=match &hold.source {
            HoldSource::Pointer(id)=>self.drag.as_ref().is_some_and(|d|d.id==*id && !d.moved && d.scope==self.scope
                && d.hit.as_ref().is_some_and(|c|c.rect.contains(d.last_x,d.last_y))),
            HoldSource::Keyboard {physical,..}=>self.movement_presses.contains(physical),
        };
        if !source_valid || !self.map_navigation_available() {self.stop_hold();return;}
        hold.repeating=true;
        let request=n(&self.model["inputRequests"]) as u64;
        if request!=hold.last_request {
            let mut action=hold.action.clone();
            action["key"]=json!((n(&action["key"]) as u32)|rogue_contract::RG_EVENT_REPEAT);
            effects.push(action);
            hold.last_request=request;
        }
        effects.push(json!({"kind":"hold-timer","id":hold.source.pointer(),"token":hold.token,"delay":100}));
        self.gestures.hold=Some(hold);
    }
}
