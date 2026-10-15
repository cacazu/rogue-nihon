//! Presentation clocks for public actors. No game state, input, RNG or save access.
use crate::map_tiles;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const MAX_ACTORS: usize = 1024;
const MAX_EVENTS: usize = 8192;
const MAX_CELLS: usize = 65_536;
const MOVE_MS: f64 = 120.;
const STATES: [&str; 4] = ["idle", "move", "attack", "hurt"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Idle,
    Move,
    Attack,
    Hurt,
}
impl State {
    fn index(self) -> usize {
        match self {
            Self::Idle => 0,
            Self::Move => 1,
            Self::Attack => 2,
            Self::Hurt => 3,
        }
    }
    fn event(value: &Value) -> Result<Self, String> {
        match value.as_str() {
            Some("move") => Ok(Self::Move),
            Some("attack") => Ok(Self::Attack),
            Some("hurt") => Ok(Self::Hurt),
            _ => Err("Invalid public actor event kind".into()),
        }
    }
}

#[derive(Clone, Debug)]
struct Clip {
    frames: Vec<String>,
    frame_ms: u32,
    looping: bool,
}
type Clips = BTreeMap<String, [Clip; 4]>;

#[derive(Clone, Copy, Debug)]
struct Motion {
    from_x: f64,
    from_y: f64,
    started: Option<f64>,
}

#[derive(Debug)]
struct Actor {
    x: u32,
    y: u32,
    tile: String,
    facing: i32,
    stopped: bool,
    chosen: State,
    started: Option<f64>,
    idle_started: Option<f64>,
    motion: Option<Motion>,
    last_pose: (State, usize),
}
impl Actor {
    fn new(data: ActorData) -> Self {
        Self {
            x: data.x,
            y: data.y,
            tile: data.tile,
            facing: data.facing,
            stopped: data.stopped,
            chosen: State::Idle,
            started: None,
            idle_started: None,
            motion: None,
            last_pose: (State::Idle, 0),
        }
    }
    fn finish(&mut self) {
        self.chosen = State::Idle;
        self.started = None;
        self.idle_started = None;
        self.motion = None;
    }
    fn choose(&mut self, state: State) {
        let priority = |state| match state {
            State::Attack => 2,
            State::Hurt => 1,
            _ => 0,
        };
        if !self.stopped && priority(state) > priority(self.chosen) {
            self.chosen = state;
            self.started = None;
        }
    }
    fn advance(&mut self, now: f64, clips: &[Clip; 4]) -> (State, usize, Option<u32>) {
        if self.stopped {
            return (self.last_pose.0, self.last_pose.1, None);
        }
        let mut state = self.chosen;
        let started = if state == State::Idle {
            *self.idle_started.get_or_insert(now)
        } else {
            *self.started.get_or_insert(now)
        };
        let clip = &clips[state.index()];
        let duration = f64::from(clip.frame_ms) * clip.frames.len() as f64;
        let started = if state != State::Idle && now - started >= duration {
            state = State::Idle;
            *self.idle_started.get_or_insert(started + duration)
        } else {
            started
        };
        let clip = &clips[state.index()];
        let elapsed = (now - started).max(0.);
        let step = (elapsed / f64::from(clip.frame_ms)).floor() as usize;
        let index = if state == State::Idle && clip.looping {
            step % clip.frames.len()
        } else {
            step.min(clip.frames.len() - 1)
        };
        self.last_pose = (state, index);
        let delay = (f64::from(clip.frame_ms) - elapsed % f64::from(clip.frame_ms))
            .ceil()
            .max(1.) as u32;
        (state, index, Some(delay))
    }
    fn position(&mut self, now: f64) -> (f64, f64, bool) {
        if self.stopped {
            self.motion = None;
        }
        if let Some(motion) = &mut self.motion {
            let progress = ((now - *motion.started.get_or_insert(now)) / MOVE_MS).clamp(0., 1.);
            let x = motion.from_x + (f64::from(self.x) - motion.from_x) * progress;
            let y = motion.from_y + (f64::from(self.y) - motion.from_y) * progress;
            if progress < 1. {
                return (x, y, true);
            }
            self.motion = None;
        }
        (f64::from(self.x), f64::from(self.y), false)
    }
}

