//! Presentation clocks for public actors. No game state, input, RNG or save access.
use crate::map_tiles;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

const MAX_ACTORS: usize = 1024;
const MAX_EVENTS: usize = 8192;
const MAX_CELLS: usize = 65_536;
const MAX_PENDING: usize = 8;
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
struct Pulse {
    state: State,
    /// A newly observed event receives its browser time on the first sample.
    available: Option<f64>,
}

#[derive(Debug)]
struct Actor {
    x: u32,
    y: u32,
    tile: String,
    idle_started: Option<f64>,
    active: Option<Pulse>,
    pending: VecDeque<Pulse>,
}
impl Actor {
    fn new(x: u32, y: u32, tile: String) -> Self {
        Self {
            x,
            y,
            tile,
            idle_started: None,
            active: None,
            pending: VecDeque::new(),
        }
    }
    fn enqueue(&mut self, state: State) {
        // Continued walking refreshes its finite pulse. Combat events retain order.
        if state == State::Move
            && let Some(last) = self.pending.back_mut()
            && last.state == State::Move
        {
            last.available = None;
            return;
        }
        if state == State::Move
            && self.pending.is_empty()
            && self.active.is_some_and(|pulse| pulse.state == State::Move)
        {
            self.active = Some(Pulse {
                state,
                available: None,
            });
            return;
        }
        if self.pending.len() == MAX_PENDING {
            self.pending.pop_front();
        }
        self.pending.push_back(Pulse {
            state,
            available: None,
        });
    }
    fn advance(&mut self, now: f64, clips: &[Clip; 4]) -> (State, usize, u32) {
        for pulse in &mut self.pending {
            pulse.available.get_or_insert(now);
        }
        if self.active.is_none() {
            self.active = self.pending.pop_front();
        }
        if let Some(pulse) = &mut self.active {
            pulse.available.get_or_insert(now);
        }
        // Pending action clips can age while ASCII has no animation timer. Each
        // newly observed action is bounded below by its first sampling time.
        while let Some(pulse) = self.active {
            let clip = &clips[pulse.state.index()];
            let end = pulse.available.unwrap_or(now)
                + f64::from(clip.frame_ms) * clip.frames.len() as f64;
            if now < end {
                break;
            }
            self.active = self.pending.pop_front().map(|mut next| {
                next.available = Some(end.max(next.available.unwrap_or(now)));
                next
            });
            if self.active.is_none() {
                self.idle_started = Some(end);
            }
        }
        let (state, started) = if let Some(pulse) = self.active {
            (pulse.state, pulse.available.unwrap_or(now))
        } else {
            (State::Idle, *self.idle_started.get_or_insert(now))
        };
        let clip = &clips[state.index()];
        let elapsed = (now - started).max(0.);
        let frame_ms = f64::from(clip.frame_ms);
        let step = (elapsed / frame_ms).floor() as usize;
        let index = if state == State::Idle && clip.looping {
            step % clip.frames.len()
        } else {
            step.min(clip.frames.len() - 1)
        };
        let delay = (frame_ms - elapsed % frame_ms).ceil().max(1.) as u32;
        (state, index, delay)
    }
}

/// Animation projection to attach to a copy of the latest public map frame.
#[derive(Debug)]
pub struct Sample {
    pub frames: Value,
    pub next_delay_ms: Option<u32>,
}

/// Owns validated artwork clips, visible actor lifetimes and finite action pulses.
pub struct Animator {
    tiles: Clips,
    pixels: Clips,
    actors: BTreeMap<u32, Actor>,
    epoch: Option<u32>,
    sequence: u64,
    clock: Option<f64>,
}
impl Animator {
    pub fn new(tiles_manifest: Value, pixels_manifest: Value) -> Result<Self, String> {
        let tiles = parse_manifest(&tiles_manifest, 96)?;
        let pixels = parse_manifest(&pixels_manifest, 32)?;
        for (id, clips) in &tiles {
            let other = &pixels[id];
            if clips.iter().zip(other).any(|(left, right)| {
                left.frame_ms != right.frame_ms
                    || left.looping != right.looping
                    || left.frames.len() != right.frames.len()
            }) {
                return Err(format!("Animation modes have different clip timing: {id}"));
            }
        }
        Ok(Self {
            tiles,
            pixels,
            actors: BTreeMap::new(),
            epoch: None,
            sequence: 0,
            clock: None,
        })
    }

    /// Session/restore boundary. Animation never enters the game save container.
    pub fn reset(&mut self) {
        self.actors.clear();
        self.epoch = None;
        self.sequence = 0;
        self.clock = None;
    }

