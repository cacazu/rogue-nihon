//! Cached map and terrain observations; never queries hidden C world state.
use crate::{game_window, map_tiles};
use serde_json::{Value, json};

const COLUMNS: u32 = 80;
const ROWS: u32 = 24;

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
            if ui["mode"] == "game" {
                self.map_frame = Some(frame.clone());
            }
        }
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
