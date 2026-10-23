//! Public projectile paths and presentation clocks. No rules, RNG, input or saves.
use crate::map_tiles;
use rogue_contract::*;
use serde_json::{Value, json};
use std::collections::BTreeMap;

const MAX_POINTS: usize = 256;
const MAX_FLIGHTS: usize = 16;

#[derive(Clone, Copy)]
pub struct Observation {
    pub phase: u32,
    pub kind: u32,
    pub glyph: i32,
    pub x: i32,
    pub y: i32,
}
#[derive(Clone, Copy, Debug)]
struct Point {
    x: u32,
    y: u32,
    gap: bool,
}
impl Point {
    fn json(self) -> Value {
        json!({"x":self.x,"y":self.y,"break":self.gap})
    }
}
struct Pending {
    kind: &'static str,
    glyph: u8,
    path: Vec<Point>,
    gap: bool,
    // Only the derived map hides C's instantaneous foreground. Original cells
    // and refreshes stay intact for original-screen and rule comparisons.
    masks: BTreeMap<usize, (u8, u8)>,
}
#[derive(Default)]
pub struct ObservedFlights {
    current: Option<Pending>,
    events: Vec<Value>,
    sequence: u64,
}
impl ObservedFlights {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    pub fn observe(&mut self, event: Observation, frame: Option<&Value>) {
        match event.phase {
            RG_FLIGHT_BEGIN => {
                self.current = None;
                let kind = match event.kind {
                    RG_PROJECTILE_ITEM => "item",
                    RG_PROJECTILE_ARROW => "arrow",
                    RG_PROJECTILE_MAGIC => "magic",
                    _ => return,
                };
                let Ok(glyph) = u8::try_from(event.glyph) else {
                    return;
                };
                if kind != "magic"
                    && !map_tiles::glyph(glyph).is_some_and(|tile| (14..=22).contains(&tile))
                {
                    return;
                }
                self.current = Some(Pending {
                    kind,
                    glyph,
                    path: Vec::new(),
                    gap: true,
                    masks: BTreeMap::new(),
                });
                self.point(event, frame);
            }
            RG_FLIGHT_POINT => self.point(event, frame),
            RG_FLIGHT_GAP => {
                if let Some(pending) = &mut self.current {
                    pending.gap = true;
                }
            }
            RG_FLIGHT_END => {
                if let Some(pending) = self
                    .current
                    .take()
                    .filter(|pending| pending.path.len() >= 2)
                {
                    if self.events.len() < MAX_FLIGHTS {
                        self.sequence = self.sequence.saturating_add(1);
                        self.events.push(json!({"sequence":self.sequence,"kind":pending.kind,"glyph":pending.glyph,
                            "path":pending.path.into_iter().map(Point::json).collect::<Vec<_>>()}));
                    }
                }
            }
            _ => {}
        }
    }
    fn point(&mut self, event: Observation, frame: Option<&Value>) {
        let Some(pending) = &mut self.current else {
            return;
        };
        let Some(frame) = frame else {
            pending.gap = true;
            return;
        };
        let (Ok(x), Ok(y)) = (u32::try_from(event.x), u32::try_from(event.y)) else {
            pending.gap = true;
            return;
        };
        let width = frame["width"].as_u64().unwrap_or(0) as u32;
        let height = frame["height"].as_u64().unwrap_or(0) as u32;
        if x >= width || y == 0 || y >= height.saturating_sub(1) || pending.path.len() >= MAX_POINTS
        {
            pending.gap = true;
            return;
        }
        let index = (y * width + x) as usize;
        let Some(glyph) = frame["map_cells"]
            .as_str()
            .and_then(|cells| cells.as_bytes().get(index))
            .copied()
            .filter(|glyph| *glyph != b' ')
        else {
            pending.gap = true;
            return;
        };
        if let Some(last) = pending.path.last() {
            if last.x == x && last.y == y {
                return;
            }
            if last.x.abs_diff(x) > 1 || last.y.abs_diff(y) > 1 {
                pending.gap = true;
            }
        }
        pending.path.push(Point {
            x,
            y,
            gap: pending.gap,
        });
        pending.gap = false;
        if let Ok(foreground) = u8::try_from(event.glyph) {
            pending.masks.entry(index).or_insert((foreground, glyph));
        }
    }
    pub fn mask(&self, cells: &mut [u8]) {
        if let Some(pending) = &self.current {
            for (&index, &(foreground, underlay)) in &pending.masks {
                if let Some(cell) = cells.get_mut(index).filter(|cell| **cell == foreground) {
                    *cell = underlay;
                }
            }
        }
    }
    pub fn take_events(&mut self) -> Value {
        Value::Array(std::mem::take(&mut self.events))
    }
}