    /// Consumes only published observations. Invalid frames leave state unchanged.
    pub fn observe(&mut self, frame: &Value) -> Result<(), String> {
        let observations = parse_observation(frame)?;
        let Some(observations) = observations else {
            self.actors.clear();
            self.epoch = None;
            self.sequence = 0;
            return Ok(());
        };
        if self.epoch != Some(observations.epoch) {
            self.actors.clear();
            self.sequence = 0;
            self.epoch = Some(observations.epoch);
        }
        self.actors
            .retain(|id, _| observations.actors.contains_key(id));
        for (id, (x, y, tile)) in observations.actors {
            let actor = self
                .actors
                .entry(id)
                .or_insert_with(|| Actor::new(x, y, tile.clone()));
            if actor.tile != tile {
                *actor = Actor::new(x, y, tile);
            } else {
                actor.x = x;
                actor.y = y;
            }
        }
        for (sequence, id, state) in observations.events {
            if sequence <= self.sequence {
                continue;
            }
            // An event for an actor that is no longer public is retired too.
            self.sequence = sequence;
            if let Some(actor) = self.actors.get_mut(&id) {
                actor.enqueue(state);
            }
        }
        Ok(())
    }

    /// Advances a monotonic display clock only. ASCII suppresses timer and images.
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
        let mut next_delay_ms: Option<u32> = None;
        for (id, actor) in &mut self.actors {
            let (state, index, delay) = actor.advance(now, &clips[&actor.tile]);
            if graphical {
                frames.push(json!({"id":id,"x":actor.x,"y":actor.y,
                    "state":STATES[state.index()],"frame":index}));
                next_delay_ms = Some(next_delay_ms.map_or(delay, |old| old.min(delay)));
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

struct Observation {
    epoch: u32,
    actors: BTreeMap<u32, (u32, u32, String)>,
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
            actors.insert(id, (x, y, map_tiles::IDS[usize::from(tile)].to_owned()));
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
    fn frame(events: Value) -> Value {
        json!({"width":2,"height":1,"map_cells":"@A","map_tiles":[8,23],
            "map_tile_ids":&map_tiles::IDS[..],"map_actor_epoch":1,
            "map_actors":[{"id":0,"x":0,"y":0,"glyph":64},
                {"id":1,"x":1,"y":0,"glyph":65}],"map_actor_events":events})
    }
    fn event(sequence: u64, kind: &str) -> Value {
        json!({"sequence":sequence,"id":0,"kind":kind})
    }
    fn state(sample: &Sample) -> (&str, u64) {
        (
            sample.frames[0]["state"].as_str().unwrap(),
            sample.frames[0]["frame"].as_u64().unwrap(),
        )
    }
    #[test]
    fn three_frames_loop_and_finite_actions_keep_queue_order() {
        let mut player = animator();
        player
            .observe(&frame(json!([event(1, "attack"), event(2, "hurt")])))
            .unwrap();
        assert_eq!(state(&player.sample(10., "tiles")), ("attack", 0));
        assert_eq!(state(&player.sample(130., "tiles")), ("attack", 1));
        assert_eq!(state(&player.sample(250., "tiles")), ("attack", 2));
        assert_eq!(state(&player.sample(370., "tiles")), ("hurt", 0));
        assert_eq!(state(&player.sample(610., "tiles")), ("hurt", 2));
        assert_eq!(state(&player.sample(730., "tiles")), ("idle", 0));
        assert_eq!(state(&player.sample(1130., "tiles")), ("idle", 2));
        assert_eq!(state(&player.sample(1330., "tiles")), ("idle", 0));
    }
    #[test]
    fn duplicate_observation_and_mode_change_do_not_restart_actions() {
        let mut player = animator();
        let observation = frame(json!([event(1, "move")]));
        player.observe(&observation).unwrap();
        assert_eq!(state(&player.sample(0., "tiles")), ("move", 0));
        player.observe(&observation).unwrap();
        assert_eq!(state(&player.sample(120., "pixels")), ("move", 1));
        let ascii = player.sample(240., "ascii");
        assert_eq!(ascii.frames, json!([]));
        assert_eq!(ascii.next_delay_ms, None);
        assert_eq!(state(&player.sample(360., "tiles")), ("idle", 0));
        assert_eq!(state(&player.sample(100., "tiles")), ("idle", 0));
    }
    #[test]
    fn continued_moves_refresh_finite_pulse_and_new_actions_start_now() {
        let mut player = animator();
        player.observe(&frame(json!([event(1, "move")]))).unwrap();
        player.sample(0., "tiles");
        player.observe(&frame(json!([event(2, "move")]))).unwrap();
        assert_eq!(state(&player.sample(240., "tiles")), ("move", 0));
        assert_eq!(state(&player.sample(600., "tiles")), ("idle", 0));
        player.observe(&frame(json!([event(3, "attack")]))).unwrap();
        assert_eq!(state(&player.sample(10_000., "tiles")), ("attack", 0));
    }
    #[test]
    fn consecutive_moves_before_first_sample_finish_after_one_cycle() {
        let mut player = animator();
        let events = (1..=10)
            .map(|sequence| event(sequence, "move"))
            .collect::<Vec<_>>();
        player.observe(&frame(json!(events))).unwrap();
        assert_eq!(player.actors[&0].pending.len(), 1);
        assert_eq!(state(&player.sample(100., "tiles")), ("move", 0));
        assert_eq!(state(&player.sample(220., "tiles")), ("move", 1));
        assert_eq!(state(&player.sample(460., "tiles")), ("idle", 0));
    }
    #[test]
    fn ascii_ages_existing_queue_and_empty_actor_set_has_no_timer() {
        let mut player = animator();
        player
            .observe(&frame(json!([event(1, "attack"), event(2, "hurt")])))
            .unwrap();
        player.sample(0., "ascii");
        assert_eq!(state(&player.sample(10_000., "pixels")), ("idle", 1));
        let mut gone = frame(json!([]));
        gone["map_actors"] = json!([]);
        player.observe(&gone).unwrap();
        let empty = player.sample(10_001., "tiles");
        assert_eq!(empty.frames, json!([]));
        assert_eq!(empty.next_delay_ms, None);
    }
    #[test]
    fn retirement_epoch_and_reset_drop_action_state() {
        let mut player = animator();
        let mut observation = frame(json!([event(1, "attack")]));
        player.observe(&observation).unwrap();
        player.sample(0., "tiles");
        observation["map_actors"] = json!([]);
        player.observe(&observation).unwrap();
        player.observe(&frame(json!([event(1, "attack")]))).unwrap();
        assert_eq!(state(&player.sample(120., "tiles")), ("idle", 0));
        observation = frame(json!([event(1, "hurt")]));
        observation["map_actor_epoch"] = json!(2);
        player.observe(&observation).unwrap();
        assert_eq!(state(&player.sample(240., "tiles")), ("hurt", 0));
        player.reset();
        player.observe(&frame(json!([]))).unwrap();
        assert_eq!(state(&player.sample(0., "tiles")), ("idle", 0));
    }
    #[test]
    fn observed_glyph_and_tile_must_both_match_without_mutating_frame() {
        let mut player = animator();
        let mut observation = frame(json!([event(1, "attack")]));
        observation["map_tiles"][0] = json!(1);
        let unchanged = observation.clone();
        player.observe(&observation).unwrap();
        let result = player.sample(0., "tiles");
        assert_eq!(observation, unchanged);
        assert_eq!(result.frames.as_array().unwrap().len(), 1);
        assert_eq!(result.frames[0]["id"], 1);
        observation["map_cells"] = json!("@ ");
        observation["map_tiles"] = json!([8, 0]);
        player.observe(&observation).unwrap();
        assert_eq!(state(&player.sample(120., "tiles")), ("idle", 0));
    }
    #[test]
    fn overflow_discards_oldest_pending_and_keeps_current_pulse() {
        let mut player = animator();
        player.observe(&frame(json!([event(1, "attack")]))).unwrap();
        player.sample(0., "tiles");
        let events = (2..=11)
            .map(|sequence| event(sequence, if sequence == 2 { "attack" } else { "hurt" }))
            .collect::<Vec<_>>();
        player.observe(&frame(json!(events))).unwrap();
        assert_eq!(player.actors[&0].pending.len(), MAX_PENDING);
        assert_eq!(state(&player.sample(120., "tiles")), ("attack", 1));
        assert_eq!(state(&player.sample(360., "tiles")), ("hurt", 0));
    }
    #[test]
    fn invalid_clips_and_observations_are_rejected_atomically() {
        let mut tiles = crate::browser_ui::tiles::animation_manifest("tiles");
        let pixels = crate::browser_ui::tiles::animation_manifest("pixels");
        tiles["entries"][0]["animations"]["idle"]["frame_ms"] = json!(0);
        assert!(Animator::new(tiles, pixels.clone()).is_err());
        let mut tiles = crate::browser_ui::tiles::animation_manifest("tiles");
        tiles["entries"][0]["animations"]["hurt"]["frames"][0] = json!("../bad.png");
        assert!(Animator::new(tiles, pixels).is_err());
        let mut player = animator();
        player.observe(&frame(json!([event(1, "attack")]))).unwrap();
        player.sample(0., "tiles");
        let mut invalid = frame(json!([event(2, "hurt")]));
        invalid["map_actors"][0]["x"] = json!(2);
        assert!(player.observe(&invalid).is_err());
        assert_eq!(player.sequence, 1);
        assert_eq!(state(&player.sample(120., "tiles")), ("attack", 1));
    }
}
