//! Browser gesture state; sends the existing input and display actions only.
use super::*;

#[derive(Default)]
pub(super) struct Gestures {
    touches: BTreeMap<i64, (f64, f64)>,
    pinch: Option<(f64, f64)>,
    pinching: bool,
    wheel: f64,
    anchor: Option<(f64, f64, f64, f64)>,
    hold: Option<(i64, u64)>,
}

impl BrowserUi {
    pub(super) fn captured_ids(&self) -> Vec<i64> {
        let mut ids: Vec<_> = self.gestures.touches.keys().copied().collect();
        if let Some(drag) = &self.drag {
            if !ids.contains(&drag.id) {
                ids.push(drag.id);
            }
        }
        ids
    }

    fn zoom_at(&mut self, index: usize, x: f64, y: f64, effects: &mut Vec<Value>) {
        if index
            == self
                .zoom_sizes()
                .iter()
                .position(|&size| size == n(&self.model["tileSize"]))
                .unwrap_or(2)
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
        effects.push(json!({"kind":"zoom","index":index}));
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
        if self.gestures.wheel.signum() != delta.signum() {
            self.gestures.wheel = 0.;
        }
        self.gestures.wheel += delta;
        if self.gestures.wheel.abs() < 80. {
            return;
        }
        self.gestures.wheel = 0.;
        let sizes = self.zoom_sizes();
        let current = sizes
            .iter()
            .position(|&size| size == n(&self.model["tileSize"]))
            .unwrap_or(2);
        let next = if delta < 0. {
            (current + 1).min(sizes.len() - 1)
        } else {
            current.saturating_sub(1)
        };
        self.zoom_at(next, n(&event["x"]), n(&event["y"]), effects);
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
                    let points: Vec<_> = self.gestures.touches.values().copied().take(2).collect();
                    let distance = (points[0].0 - points[1].0)
                        .hypot(points[0].1 - points[1].1)
                        .max(1.);
                    self.gestures.pinch = Some((distance, self.camera.map(|c| if self.model["displayMode"] == "ascii" { c.size * 32. / 12. } else { c.size }).unwrap_or(n(&self.model["tileSize"]))));
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
                        let index = self
                            .zoom_sizes()
                            .iter()
                            .enumerate()
                            .min_by(|a, b| {
                                (a.1 / target)
                                    .ln()
                                    .abs()
                                    .total_cmp(&(b.1 / target).ln().abs())
                            })
                            .map(|(i, _)| i)
                            .unwrap_or(0);
                        self.zoom_at(
                            index,
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

    pub(super) fn start_hold(&mut self, control: &Control, id: i64, effects: &mut Vec<Value>) {
        if false && control.id.starts_with("touch-")
            && control.id.len() == 7
            && !control.disabled
            && self.mobile_movement == 0
            && self.model["input"]["kind"] == "command"
            && !b(&self.model["frame"]["ui"]["movement_direction"])
        {
            self.activate(control, &Value::Null, effects);
            self.gestures.hold = Some((id, n(&self.model["inputRequests"]) as u64));
            effects.push(json!({"kind":"hold-timer","id":id,"delay":350}));
        }
    }

    pub(super) fn holding(&self, id: i64) -> bool {
        self.gestures.hold.is_some_and(|h| h.0 == id)
    }
    pub(super) fn stop_hold(&mut self) {
        self.gestures.hold = None;
    }

    pub(super) fn repeat_hold(&mut self, event: &Value, effects: &mut Vec<Value>) {
        let Some((id, last)) = self.gestures.hold else {
            return;
        };
        if event["id"].as_i64() != Some(id) {
            return;
        }
        let Some(drag) = self
            .drag
            .clone()
            .filter(|d| d.id == id && !d.moved && d.scope == self.scope)
        else {
            self.stop_hold();
            return;
        };
        if b(&self.model["settingsOpen"])
            || self.history_open
            || self.mobile_operations
            || !b(&self.model["running"])
            || self.model["input"]["kind"] != "command"
            || self.model["frame"]["ui"]["window"].is_object()
        {
            self.stop_hold();
            return;
        }
        let request = n(&self.model["inputRequests"]) as u64;
        if request != last
            && let Some(control) = drag.hit
        {
            let mut action = control.action;
            action["key"] = json!((n(&action["key"]) as u32) | rogue_contract::RG_EVENT_REPEAT);
            effects.push(action);
            self.gestures.hold = Some((id, request));
        }
        effects.push(json!({"kind":"hold-timer","id":id,"delay":100}));
    }
}
