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
    Projectile(crate::projectile::Observation),
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
    projectiles: crate::projectile::ObservedFlights,
    terrain: Vec<u8>,
    visibility: Option<Vec<u8>>,
    memory: Vec<u8>,
    checked: Vec<u16>,
    memory_level: Option<u32>,
    pending_memory: Option<(u32, Vec<u8>, Vec<u16>)>,
    restore_ready: bool,
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
    pub fn visibility(&mut self, visible: Vec<u8>) {
        self.visibility = (visible.len() == (COLUMNS*ROWS) as usize && visible.iter().all(|value| *value <= 1)).then_some(visible);
    }
    pub fn memory_snapshot(&self) -> Option<Value> {
        if self.restore_ready && let Some((level,cells,checked))=&self.pending_memory {
            return Some(json!({"level":level,"cells":String::from_utf8_lossy(cells),"checked":checked}));
        }
        self.memory_level.zip((self.memory.len() == (COLUMNS*ROWS) as usize).then_some(&self.memory))
            .map(|(level,cells)| json!({"level":level,"cells":String::from_utf8_lossy(cells),"checked":self.checked}))
    }
    pub fn restore_memory(&mut self, memory: &Value) {
        self.pending_memory = memory["level"].as_u64().zip(memory["cells"].as_str())
            .filter(|(level,cells)| rogue_contract::valid_map_memory(*level,cells))
            .and_then(|(level,cells)| {
                let checked=if memory.get("checked").is_some() {
                    serde_json::from_value::<Vec<u16>>(memory["checked"].clone()).ok()?
                } else {vec![rogue_contract::MAP_UNCHECKED;(COLUMNS*ROWS) as usize]};
                rogue_contract::valid_map_checked(&checked,COLUMNS as usize,ROWS as usize)
                    .then(||(level as u32,cells.as_bytes().to_vec(),checked))
            });
    }
    /// C has successfully loaded its checkpoint. Startup's provisional screen
    /// cannot consume the pending memory before this explicit success signal.
    pub fn restore_ready(&mut self) { self.restore_ready = true; }
    pub fn terrain(&mut self, glyphs: Vec<u8>) {
        self.terrain = glyphs;
    }
    pub fn observe_projectile(&mut self, observation: crate::projectile::Observation) {
        if !self.replaying_actors { self.projectiles.observe(observation, self.map_frame.as_ref()); }
    }
    pub fn observe_actor(&mut self, observation: ActorObservation) {
        match observation {
            ActorObservation::Projectile(observation) => self.observe_projectile(observation),
            ActorObservation::Reset(epoch) => {
                self.projectiles.reset();
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
                    self.projectiles.reset();
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
                "map_current_cells",
                "map_checked",
                "map_visible",
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
            self.projectiles.mask(&mut cells);
            // C owns the public player pose independently of the curses
            // foreground. Keep its transient pickup/effect erasures in `cells`
            // for original-screen comparisons, and compose the player only in
            // the derived game map. Enemy visibility still requires its glyph.
            if ui["mode"] == "game"
                && self.actors.iter().any(|actor| {
                    actor["id"] == 0
                        && actor["x"] == frame["player"]["x"]
                        && actor["y"] == frame["player"]["y"]
                })
            {
                let x = frame["player"]["x"].as_u64().unwrap();
                let y = frame["player"]["y"].as_u64().unwrap();
                cells[(y * u64::from(columns) + x) as usize] = b'@';
            }
            // This accepted C game surface is kept separately from both the
            // memory-composed map and later menu/window text.
            frame["map_current_cells"]=json!(String::from_utf8_lossy(&cells));
            let raw_tiles = map_tiles::map(&cells, columns, rows, &self.effects).0;
            let visible: Vec<bool> = self.visibility.take().unwrap_or_else(|| vec![0;cells.len()])
                .iter().zip(&cells).map(|(visible,glyph)| *visible==1 && *glyph!=b' ').collect();
            if ui["mode"] == "game" {
                let level = frame["stats"]["level"].as_u64().and_then(|level| u32::try_from(level).ok());
                if self.memory.len() != cells.len() || self.memory_level != level {
                    self.memory = vec![b' ';cells.len()];
                    self.checked = vec![rogue_contract::MAP_UNCHECKED;cells.len()];
                    self.memory_level = level;
                }
                if self.restore_ready && let Some((saved_level,memory,checked)) = self.pending_memory.take() {
                    if Some(saved_level) == level { self.memory = memory; self.checked = checked; }
                }
                for index in columns as usize..(cells.len()-columns as usize) {
                    let glyph = cells[index];
                    let tile = raw_tiles[index];
                    if rogue_contract::map_memory_glyph(glyph) && glyph != b' ' && !(10..=13).contains(&tile) {
                        self.memory[index] = glyph;
                    } else if tile == 8 || tile >= 23 {
                        // Dynamic characters never become static memory. Their
                        // surface must itself have crossed the public boundary.
                        if let Some(glyph) = self.terrain.get(index).copied()
                            .filter(|glyph| *glyph != b' ' && rogue_contract::map_memory_glyph(*glyph)) {
                            self.memory[index] = glyph;
                        }
                        let x=index%columns as usize; let y=index/columns as usize;
                        let current = self.actors.iter().any(|actor| actor["x"]==x && actor["y"]==y
                            && actor["glyph"].as_u64()==Some(u64::from(glyph)));
                        if tile>=23 && !current { cells[index]=self.memory[index]; }
                    }
                    if cells[index] == b' ' { cells[index] = self.memory[index]; }
                }
            }
            // Record every accepted public observation, including the frame
            // which makes exploration stop for an enemy. Blind visits and a
            // restore's provisional startup screen do not confirm a frontier.
            if ui["mode"]=="game" && ui["player_state"]["blind"]!=true
                && !(self.replaying_actors && !self.restore_ready)
                && self.actors.iter().any(|actor| actor["id"]==0
                    && actor["x"]==frame["player"]["x"] && actor["y"]==frame["player"]["y"]) {
                let x=frame["player"]["x"].as_u64().unwrap() as i32;
                let y=frame["player"]["y"].as_u64().unwrap() as i32;
                if let Some(mask)=rogue_contract::map_unknown_mask(&cells,columns as usize,rows as usize,x,y) {
                    self.checked[y as usize*columns as usize+x as usize]=u16::from(mask);
                }
            }
            frame["map_checked"]=json!(self.checked);
            let (tiles, unknown) = map_tiles::map(&cells, columns, rows, &self.effects);
            frame["map_visible"] = json!(visible);
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
        frame["map_projectile_events"] = self.projectiles.take_events();
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
    fn visibility_memory_masks_only_current_public_cells_and_survives_windows() {
        let mut map=ObservedMap::default(); let ui=json!({"mode":"game"});
        let index=2*COLUMNS as usize+3;
        let mut raw=frame();raw["stats"]=json!({"level":1});
        let mut cells=raw["cells"].as_str().unwrap().as_bytes().to_vec();cells[index]=b'.';
        raw["cells"]=json!(String::from_utf8(cells).unwrap());
        map.visibility(vec![1;(COLUMNS*ROWS) as usize]);
        let seen=map.present(raw,&ui,"test");
        assert_eq!(seen["map_visible"].as_array().unwrap().len(),(COLUMNS*ROWS) as usize);
        assert_eq!(seen["map_visible"][index],true);assert_eq!(seen["map_visible"][index+1],false);
        let window=map.present(frame(),&json!({"mode":"inventory"}),"test");
        assert_eq!(window["map_visible"],seen["map_visible"]);
        map.visibility(vec![0;(COLUMNS*ROWS) as usize]);
        let mut dark=frame();dark["stats"]=json!({"level":1});
        let remembered=map.present(dark,&ui,"test");
        assert_eq!(remembered["map_cells"].as_str().unwrap().as_bytes()[index],b'.');
        assert_eq!(remembered["map_visible"][index],false);
    }

    #[test]
    fn visibility_memory_restore_waits_for_c_success_and_keeps_same_floor_teleports() {
        let mut cells=vec![b' ';(COLUMNS*ROWS) as usize];let index=2*COLUMNS as usize+3;cells[index]=b'.';
        let memory=json!({"level":1,"cells":String::from_utf8(cells).unwrap()});
        let mut map=ObservedMap::default();map.restore_memory(&memory);
        let mut raw=frame();raw["stats"]=json!({"level":1});
        let before=map.present(raw.clone(),&json!({"mode":"game"}),"test");
        assert_eq!(before["map_cells"].as_str().unwrap().as_bytes()[index],b' ');
        map.restore_ready();
        map.present(raw.clone(),&json!({"mode":"inventory"}),"test");
        let mut expected_memory=memory.clone();expected_memory["checked"]=json!(vec![rogue_contract::MAP_UNCHECKED;80*24]);
        assert_eq!(map.memory_snapshot(),Some(expected_memory),"An immediate checkpoint retains pending restored memory");
        let restored=map.present(raw.clone(),&json!({"mode":"game"}),"test");
        assert_eq!(restored["map_cells"].as_str().unwrap().as_bytes()[index],b'.');
        map.observe_actor(ActorObservation::Reset(9));
        let teleported=map.present(raw.clone(),&json!({"mode":"game"}),"test");
        assert_eq!(teleported["map_cells"],restored["map_cells"]);
        raw["stats"]["level"]=json!(2);
        let next=map.present(raw.clone(),&json!({"mode":"game"}),"test");
        assert_eq!(next["map_cells"].as_str().unwrap().as_bytes()[index],b' ');
        let mut other=ObservedMap::default();other.restore_memory(&memory);other.restore_ready();
        assert_eq!(other.present(raw,&json!({"mode":"game"}),"test")["map_tiles"][index],0);
    }

    #[test]
    fn visibility_memory_keeps_public_terrain_and_items_without_ghost_actors() {
        let mut map = ObservedMap::default();
        let ui = json!({"mode":"game"});
        let index = |x:usize| 2 * COLUMNS as usize + x;
        let mut raw = actors_frame(2, 5);
        raw["stats"] = json!({"level":1});
        let mut cells = raw["cells"].as_str().unwrap().as_bytes().to_vec();
        cells[index(3)] = b'.';
        cells[index(4)] = b'!';
        raw["cells"] = json!(String::from_utf8(cells).unwrap());
        let mut terrain = vec![255; (COLUMNS * ROWS) as usize];
        terrain[index(2)] = b'.';
        terrain[index(5)] = b'.';
        map.terrain(terrain);
        observe_positions(&mut map, 2, 5);
        let first = map.present(raw.clone(), &ui, "test");
        assert_eq!(first["cells"], raw["cells"]);
        let mut next = frame(); next["stats"] = json!({"level":1});
        let remembered = map.present(next.clone(), &ui, "test");
        let cells = remembered["map_cells"].as_str().unwrap().as_bytes();
        assert_eq!(cells[index(3)], b'.', "Previously observed dark-room floor remains public memory");
        assert_eq!(cells[index(4)], b'!', "Only the last public item appearance is remembered");
        assert_eq!(cells[index(5)], b'.', "A monster leaves only its public terrain, never a ghost");
        assert_eq!(cells[index(6)], b' ', "Unobserved darkness stays unknown");
        assert_eq!(remembered["cells"], next["cells"], "C comparison screen stays unchanged");
        next["stats"]["level"] = json!(2);
        let fresh = map.present(next, &ui, "test");
        assert_eq!(fresh["map_cells"].as_str().unwrap().as_bytes()[index(3)], b' ');
    }

    #[test]
    fn player_pose_survives_transient_curses_erasure_without_revealing_enemies() {
        let mut map = ObservedMap::default();
        let ui = json!({"mode":"game"});
        for glyph in [b'.', b')', b'/'] {
            observe_positions(&mut map, 3, 5);
            let mut raw = actors_frame(3, 5);
            let mut cells = raw["cells"].as_str().unwrap().as_bytes().to_vec();
            cells[2 * COLUMNS as usize + 3] = glyph;
            cells[2 * COLUMNS as usize + 5] = b'.';
            raw["cells"] = json!(String::from_utf8(cells).unwrap());
            map.terrain(vec![b'.'; (COLUMNS * ROWS) as usize]);
            map.observe_actor(ActorObservation::Event { id: 0, kind: rogue_contract::RG_ACTOR_MOVE });
            let projected = map.present(raw.clone(), &ui, "test");
            assert_eq!(projected["cells"], raw["cells"]);
            assert_eq!(projected["map_cells"].as_str().unwrap().as_bytes()[2 * COLUMNS as usize + 3], b'@');
            assert_eq!(projected["map_tiles"][2 * COLUMNS as usize + 3], 8);
            assert_eq!(projected["map_player_underlay"]["tile"], 1);
            assert_eq!(projected["map_actors"].as_array().unwrap().len(), 1);
            assert_eq!(projected["map_actors"][0]["id"], 0);
            assert_eq!(projected["map_actor_events"][0]["kind"], "move");
        }
        // Only a matching, current C observation can supply the player.
        observe_positions(&mut map, 3, 5);
        let missing = map.present(frame(), &ui, "test");
        assert_eq!(missing["map_actors"], json!([]));
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
    fn checked_scene(x:u32, level:u32) -> Value {
        let mut raw=frame();raw["stats"]=json!({"level":level});raw["player"]=json!({"x":x,"y":2});
        let mut cells=vec![b' ';80*24];for px in 2..=7 {cells[2*80+px]=b'.';}
        cells[2*80+x as usize]=b'@';cells[2*80+7]=b'Z';
        raw["cells"]=json!(String::from_utf8(cells).unwrap());raw
    }
    fn observe_checked(map:&mut ObservedMap,x:u32,level:u32,blind:bool)->Value {
        observe_positions(map,x as i32,7);
        let mut terrain=vec![255;80*24];terrain[2*80+x as usize]=b'.';map.terrain(terrain);
        map.present(checked_scene(x,level),&json!({"mode":"game","player_state":{"blind":blind}}),"test")
    }
    #[test]
    fn checked_observations_cover_manual_movement_and_enemy_stop_before_planning() {
        let mut map=ObservedMap::default();let index=2*80+3;
        // No AutoWalk invocation is involved; this enemy-bearing frame is
        // recorded before any browser can decide to stop exploration.
        let first=observe_checked(&mut map,3,1,false);
        let mask=rogue_contract::map_unknown_mask(first["map_cells"].as_str().unwrap().as_bytes(),80,24,3,2).unwrap();
        assert_eq!(first["map_checked"][index],mask);
        observe_checked(&mut map,4,1,false);
        let mut raw=checked_scene(4,1);let mut cells=raw["cells"].as_str().unwrap().as_bytes().to_vec();cells[3*80+3]=b'.';raw["cells"]=json!(String::from_utf8(cells).unwrap());
        observe_positions(&mut map,4,7);let changed=map.present(raw,&json!({"mode":"game"}),"test");
        assert_eq!(changed["map_checked"][index],mask,"New knowledge does not pretend the old position was visited again");
        assert_ne!(rogue_contract::map_unknown_mask(changed["map_cells"].as_str().unwrap().as_bytes(),80,24,3,2),Some(mask));
        let revisited=observe_checked(&mut map,3,1,false);
        assert_ne!(revisited["map_checked"][index],mask,"A real revisit confirms the new public pattern");
        let cached=map.present(frame(),&json!({"mode":"inventory"}),"test");assert_eq!(cached["map_checked"],revisited["map_checked"]);
    }
    #[test]
    fn checked_observations_preserve_same_level_teleports_but_clear_levels_and_new_games() {
        let mut map=ObservedMap::default();let first=observe_checked(&mut map,3,1,false);
        map.observe_actor(ActorObservation::Reset(9));let teleported=observe_checked(&mut map,6,1,false);
        assert_eq!(teleported["map_checked"][2*80+3],first["map_checked"][2*80+3]);
        let next=observe_checked(&mut map,6,2,false);assert_eq!(next["map_checked"][2*80+3],rogue_contract::MAP_UNCHECKED);
        let fresh=observe_checked(&mut ObservedMap::default(),6,1,false);assert_eq!(fresh["map_checked"][2*80+3],rogue_contract::MAP_UNCHECKED);
    }
    #[test]
    fn checked_observations_skip_blind_visits_and_provisional_restore_then_save_together() {
        let mut original=ObservedMap::default();observe_checked(&mut original,3,1,false);
        let blind=observe_checked(&mut original,5,1,true);assert_eq!(blind["map_checked"][2*80+5],rogue_contract::MAP_UNCHECKED);
        let memory=original.memory_snapshot().unwrap();
        let mut restored=ObservedMap::default();restored.restore_memory(&memory);restored.observe_actor(ActorObservation::Replay(true));
        let provisional=observe_checked(&mut restored,6,1,false);assert_eq!(provisional["map_checked"][2*80+6],rogue_contract::MAP_UNCHECKED);
        restored.restore_ready();let ready=observe_checked(&mut restored,5,1,false);
        assert_eq!(ready["map_checked"][2*80+3],memory["checked"][2*80+3]);
        assert_ne!(ready["map_checked"][2*80+5],rogue_contract::MAP_UNCHECKED,"Restore-success journal observations confirm actual positions");
        assert_eq!(restored.memory_snapshot().unwrap()["checked"],ready["map_checked"]);
        assert_eq!(ready["map_checked"][2*80+6],rogue_contract::MAP_UNCHECKED,"Provisional marks never survive restore");
    }

    #[test]
    fn current_public_map_survives_memory_merge_and_cached_menu_text() {
        let mut map=ObservedMap::default();let index=2*80+3;
        let mut raw=checked_scene(4,1);observe_positions(&mut map,4,7);
        let first=map.present(raw.clone(),&json!({"mode":"game"}),"test");
        assert_eq!(first["map_current_cells"].as_str().map(|cells|cells.as_bytes()[index]),Some(b'.'));
        let mut cells=raw["cells"].as_str().unwrap().as_bytes().to_vec();cells[index]=b' ';raw["cells"]=json!(String::from_utf8(cells).unwrap());
        observe_positions(&mut map,4,7);let dark=map.present(raw,&json!({"mode":"game"}),"test");
        assert_eq!(dark["map_cells"].as_str().unwrap().as_bytes()[index],b'.');
        assert_eq!(dark["map_current_cells"].as_str().map(|cells|cells.as_bytes()[index]),Some(b' '));
        let mut overlay=frame();overlay["cells"]=json!("X".repeat(1920));
        let menu=map.present(overlay,&json!({"mode":"inventory"}),"test");
        assert_eq!(menu["map_current_cells"],dark["map_current_cells"],"Menu text cannot relight or erase the accepted public game surface");
        assert_eq!(menu["map_cells"],dark["map_cells"]);
    }

}