/// Projection onto a copy of the public map. Logical coordinates remain intact.
#[derive(Debug)]
pub struct Sample {
    pub frames: Value,
    pub next_delay_ms: Option<u32>,
}

/// One prioritized pose per original action, never a queue of past turns.
pub struct Animator {
    tiles: Clips,
    pixels: Clips,
    actors: BTreeMap<u32, Actor>,
    epoch: Option<u32>,
    step: Option<u32>,
    sequence: u64,
    clock: Option<f64>,
    enabled: bool,
}
impl Animator {
    pub fn new(tiles_manifest: Value, pixels_manifest: Value) -> Result<Self, String> {
        let tiles = parse_manifest(&tiles_manifest, 96)?;
        let pixels = parse_manifest(&pixels_manifest, 32)?;
        for (id, clips) in &tiles {
            if clips.iter().zip(&pixels[id]).any(|(a, b)| {
                a.frame_ms != b.frame_ms
                    || a.looping != b.looping
                    || a.frames.len() != b.frames.len()
            }) {
                return Err(format!("Animation modes have different clip timing: {id}"));
            }
        }
        Ok(Self {
            tiles,
            pixels,
            actors: BTreeMap::new(),
            epoch: None,
            step: None,
            sequence: 0,
            clock: None,
            enabled: true,
        })
    }
    pub fn reset(&mut self) {
        self.actors.clear();
        self.epoch = None;
        self.step = None;
        self.sequence = 0;
        self.clock = None;
    }
    /// A successfully queued input immediately discards unfinished presentation.
    pub fn interrupt(&mut self) {
        for actor in self.actors.values_mut() {
            actor.finish();
        }
    }
    pub fn set_enabled(&mut self, enabled: bool) {
        if self.enabled != enabled {
            self.interrupt();
            self.enabled = enabled;
        }
    }
    pub fn observe(&mut self, frame: &Value) -> Result<(), String> {
        let Some(observation) = parse_observation(frame)? else {
            self.reset();
            return Ok(());
        };
        if self.epoch != Some(observation.epoch) {
            self.actors.clear();
            self.sequence = 0;
            self.step = None;
            self.epoch = Some(observation.epoch);
        }
        if self.step != Some(observation.step) {
            for actor in self.actors.values_mut() {
                actor.finish();
            }
            self.step = Some(observation.step);
        }
        self.actors
            .retain(|id, _| observation.actors.contains_key(id));
        for (id, data) in observation.actors {
            let actor = self
                .actors
                .entry(id)
                .or_insert_with(|| Actor::new(data.clone()));
            if actor.tile != data.tile {
                *actor = Actor::new(data);
                continue;
            }
            let dx = f64::from(data.x) - f64::from(actor.x);
            let dy = f64::from(data.y) - f64::from(actor.y);
            if dx != 0. || dy != 0. {
                actor.motion = if self.enabled && !data.stopped && dx.abs() <= 1. && dy.abs() <= 1.
                {
                    Some(Motion {
                        from_x: f64::from(actor.x),
                        from_y: f64::from(actor.y),
                        started: None,
                    })
                } else {
                    None
                };
            }
            if actor.stopped && !data.stopped {
                actor.finish();
            }
            actor.x = data.x;
            actor.y = data.y;
            actor.facing = data.facing;
            actor.stopped = data.stopped;
        }
        for (sequence, id, state) in observation.events {
            if sequence <= self.sequence {
                continue;
            }
            self.sequence = sequence;
            if self.enabled {
                if let Some(actor) = self.actors.get_mut(&id) {
                    actor.choose(state);
                }
            }
        }
        Ok(())
    }
    pub fn sample(&mut self, now: f64, mode: &str) -> Sample {
        let now = if now.is_finite() {
            self.clock.unwrap_or(now).max(now)
        } else {
            self.clock.unwrap_or(0.)
        };
        self.clock = Some(now);
        let clips = if mode == "pixels" {
            &self.pixels
        } else {
            &self.tiles
        };
        let graphical = matches!(mode, "tiles" | "pixels");
        let mut frames = Vec::with_capacity(self.actors.len());
        let mut next_delay_ms = None;
        for (id, actor) in &mut self.actors {
            let (state, index, delay) = if self.enabled {
                actor.advance(now, &clips[&actor.tile])
            } else {
                (State::Idle, 0, None)
            };
            let (x, y, moving) = if self.enabled {
                actor.position(now)
            } else {
                (f64::from(actor.x), f64::from(actor.y), false)
            };
            if graphical {
                frames.push(
                    json!({"id":id,"x":actor.x,"y":actor.y,"displayX":x,"displayY":y,
                    "facing":actor.facing,"stopped":actor.stopped,"animated":self.enabled,
                    "state":STATES[state.index()],"frame":index}),
                );
                let delay = if moving {
                    Some(delay.unwrap_or(16).min(16))
                } else {
                    delay
                };
                if let Some(delay) = delay {
                    next_delay_ms = Some(next_delay_ms.map_or(delay, |old: u32| old.min(delay)));
                }
            }
        }
        Sample {
            frames: Value::Array(frames),
            next_delay_ms,
        }
    }
}