struct Flight {
    sequence: u64,
    kind: String,
    glyph: u8,
    path: Vec<Point>,
    started: f64,
    duration: f64,
}
#[derive(Default)]
pub struct FlightAnimator {
    active: Vec<Flight>,
    epoch: Option<u32>,
    sequence: u64,
}
impl FlightAnimator {
    pub fn reset(&mut self) {
        *self = Self::default();
    }
    pub fn interrupt(&mut self) -> bool {
        let changed = !self.active.is_empty();
        self.active.clear();
        changed
    }
    pub fn observe(&mut self, frame: &Value, now: f64, enabled: bool) -> Result<(), String> {
        let epoch = frame["map_actor_epoch"].as_u64().unwrap_or(0) as u32;
        if self.epoch != Some(epoch) {
            self.reset();
            self.epoch = Some(epoch);
        }
        let Some(events) = frame.get("map_projectile_events") else {
            return Ok(());
        };
        let events = events
            .as_array()
            .filter(|events| events.len() <= MAX_FLIGHTS)
            .ok_or("Invalid public projectile events")?;
        for event in events {
            let sequence = event["sequence"]
                .as_u64()
                .filter(|sequence| *sequence > 0)
                .ok_or("Invalid projectile sequence")?;
            let kind = event["kind"]
                .as_str()
                .filter(|kind| matches!(*kind, "magic" | "item" | "arrow"))
                .ok_or("Invalid projectile kind")?;
            let glyph = event["glyph"]
                .as_u64()
                .and_then(|glyph| u8::try_from(glyph).ok())
                .ok_or("Invalid projectile glyph")?;
            if kind != "magic"
                && !map_tiles::glyph(glyph).is_some_and(|tile| (14..=22).contains(&tile))
            {
                return Err("Invalid projectile item".into());
            }
            let points = event["path"]
                .as_array()
                .filter(|points| (2..=MAX_POINTS).contains(&points.len()))
                .ok_or("Invalid projectile path")?;
            let mut path = Vec::with_capacity(points.len());
            for point in points {
                let x = point["x"]
                    .as_u64()
                    .filter(|x| *x < frame["width"].as_u64().unwrap_or(0))
                    .ok_or("Invalid projectile x")? as u32;
                let y = point["y"]
                    .as_u64()
                    .filter(|y| *y > 0 && *y + 1 < frame["height"].as_u64().unwrap_or(0))
                    .ok_or("Invalid projectile y")? as u32;
                let gap = point["break"]
                    .as_bool()
                    .ok_or("Invalid projectile visibility break")?;
                if let Some(last) = path.last().copied().filter(|_: &Point| !gap) {
                    if last.x.abs_diff(x) > 1 || last.y.abs_diff(y) > 1 {
                        return Err("Projectile crosses unobserved cells".into());
                    }
                }
                path.push(Point { x, y, gap });
            }
            if sequence <= self.sequence {
                continue;
            }
            self.sequence = sequence;
            if enabled {
                if self.active.len() == MAX_FLIGHTS {
                    self.active.remove(0);
                }
                let steps = path.len().saturating_sub(1) as f64;
                self.active.push(Flight {
                    sequence,
                    kind: kind.into(),
                    glyph,
                    path,
                    started: now,
                    duration: (steps * 45.).clamp(240., 850.),
                });
            }
        }
        Ok(())
    }
    pub fn sample(&mut self, now: f64, graphical: bool) -> (Value, Option<u32>) {
        self.active
            .retain(|flight| now - flight.started < flight.duration);
        let mut frames = Vec::new();
        if graphical {
            for flight in &self.active {
                let progress = ((now - flight.started) / flight.duration).clamp(0., 1.);
                let step = progress * (flight.path.len() - 1) as f64;
                let index = (step.floor() as usize).min(flight.path.len() - 2);
                let a = flight.path[index];
                let b = flight.path[index + 1];
                let fraction = step.fract();
                // A visibility gap appears at its next observed point. It is
                // never interpolated through an unknown cell or hidden route.
                let (x, y) = if b.gap {
                    (f64::from(b.x), f64::from(b.y))
                } else {
                    (
                        f64::from(a.x) + (f64::from(b.x) - f64::from(a.x)) * fraction,
                        f64::from(a.y) + (f64::from(b.y) - f64::from(a.y)) * fraction,
                    )
                };
                let direction = (f64::from(b.y) - f64::from(a.y))
                    .atan2(f64::from(b.x) - f64::from(a.x))
                    .to_degrees();
                let rotation = if flight.kind == "item" {
                    (((now - flight.started).max(0.) * 0.72 / 15.).floor() * 15.) % 360.
                } else {
                    direction
                };
                frames.push(json!({"sequence":flight.sequence,"kind":flight.kind,"glyph":flight.glyph,"x":x,"y":y,
                    "rotation":rotation,"progress":progress}));
            }
        }
        let delay = (!frames.is_empty()).then_some(16);
        (Value::Array(frames), delay)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn map() -> Value {
        let mut cells=vec![b'.';40];cells[..8].fill(b' ');cells[32..].fill(b' ');cells[18]=b'@';cells[13]=b' ';
        json!({"width":8,"height":5,"map_cells":String::from_utf8(cells).unwrap(),"map_actor_epoch":1})
    }
    fn event(kind: &str, path: &[(u32, u32, bool)]) -> Value {
        json!({"map_actor_epoch":1,"width":8,"height":5,"map_projectile_events":[{"sequence":1,"kind":kind,"glyph":41,
            "path":path.iter().map(|&(x,y,gap)| Point{x,y,gap}.json()).collect::<Vec<_>>() }]})
    }
    #[test]
    fn observed_flights_hide_only_transient_foreground_and_never_publish_unknown_cells() {
        let mut observed = ObservedFlights::default();
        let frame = map();
        observed.observe(
            Observation {
                phase: RG_FLIGHT_BEGIN,
                kind: RG_PROJECTILE_ITEM,
                glyph: 41,
                x: 2,
                y: 2,
            },
            Some(&frame),
        );
        observed.observe(
            Observation {
                phase: RG_FLIGHT_POINT,
                kind: 0,
                glyph: 41,
                x: 3,
                y: 2,
            },
            Some(&frame),
        );
        let mut cells = frame["map_cells"].as_str().unwrap().as_bytes().to_vec();
        cells[19] = 41;
        observed.mask(&mut cells);
        assert_eq!(cells[19], b'.');
        // A real changed monster glyph is not replaced by the cached underlay.
        cells[19] = b'Z';
        observed.mask(&mut cells);
        assert_eq!(cells[19], b'Z');
        observed.observe(
            Observation {
                phase: RG_FLIGHT_POINT,
                kind: 0,
                glyph: 41,
                x: 5,
                y: 1,
            },
            Some(&frame),
        );
        observed.observe(
            Observation {
                phase: RG_FLIGHT_POINT,
                kind: 0,
                glyph: 41,
                x: 6,
                y: 2,
            },
            Some(&frame),
        );
        observed.observe(
            Observation {
                phase: RG_FLIGHT_END,
                kind: 0,
                glyph: 0,
                x: 0,
                y: 0,
            },
            Some(&frame),
        );
        let events = observed.take_events();
        let path = events[0]["path"].as_array().unwrap();
        assert!(!path.iter().any(|p| p["x"] == 5 && p["y"] == 1));
        assert_eq!(path.last().unwrap()["break"], true);
        assert_eq!(observed.take_events(), json!([]));
    }
    #[test]
    fn flight_clock_moves_items_with_bounded_spin_and_arrows_without_spin() {
        for kind in ["item", "arrow", "magic"] {
            let mut animator = FlightAnimator::default();
            let frame = event(kind, &[(2, 2, true), (3, 2, false), (4, 2, false)]);
            animator.observe(&frame, 100., true).unwrap();
            let (first, _) = animator.sample(120., true);
            let (second, delay) = animator.sample(220., true);
            assert!(second[0]["x"].as_f64().unwrap() > first[0]["x"].as_f64().unwrap());
            assert_eq!(delay, Some(16));
            if kind == "item" {
                assert_ne!(first[0]["rotation"], second[0]["rotation"]);
                assert_eq!(second[0]["rotation"].as_f64().unwrap() % 15., 0.);
            } else {
                assert_eq!(first[0]["rotation"], 0.);
                assert_eq!(second[0]["rotation"], 0.);
            }
            // A cached redraw cannot restart a flight with the same sequence.
            animator.observe(&frame, 230., true).unwrap();
            assert_eq!(animator.sample(341., true), (json!([]), None));
        }
    }
    #[test]
    fn reflected_magic_and_visibility_gaps_keep_the_original_route() {
        let mut animator = FlightAnimator::default();
        animator
            .observe(
                &event("magic", &[(3, 2, true), (2, 2, false), (3, 2, false)]),
                0.,
                true,
            )
            .unwrap();
        assert_eq!(animator.sample(60., true).0[0]["rotation"], 180.);
        assert_eq!(animator.sample(180., true).0[0]["rotation"], 0.);
        animator.reset();
        animator
            .observe(
                &event("magic", &[(1, 2, true), (6, 2, true), (7, 2, false)]),
                0.,
                true,
            )
            .unwrap();
        assert_eq!(animator.sample(60., true).0[0]["x"], 6.);
        assert!(
            animator
                .observe(&event("magic", &[(1, 2, true), (6, 2, false)]), 0., true)
                .is_err()
        );
    }
    #[test]
    fn disabled_ascii_interruption_and_epoch_changes_do_not_replay_old_flights() {
        let frame = event("item", &[(2, 2, true), (3, 2, false)]);
        let mut animator = FlightAnimator::default();
        animator.observe(&frame, 0., false).unwrap();
        animator.observe(&frame, 10., true).unwrap();
        assert_eq!(animator.sample(20., true), (json!([]), None));
        animator.reset();
        animator.observe(&frame, 0., true).unwrap();
        assert_eq!(animator.sample(20., false), (json!([]), None));
        assert!(animator.interrupt());
        assert_eq!(animator.sample(20., true), (json!([]), None));
        animator.reset();
        animator.observe(&frame, 0., true).unwrap();
        let mut next = frame.clone();
        next["map_actor_epoch"] = json!(2);
        next["map_projectile_events"] = json!([]);
        animator.observe(&next, 20., true).unwrap();
        assert_eq!(animator.sample(20., true), (json!([]), None));
    }
}
