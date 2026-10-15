//! Cached map and terrain observations; never queries hidden C world state.
use crate::{game_window, map_tiles};
use serde_json::{Value, json};

const COLUMNS: u32 = 80;
const ROWS: u32 = 24;
const MAX_ACTOR_EVENTS: usize = 4096;

/// Owned observations from the C boundary, applied by the display plugin.
/// They contain public visual identity only, never a C pointer or hidden stats.
#[derive(Clone, Copy)]
pub enum ActorObservation {
    Reset(u32),
    Step(u32),
    Begin,
    Actor {
        id: u32,
        x: i32,
        y: i32,
        glyph: i32,
        facing: i32,
        stopped: bool,
    },
    Event {
        id: u32,
        kind: u32,
    },
    Replay(bool),
}

fn can_drop_on(frame: &Value) -> bool {
    !frame["map_player_underlay"]["tile"]
        .as_u64()
        .is_some_and(|tile| tile > 2)
}

#[derive(bevy::prelude::Component, Default)]
pub struct ObservedMap {
    last_frame: Option<Value>,
    map_frame: Option<Value>,
    effects: Vec<(u32, u32, u8)>,
    terrain: Vec<u8>,
    actors: Vec<Value>,
    actor_events: Vec<(u64, u32, &'static str)>,
    actor_epoch: u32,
    actor_step: u32,
    actor_sequence: u64,
    accepting_actors: bool,
    replaying_actors: bool,
}
impl ObservedMap {
    pub fn can_drop(&self) -> bool {
        // Only a publicly displayed door/stair/trap rules placement out.
        // An unknown surface still goes through the original C validation.
        self.last_frame.as_ref().is_none_or(can_drop_on)
    }
}

impl ObservedMap {
    pub fn frame(&self) -> Option<&Value> {
        self.last_frame.as_ref()
    }
    pub fn update_ui(&mut self, ui: Value) {
        if let Some(frame) = &mut self.last_frame {
            frame["ui"] = ui;
        }
    }
    pub fn on_stairs(&self) -> bool {
        self.last_frame
            .as_ref()
            .is_some_and(|frame| frame["map_player_underlay"]["tile"] == 6)
    }
    pub fn terrain(&mut self, glyphs: Vec<u8>) {
        self.terrain = glyphs;
    }
    pub fn observe_actor(&mut self, observation: ActorObservation) {
        match observation {
            ActorObservation::Reset(epoch) => {
                self.actors.clear();
                self.actor_events.clear();
                self.actor_epoch = epoch;
                self.actor_step = 0;
                self.actor_sequence = 0;
                self.accepting_actors = false;
                // A retained window must not carry actors from an old level
                // or imported graph while waiting for the next public map.
                if let Some(frame) = &mut self.map_frame {
                    frame["map_actors"] = json!([]);
                    frame["map_actor_events"] = json!([]);
                    frame["map_actor_epoch"] = json!(epoch);
                }
            }
            ActorObservation::Step(step) => self.actor_step = step,
            ActorObservation::Begin => {
                self.actors.clear();
                self.accepting_actors = true;
            }
            ActorObservation::Actor {
                id,
                x,
                y,
                glyph,
                facing,
                stopped,
            } => {
                let (Ok(x), Ok(y), Ok(glyph)) =
                    (u32::try_from(x), u32::try_from(y), u8::try_from(glyph))
                else {
                    return;
                };
                if !self.accepting_actors
                    || !matches!(facing, -1 | 1)
                    || x >= COLUMNS
                    || y == 0
                    || y >= ROWS - 1
                    || (id == 0 && glyph != b'@')
                    || (id != 0 && !glyph.is_ascii_uppercase())
                    || self.actors.len() >= (COLUMNS * ROWS) as usize
                    || self
                        .actors
                        .iter()
                        .any(|actor| actor["id"] == id || (actor["x"] == x && actor["y"] == y))
                {
                    return;
                }
                self.actors.push(
                    json!({"id":id,"x":x,"y":y,"glyph":glyph,"facing":facing,"stopped":stopped}),
                );
            }
            ActorObservation::Event { id, kind } => {
                let kind = match kind {
                    rogue_contract::RG_ACTOR_MOVE => "move",
                    rogue_contract::RG_ACTOR_ATTACK => "attack",
                    rogue_contract::RG_ACTOR_HURT => "hurt",
                    _ => return,
                };
                if self.replaying_actors || self.actor_events.len() >= MAX_ACTOR_EVENTS {
                    return;
                }
                if let Some(sequence) = self.actor_sequence.checked_add(1) {
                    self.actor_sequence = sequence;
                    self.actor_events.push((sequence, id, kind));
                }
            }
            ActorObservation::Replay(replaying) => {
                if self.replaying_actors != replaying {
                    self.actor_events.clear();
                }
                self.replaying_actors = replaying;
            }
        }
    }
    pub fn effect(&mut self, x: i32, y: i32, glyph: i32, active: i32) {
        if active == 0 {
            self.effects.clear();
        } else if let (Ok(x), Ok(y), Ok(glyph)) =
            (u32::try_from(x), u32::try_from(y), u8::try_from(glyph))
            && x < COLUMNS
            && y < ROWS
            && map_tiles::bolt(glyph).is_some()
        {
            if let Some(effect) = self
                .effects
                .iter_mut()
                .find(|effect| effect.0 == x && effect.1 == y)
            {
                *effect = (x, y, glyph);
            } else if self.effects.len() < 6 {
                self.effects.push((x, y, glyph));
            }
        }
    }
    /// Reject malformed observations without replacing the last public frame.
    /// The original game's logical screen is always 80 columns by 24 rows.
    pub fn present(&mut self, mut frame: Value, ui: &Value, version: &str) -> Value {
        let rows = ROWS;
        let columns = COLUMNS;
        let valid = frame["height"].as_u64() == Some(u64::from(rows))
            && frame["width"].as_u64() == Some(u64::from(columns))
            && frame["cells"]
                .as_str()
                .is_some_and(|cells| cells.is_ascii() && cells.len() == (rows * columns) as usize)
            && frame["player"]["x"]
                .as_u64()
                .is_some_and(|x| x < u64::from(columns))
            && frame["player"]["y"]
                .as_u64()
                .is_some_and(|y| y < u64::from(rows))
            && ui.is_object();
        if !valid {
            return Value::Null;
        }
        if ui["mode"] != "game"
            && let Some(cached) = self.map_frame.as_ref()
        {
            for key in [
                "map_cells",
                "map_tiles",
                "map_tile_ids",
                "map_unknown_glyphs",
                "map_underlays",
                "map_player_underlay",
                "map_player_surface",
                "map_actors",
                "map_actor_epoch",
            ] {
                frame[key] = cached[key].clone();
            }
        } else {
            let mut cells = frame["cells"].as_str().unwrap_or("").as_bytes().to_vec();
            if ui["mode"] != "game" {
                cells.fill(b' ');
            }
            for row in [0, rows.saturating_sub(1)] {
                let start = row as usize * columns as usize;
                cells[start..start + columns as usize].fill(b' ');
            }
            let (tiles, unknown) = map_tiles::map(&cells, columns, rows, &self.effects);
            let underlays: Vec<Value> = self
                .terrain
                .iter()
                .enumerate()
                .filter_map(|(index, &glyph)| {
                    let tile = map_tiles::glyph(glyph).filter(|tile| *tile <= 7)?;
                    let foreground = *tiles.get(index)?;
                    let x = index as u32 % columns;
                    let y = index as u32 / columns;
                    (y > 0 && y < rows.saturating_sub(1) && foreground > 7)
                        .then(|| json!({"x":x,"y":y,"tile":tile}))
                })
                .collect();
            frame["map_player_underlay"] = underlays
                .iter()
                .find(|underlay| {
                    underlay["x"] == frame["player"]["x"]
                        && underlay["y"] == frame["player"]["y"]
                        && cells.get(
                            (underlay["y"].as_u64().unwrap() as u32 * columns
                                + underlay["x"].as_u64().unwrap() as u32)
                                as usize,
                        ) == Some(&b'@')
                })
                .cloned()
                .unwrap_or(Value::Null);
            // floor_at() is already an observed surface beneath the displayed
            // player. Keep item glyphs too, without treating them as terrain.
            frame["map_player_surface"] = frame["player"]["x"]
                .as_u64()
                .zip(frame["player"]["y"].as_u64())
                .and_then(|(x, y)| {
                    let index = (y * u64::from(columns) + x) as usize;
                    (cells.get(index) == Some(&b'@'))
                        .then(|| self.terrain.get(index).copied())
                        .flatten()
                        .and_then(map_tiles::glyph)
                        .map(|tile| json!({"x":x,"y":y,"tile":tile}))
                })
                .unwrap_or(Value::Null);
            frame["map_underlays"] = json!(underlays);
            frame["map_tiles"] = json!(tiles);
            frame["map_tile_ids"] = json!(&map_tiles::IDS[..]);
            frame["map_unknown_glyphs"] = json!(unknown);
            frame["map_cells"] = Value::String(String::from_utf8(cells).unwrap_or_default());
            frame["map_actor_epoch"] = json!(self.actor_epoch);
            frame["map_actors"] = json!(
                self.actors
                    .iter()
                    .filter(|actor| {
                        let index = actor["y"].as_u64().unwrap() as usize * columns as usize
                            + actor["x"].as_u64().unwrap() as usize;
                        frame["map_cells"]
                            .as_str()
                            .unwrap()
                            .as_bytes()
                            .get(index)
                            .copied()
                            == actor["glyph"]
                                .as_u64()
                                .and_then(|glyph| u8::try_from(glyph).ok())
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            );
            if ui["mode"] == "game" {
                self.map_frame = Some(frame.clone());
            }
        }
        // Events belong to a single published frame. A cached redraw can keep
        // that immutable frame; the browser uses sequence IDs to consume it
        // once. Removed/hidden actors cannot acquire animation by an event.
        frame["map_actor_events"] = json!(
            self.actor_events
                .drain(..)
                .filter_map(|(sequence, id, kind)| {
                    frame["map_actors"]
                        .as_array()
                        .is_some_and(|actors| actors.iter().any(|actor| actor["id"] == id))
                        .then(|| json!({"sequence":sequence,"id":id,"kind":kind}))
                })
                .collect::<Vec<_>>()
        );
        self.accepting_actors = false;
        frame["map_actor_step"] = json!(self.actor_step);
        frame["ui"] = ui.clone();
        frame["ui"]["can_drop"] = json!(can_drop_on(&frame));
        frame["ui"]["map_controls"] =
            game_window::map_controls(&frame["ui"], frame["map_player_underlay"]["tile"] == 6);
        frame["engine"] = json!({"name":"Bevy","version":version,"renderer":"browser-canvas"});
        self.last_frame = Some(frame.clone());
        frame
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> Value {
        json!({"width":COLUMNS,"height":ROWS,"cells":" ".repeat((COLUMNS * ROWS) as usize),
            "player":{"x":2,"y":2}})
    }

    fn actors_frame(player_x: u32, monster_x: u32) -> Value {
        let mut cells = vec![b' '; (COLUMNS * ROWS) as usize];
        cells[2 * COLUMNS as usize + player_x as usize] = b'@';
        cells[2 * COLUMNS as usize + monster_x as usize] = b'Z';
        json!({"width":COLUMNS,"height":ROWS,"cells":String::from_utf8(cells).unwrap(),
            "player":{"x":player_x,"y":2}})
    }

    fn observe_positions(map: &mut ObservedMap, player_x: i32, monster_x: i32) {
        map.observe_actor(ActorObservation::Begin);
        map.observe_actor(ActorObservation::Actor {
            id: 0,
            x: player_x,
            y: 2,
            glyph: i32::from(b'@'),
            facing: 1,
            stopped: false,
        });
        map.observe_actor(ActorObservation::Actor {
            id: 7,
            x: monster_x,
            y: 2,
            glyph: i32::from(b'Z'),
            facing: 1,
            stopped: false,
        });
    }

    #[test]
    fn source_actions_are_ordered_once_and_follow_the_next_public_position() {
        let mut map = ObservedMap::default();
        let ui = json!({"mode":"game"});
        map.observe_actor(ActorObservation::Reset(3));
        observe_positions(&mut map, 2, 5);
        map.present(actors_frame(2, 5), &ui, "test");
        for (id, kind) in [
            (0, rogue_contract::RG_ACTOR_MOVE),
            (7, rogue_contract::RG_ACTOR_ATTACK),
            (0, rogue_contract::RG_ACTOR_HURT),
        ] {
            map.observe_actor(ActorObservation::Event { id, kind });
        }
        // Before this frame the source event has no new coordinates. The
        // presentation joins the ID with the newly published cell only.
        observe_positions(&mut map, 3, 4);
        let published = map.present(actors_frame(3, 4), &ui, "test");
        assert_eq!(
            published["map_actors"],
            json!([
            {"id":0,"x":3,"y":2,"glyph":64,"facing":1,"stopped":false},{"id":7,"x":4,"y":2,"glyph":90,"facing":1,"stopped":false}])
        );
        assert_eq!(
            published["map_actor_events"],
            json!([
            {"sequence":1,"id":0,"kind":"move"},
            {"sequence":2,"id":7,"kind":"attack"},
            {"sequence":3,"id":0,"kind":"hurt"}])
        );
        assert_eq!(published["map_actor_epoch"], 3);
        assert_eq!(map.frame(), Some(&published));
        assert_eq!(
            map.present(actors_frame(3, 4), &ui, "test")["map_actor_events"],
            json!([])
        );
    }

    #[test]
    fn windows_keep_public_actors_and_new_epochs_retire_them() {
        let mut map = ObservedMap::default();
        map.observe_actor(ActorObservation::Reset(3));
        observe_positions(&mut map, 2, 5);
        let public = map.present(actors_frame(2, 5), &json!({"mode":"game"}), "test");
        let window = map.present(frame(), &json!({"mode":"window"}), "test");
        assert_eq!(window["map_actors"], public["map_actors"]);
        assert_eq!(window["map_cells"], public["map_cells"]);
        map.observe_actor(ActorObservation::Event {
            id: 7,
            kind: rogue_contract::RG_ACTOR_ATTACK,
        });
        map.observe_actor(ActorObservation::Reset(4));
        let new_epoch = map.present(frame(), &json!({"mode":"window"}), "test");
        assert_eq!(new_epoch["map_actor_epoch"], 4);
        assert_eq!(new_epoch["map_actors"], json!([]));
        assert_eq!(new_epoch["map_actor_events"], json!([]));
    }

    #[test]
    fn undisplayed_characters_and_restore_replay_cannot_publish_actions() {
        let mut map = ObservedMap::default();
        let ui = json!({"mode":"game"});
        observe_positions(&mut map, 2, 5);
        map.observe_actor(ActorObservation::Actor {
            id: 8,
            x: 6,
            y: 2,
            glyph: i32::from(b'!'),
            facing: 1,
            stopped: false,
        });
        map.observe_actor(ActorObservation::Actor {
            id: 9,
            x: 7,
            y: 2,
            glyph: i32::from(b'E'),
            facing: 1,
            stopped: false,
        });
        for id in [8, 9, 10] {
            map.observe_actor(ActorObservation::Event {
                id,
                kind: rogue_contract::RG_ACTOR_HURT,
            });
        }
        map.observe_actor(ActorObservation::Replay(true));
        map.observe_actor(ActorObservation::Event {
            id: 0,
            kind: rogue_contract::RG_ACTOR_MOVE,
        });
        let replay = map.present(actors_frame(2, 5), &ui, "test");
        assert_eq!(replay["map_actors"].as_array().unwrap().len(), 2);
        assert_eq!(replay["map_actor_events"], json!([]));
        map.observe_actor(ActorObservation::Replay(false));
        map.observe_actor(ActorObservation::Event {
            id: 0,
            kind: rogue_contract::RG_ACTOR_ATTACK,
        });
        // Repeated physical input waits must not erase a pending real action.
        map.observe_actor(ActorObservation::Replay(false));
        let real = map.present(actors_frame(2, 5), &ui, "test");
        assert_eq!(
            real["map_actor_events"],
            json!([{"sequence":4,"id":0,"kind":"attack"}])
        );
    }

    #[test]
    fn malformed_observations_are_rejected_without_replacing_the_public_map() {
        let mut map = ObservedMap::default();
        let ui = json!({"mode":"game","input":{"kind":"command"}});
        let original = map.present(frame(), &ui, "test");
        assert!(!original.is_null());
        for (field, value) in [
            ("height", json!(0)),
            ("height", json!(23)),
            ("width", json!(0)),
            ("width", json!(81)),
            ("width", json!(u64::MAX)),
            ("cells", json!(" ".repeat(1919))),
            ("cells", json!(" ".repeat(1921))),
            ("cells", json!("あ".repeat(640))),
            ("player", json!({"x":80,"y":2})),
            ("player", json!({"x":2,"y":24})),
        ] {
            let mut invalid = frame();
            invalid[field] = value;
            assert!(map.present(invalid, &ui, "test").is_null(), "{field}");
            assert_eq!(map.frame(), Some(&original));
        }
    }
}