fn parse_manifest(value: &Value, pixels: u64) -> Result<Clips, String> {
    if value["schema_version"].as_u64() != Some(1)
        || value["tile_pixels"].as_u64() != Some(pixels)
        || value["character_count"].as_u64() != Some(27)
        || value["layout"]["frame_count"].as_u64() != Some(3)
        || value["layout"]["rows"] != json!(STATES)
    {
        return Err("Invalid character animation manifest layout".into());
    }
    let entries = value["entries"]
        .as_array()
        .filter(|entries| entries.len() == 27)
        .ok_or("Invalid character animation manifest entries")?;
    let expected = map_tiles::IDS
        .iter()
        .filter(|id| id.starts_with("actor.") || id.starts_with("monster."))
        .copied()
        .collect::<BTreeSet<_>>();
    let mut clips = BTreeMap::new();
    for entry in entries {
        if !matches!(entry["facing"].as_str(), Some("left" | "right" | "front")) {
            return Err("Invalid native character facing".into());
        }
        let id = entry["id"]
            .as_str()
            .filter(|id| expected.contains(id))
            .ok_or("Invalid character animation ID")?;
        let glyph = entry["glyph"]
            .as_str()
            .filter(|glyph| glyph.len() == 1 && glyph.is_ascii())
            .ok_or("Invalid character animation glyph")?
            .as_bytes()[0];
        if map_tiles::glyph(glyph).map(|tile| map_tiles::IDS[usize::from(tile)]) != Some(id) {
            return Err(format!(
                "Character animation glyph differs from tile ID: {id}"
            ));
        }
        let mut states = Vec::with_capacity(4);
        for (index, state) in STATES.iter().enumerate() {
            let clip = &entry["animations"][*state];
            let frame_ms = clip["frame_ms"]
                .as_u64()
                .filter(|time| (1..=10_000).contains(time))
                .ok_or("Invalid animation frame duration")? as u32;
            let looping = clip["loop"]
                .as_bool()
                .ok_or("Invalid animation loop flag")?;
            if looping != (index <= 1) {
                return Err("Invalid character animation action loop flag".into());
            }
            let frames = clip["frames"]
                .as_array()
                .filter(|frames| frames.len() == 3)
                .ok_or("Invalid animation frame count")?
                .iter()
                .map(|frame| {
                    frame
                        .as_str()
                        .filter(|path| {
                            !path.is_empty()
                                && path.len() <= 256
                                && !path.starts_with('/')
                                && !path.contains('\\')
                                && !path.contains(':')
                                && !path.split('/').any(|part| matches!(part, "" | "." | ".."))
                                && path.ends_with(".png")
                        })
                        .map(str::to_owned)
                        .ok_or_else(|| "Invalid animation frame path".to_owned())
                })
                .collect::<Result<Vec<_>, _>>()?;
            states.push(Clip {
                frames,
                frame_ms,
                looping,
            });
        }
        let states: [Clip; 4] = states
            .try_into()
            .map_err(|_| "Invalid character animation states")?;
        if clips.insert(id.to_owned(), states).is_some() {
            return Err("Duplicate character animation ID".into());
        }
    }
    if clips.len() != expected.len() {
        return Err("Missing character animation ID".into());
    }
    Ok(clips)
}

#[derive(Clone)]
struct ActorData {
    x: u32,
    y: u32,
    tile: String,
    facing: i32,
    stopped: bool,
}
struct Observation {
    epoch: u32,
    step: u32,
    actors: BTreeMap<u32, ActorData>,
    events: Vec<(u64, u32, State)>,
}
fn integer(value: &Value) -> Result<u32, String> {
    value
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| "Invalid public actor integer".into())
}
fn parse_observation(frame: &Value) -> Result<Option<Observation>, String> {
    if ["map_actor_epoch", "map_actors", "map_actor_events"]
        .iter()
        .all(|key| frame.get(key).is_none())
    {
        return Ok(None);
    }
    let epoch = integer(&frame["map_actor_epoch"])?;
    let width = integer(&frame["width"])?;
    let height = integer(&frame["height"])?;
    let length = width
        .checked_mul(height)
        .and_then(|length| usize::try_from(length).ok())
        .filter(|length| *length > 0 && *length <= MAX_CELLS)
        .ok_or("Invalid animation map dimensions")?;
    let cells = frame["map_cells"]
        .as_str()
        .filter(|cells| cells.is_ascii() && cells.len() == length)
        .ok_or("Invalid animation map cells")?
        .as_bytes();
    let tiles = frame["map_tiles"]
        .as_array()
        .filter(|tiles| tiles.len() == length)
        .ok_or("Invalid animation map tiles")?;
    let ids = frame["map_tile_ids"]
        .as_array()
        .filter(|ids| ids.len() == map_tiles::IDS.len())
        .ok_or("Invalid animation map tile IDs")?;
    if ids
        .iter()
        .zip(map_tiles::IDS)
        .any(|(id, expected)| id.as_str() != Some(expected))
    {
        return Err("Animation map tile vocabulary differs".into());
    }
    let raw_actors = frame["map_actors"]
        .as_array()
        .filter(|actors| actors.len() <= MAX_ACTORS)
        .ok_or("Invalid public actor list")?;
    let mut actors = BTreeMap::new();
    let mut seen = BTreeSet::new();
    for actor in raw_actors {
        let id = integer(&actor["id"])?;
        let x = integer(&actor["x"])?;
        let y = integer(&actor["y"])?;
        let glyph = integer(&actor["glyph"])?;
        if !seen.insert(id) || x >= width || y >= height || glyph > 127 {
            return Err("Invalid public actor coordinate, glyph or duplicate ID".into());
        }
        let glyph = glyph as u8;
        let Some(tile) =
            map_tiles::glyph(glyph).filter(|_| glyph == b'@' || glyph.is_ascii_uppercase())
        else {
            continue;
        };
        let index = (y * width + x) as usize;
        if cells[index] == glyph && tiles[index].as_u64() == Some(u64::from(tile)) {
            let facing = actor.get("facing").map_or(Ok(1), |v| {
                v.as_i64()
                    .filter(|v| matches!(v, -1 | 1))
                    .map(|v| v as i32)
                    .ok_or("Invalid public actor facing")
            })?;
            let stopped = actor.get("stopped").map_or(Ok(false), |v| {
                v.as_bool().ok_or("Invalid public actor stop state")
            })?;
            actors.insert(
                id,
                ActorData {
                    x,
                    y,
                    tile: map_tiles::IDS[usize::from(tile)].to_owned(),
                    facing,
                    stopped,
                },
            );
        }
    }
    let raw_events = frame["map_actor_events"]
        .as_array()
        .filter(|events| events.len() <= MAX_EVENTS)
        .ok_or("Invalid public actor event list")?;
    let mut events = Vec::with_capacity(raw_events.len());
    let mut last = 0;
    for event in raw_events {
        let sequence = event["sequence"]
            .as_u64()
            .filter(|sequence| *sequence > last)
            .ok_or("Invalid public actor event sequence")?;
        let id = integer(&event["id"])?;
        let state = State::event(&event["kind"])?;
        last = sequence;
        events.push((sequence, id, state));
    }
    Ok(Some(Observation {
        epoch,
        step: frame.get("map_actor_step").map_or(Ok(0), integer)?,
        actors,
        events,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn animator() -> Animator {
        Animator::new(
            crate::browser_ui::tiles::animation_manifest("tiles"),
            crate::browser_ui::tiles::animation_manifest("pixels"),
        )
        .unwrap()
    }
    fn frame(step: u32, x: u32, stopped: bool, events: Value) -> Value {
        let mut cells = b"   ".to_vec();
        cells[x as usize] = b'@';
        let mut tiles = vec![1, 1, 1];
        tiles[x as usize] = 8;
        json!({"width":3,"height":1,"map_cells":String::from_utf8(cells).unwrap(),"map_tiles":tiles,
            "map_tile_ids":&map_tiles::IDS[..],"map_actor_epoch":1,"map_actor_step":step,
            "map_actors":[{"id":0,"x":x,"y":0,"glyph":64,"facing":1,"stopped":stopped}],"map_actor_events":events})
    }
    fn event(sequence: u32, kind: &str) -> Value {
        json!({"sequence":sequence,"id":0,"kind":kind})
    }
    fn pose(sample: &Sample) -> (&str, u64) {
        (
            sample.frames[0]["state"].as_str().unwrap(),
            sample.frames[0]["frame"].as_u64().unwrap(),
        )
    }
    #[test]
    fn animation_priority_is_attack_hurt_idle_without_a_queue() {
        for events in [
            json!([event(1, "attack"), event(2, "hurt")]),
            json!([event(1, "hurt"), event(2, "attack")]),
        ] {
            let mut a = animator();
            a.observe(&frame(1, 0, false, events)).unwrap();
            assert_eq!(pose(&a.sample(0., "tiles")), ("attack", 0));
            assert_eq!(pose(&a.sample(240., "tiles")), ("attack", 2));
            assert_eq!(pose(&a.sample(360., "tiles")), ("idle", 0));
            a.observe(&frame(1, 0, false, json!([event(3, "hurt")])))
                .unwrap();
            assert_eq!(pose(&a.sample(400., "tiles")), ("idle", 0));
        }
        let mut a = animator();
        a.observe(&frame(1, 0, false, json!([event(1, "hurt")])))
            .unwrap();
        assert_eq!(pose(&a.sample(0., "tiles")), ("hurt", 0));
        a.observe(&frame(1, 0, false, json!([event(2, "attack")])))
            .unwrap();
        assert_eq!(pose(&a.sample(40., "tiles")), ("attack", 0));
    }
    #[test]
    fn animation_new_input_and_original_action_replace_unfinished_poses() {
        let mut a = animator();
        a.observe(&frame(1, 0, false, json!([event(1, "attack")])))
            .unwrap();
        a.sample(0., "tiles");
        a.interrupt();
        assert_eq!(pose(&a.sample(20., "tiles")), ("idle", 0));
        a.observe(&frame(1, 0, false, json!([event(2, "hurt")])))
            .unwrap();
        assert_eq!(pose(&a.sample(30., "tiles")), ("hurt", 0));
        a.observe(&frame(2, 0, false, json!([event(3, "hurt")])))
            .unwrap();
        assert_eq!(pose(&a.sample(40., "tiles")), ("hurt", 0));
        a.observe(&frame(3, 0, false, json!([]))).unwrap();
        assert_eq!(pose(&a.sample(50., "tiles")), ("idle", 0));
    }
    #[test]
    fn animation_move_interpolates_and_interrupt_snaps_to_previous_destination() {
        let mut a = animator();
        a.observe(&frame(1, 0, false, json!([]))).unwrap();
        a.sample(0., "tiles");
        a.observe(&frame(2, 1, false, json!([event(1, "move")])))
            .unwrap();
        assert_eq!(a.sample(10., "tiles").frames[0]["displayX"], 0.);
        let mid = a.sample(70., "tiles");
        assert_eq!(mid.frames[0]["displayX"], 0.5);
        assert_eq!(pose(&mid).0, "idle");
        assert_eq!(mid.next_delay_ms, Some(16));
        a.interrupt();
        assert_eq!(a.sample(80., "tiles").frames[0]["displayX"], 1.);
        a.observe(&frame(3, 2, false, json!([]))).unwrap();
        assert_eq!(a.sample(90., "tiles").frames[0]["displayX"], 1.);
        assert_eq!(a.sample(210., "tiles").frames[0]["displayX"], 2.);
    }
    #[test]
    fn animation_stopped_actor_freezes_and_disabled_mode_has_no_timer() {
        let mut a = animator();
        a.observe(&frame(1, 0, false, json!([]))).unwrap();
        a.sample(0., "tiles");
        let last = a.sample(200., "tiles");
        a.observe(&frame(2, 0, true, json!([event(1, "hurt")])))
            .unwrap();
        let frozen = a.sample(1000., "tiles");
        assert_eq!(pose(&last), pose(&frozen));
        assert_eq!(frozen.next_delay_ms, None);
        assert_eq!(pose(&a.sample(9000., "tiles")), pose(&frozen));
        a.observe(&frame(3, 0, false, json!([]))).unwrap();
        assert_eq!(pose(&a.sample(9010., "tiles")), ("idle", 0));
        a.set_enabled(false);
        a.observe(&frame(4, 1, false, json!([event(2, "attack")])))
            .unwrap();
        let static_pose = a.sample(9020., "tiles");
        assert_eq!(static_pose.frames[0]["displayX"], 1.);
        assert_eq!(static_pose.frames[0]["animated"], false);
        assert_eq!(static_pose.next_delay_ms, None);
        a.set_enabled(true);
        assert_eq!(pose(&a.sample(9030., "tiles")), ("idle", 0));
    }
    #[test]
    fn animation_redraw_mode_change_epoch_and_invalid_frame_are_safe() {
        let mut a = animator();
        let observation = frame(1, 0, false, json!([event(1, "attack")]));
        a.observe(&observation).unwrap();
        a.sample(0., "tiles");
        a.observe(&observation).unwrap();
        assert_eq!(pose(&a.sample(120., "pixels")), ("attack", 1));
        let mut invalid = observation.clone();
        invalid["map_actors"][0]["facing"] = json!(0);
        assert!(a.observe(&invalid).is_err());
        assert_eq!(a.sequence, 1);
        assert_eq!(a.sample(240., "ascii").next_delay_ms, None);
        assert_eq!(pose(&a.sample(360., "tiles")), ("idle", 0));
        let mut new = frame(1, 0, false, json!([]));
        new["map_actor_epoch"] = json!(2);
        a.observe(&new).unwrap();
        assert_eq!(pose(&a.sample(400., "tiles")), ("idle", 0));
    }
}
