//! Semantic tile validation, visibility-aware composition and device rectangles.
use super::*;
pub fn manifest(mode: &str) -> Value {
    let mut value: Value = serde_json::from_str(if mode == "pixels" {
        include_str!("../../../../../web/assets/pixels-v2/manifest.json")
    } else {
        include_str!("../../../../../web/assets/tiles/manifest.json")
    })
    .expect("Tile manifest");
    value["browser_mode"] = json!(if mode == "pixels" { "pixels" } else { "tiles" });
    value["pixel_art"] = json!(mode == "pixels");
    value
}
/// Artwork clips only. Presentation time never advances the original game.
pub fn animation_manifest(mode: &str) -> Value {
    animation_manifest_ref(mode).clone()
}
fn animation_manifest_ref(mode: &str) -> &'static Value {
    static PIXELS: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    static TILES: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let (cache, source) = if mode == "pixels" {
        (&PIXELS, include_str!("../../../../../web/assets/pixels-v2/animations-v1/manifest.json"))
    } else {
        (&TILES, include_str!("../../../../../web/assets/tiles/animations-v1/manifest.json"))
    };
    cache.get_or_init(|| serde_json::from_str(source).expect("Character animation manifest"))
}
pub fn validate(frame: &Value, manifest: &Value) -> Result<(), &'static str> {
    let entries = array(&manifest["entries"]);
    if array(&frame["map_tiles"]).len()
        != n(&frame["width"]) as usize * n(&frame["height"]) as usize
        || array(&frame["map_tile_ids"]).len() != entries.len()
        || array(&frame["map_tile_ids"])
            .iter()
            .zip(entries)
            .any(|(id, e)| id != &e["id"])
        || array(&frame["map_tiles"])
            .iter()
            .any(|id| id.as_u64().is_none_or(|id| id as usize >= entries.len()))
        || !array(&frame["map_unknown_glyphs"]).is_empty()
    {
        Err("Unmapped graphical map cell")
    } else {
        if !frame["map_animation"].is_null() && !frame["map_animation"].is_array() {
            return Err("Invalid character animation frame");
        }
        if !array(&frame["map_animation"]).is_empty() {
            let animations = animation_manifest_ref(s(&manifest["browser_mode"]));
            let width = frame["width"].as_u64().ok_or("Invalid character animation frame")?;
            let height = frame["height"].as_u64().ok_or("Invalid character animation frame")?;
            let mut positions = std::collections::BTreeSet::new();
            for projection in array(&frame["map_animation"]) {
                let invalid = "Invalid character animation frame";
                let id = projection["id"].as_u64().filter(|id| *id <= u32::MAX as u64).ok_or(invalid)?;
                let x = projection["x"].as_u64().filter(|x| *x < width).ok_or(invalid)?;
                let y = projection["y"].as_u64().filter(|y| *y > 0 && *y < height.saturating_sub(1)).ok_or(invalid)?;
                let index = y.checked_mul(width).and_then(|row| row.checked_add(x))
                    .and_then(|index| usize::try_from(index).ok()).ok_or(invalid)?;
                if !positions.insert((x, y)) {
                    return Err(invalid);
                }
                let actor = array(&frame["map_actors"]).iter().find(|actor| {
                    actor["id"].as_u64() == Some(id)
                        && actor["x"].as_u64() == Some(x) && actor["y"].as_u64() == Some(y)
                }).ok_or(invalid)?;
                let tile = frame["map_tiles"][index].as_u64().ok_or(invalid)? as usize;
                let visual = entries.get(tile).ok_or(invalid)?;
                let animation = array(&animations["entries"]).iter()
                    .find(|entry| entry["id"] == visual["id"]).ok_or(invalid)?;
                let glyph = s(&animation["glyph"]).as_bytes().first().copied().ok_or(invalid)?;
                if actor["glyph"].as_u64() != Some(u64::from(glyph)) {
                    return Err(invalid);
                }
                let state = s(&projection["state"]);
                if !matches!(state, "idle" | "move" | "attack" | "hurt") {
                    return Err(invalid);
                }
                let frame = projection["frame"].as_u64().and_then(|frame| usize::try_from(frame).ok()).ok_or(invalid)?;
                if animation["animations"][state]["frames"].get(frame)
                    .and_then(Value::as_str).is_none_or(str::is_empty)
                {
                    return Err(invalid);
                }
            }
        }
        Ok(())
    }
}
pub fn assets(mode: &str) -> Value {
    let m = manifest(mode);
    let animation = animation_manifest(mode);
    let pixels = m["tile_pixels"].as_u64().expect("Tile pixels");
    let mut files = array(&m["entries"])
        .iter()
        .map(|e| (s(&e["image"]).to_owned(), json!({"width":pixels,"height":pixels})))
        .collect::<BTreeMap<_, _>>();
    for entry in array(&animation["entries"]) {
        files.insert(format!("animations-v1/{}", s(&entry["sheet"])),
            json!({"width":pixels*3,"height":pixels*4}));
    }
    let expected = files.values().collect::<Vec<_>>();
    let names = files.keys().collect::<Vec<_>>();
    json!({"kind":"assets","set":mode,"base":if mode=="pixels" {"/web/assets/pixels-v2/"} else {"/web/assets/tiles/"},
        "pixels":m["tile_pixels"],"files":names,"expectedDimensions":expected,"manifest":m,"animations":animation})
}
pub fn plan(frame: &Value, camera: &Value, rect: Rect, ratio: f64, mode: &str) -> Vec<Value> {
    let m = manifest(mode);
    let entries = array(&m["entries"]);
    let animations = animation_manifest_ref(mode);
    let size = n(&camera["size"]);
    let left = n(&camera["left"]);
    let top = n(&camera["top"]);
    if size <= 0. || !size.is_finite() {
        return Vec::new();
    }
    let width = n(&frame["width"]) as usize;
    let height = n(&frame["height"]) as usize;
    let start_x = (left / size).floor().max(0.) as usize;
    let end_x = width.min(((left + n(&camera["width"])) / size).ceil().max(0.) as usize);
    let start_y = (1. + (top / size).floor()).max(1.) as usize;
    let end_y = height
        .saturating_sub(1)
        .min((1. + ((top + n(&camera["height"])) / size).ceil()).max(0.) as usize);
    let underlays = array(&frame["map_underlays"])
        .iter()
        .filter_map(|u| {
            Some((
                (u["y"].as_u64()? as usize) * width + u["x"].as_u64()? as usize,
                u["tile"].as_u64()? as usize,
            ))
        })
        .collect::<BTreeMap<_, _>>();
    let projections = array(&frame["map_animation"]).iter().filter_map(|projection| {
        Some(((projection["x"].as_u64()?, projection["y"].as_u64()?), projection))
    }).collect::<BTreeMap<_, _>>();
    let mut commands = Vec::new();
    for y in start_y..end_y {
        for x in start_x..end_x {
            let Some(id) = frame["map_tiles"][y * width + x]
                .as_u64()
                .map(|id| id as usize)
                .filter(|id| *id < entries.len())
            else {
                continue;
            };
            let actor_base = underlays
                .get(&(y * width + x))
                .copied()
                .filter(|tile| id > 7 && *tile <= 7);
            let terrain = actor_base.unwrap_or(id);
            let base = match s(&entries[terrain]["id"]) {
                "terrain.unexplored" => 0,
                "terrain.passage" => 2,
                _ => 1,
            };
            let px = ((x as f64 * size - left) * ratio).round();
            let py = (((y - 1) as f64 * size - top) * ratio).round();
            let w = (((x + 1) as f64 * size - left) * ratio).round() - px;
            let h = ((y as f64 * size - top) * ratio).round() - py;
            let mut layers = vec![base];
            if actor_base.is_some() && terrain != base {
                layers.push(terrain);
            }
            if id != base {
                layers.push(id);
            }
            for tile in layers {
                let image = if tile == id && let Some(projection) = projections.get(&(x as u64, y as u64)) {
                    let state = s(&projection["state"]);
                    let frame = projection["frame"].as_u64().and_then(|frame| usize::try_from(frame).ok());
                    let filename = array(&animations["entries"]).iter()
                        .find(|entry| entry["id"] == entries[tile]["id"])
                        .and_then(|entry| frame.and_then(|frame| entry["animations"][state]["frames"].get(frame)))
                        .and_then(Value::as_str).filter(|name| !name.is_empty());
                    // The controller supplies typed projections and validate() checks test
                    // requests. An invalid projection must fail rasterization, not silently
                    // substitute an unrelated static pose.
                    json!(filename.map(|name| format!("animations-v1/{name}"))
                        .unwrap_or_else(|| format!("invalid-animation/{}", s(&entries[tile]["id"]))))
                } else {
                    entries[tile]["image"].clone()
                };
                commands.push(json!({"op":"image","set":if mode=="pixels" {"pixels"} else {"tiles"},
            "image":image,"rotation":entries[tile]["rotation"].as_f64().unwrap_or(0.),"pixelArt":m["tile_pixels"]==32,
            "rect":Rect::new(rect.x+px/ratio,rect.y+py/ratio,w/ratio,h/ratio)}));
            }
        }
    }
    commands
}

#[cfg(test)]
mod animation_tests {
    use super::*;

    fn sample_frame(mode: &str) -> Value {
        let ids = array(&manifest(mode)["entries"]).iter()
            .map(|entry| entry["id"].clone()).collect::<Vec<_>>();
        json!({"width":3,"height":3,"map_tiles":[0,0,0,1,8,6,0,0,0],
            "map_tile_ids":ids,"map_unknown_glyphs":[],
            "map_underlays":[{"x":1,"y":1,"tile":3}],
            "map_actors":[{"id":0,"x":1,"y":1,"glyph":64}],
            "map_animation":[{"id":0,"x":1,"y":1,"state":"hurt","frame":2}]})
    }

    #[test]
    fn character_animation_assets_have_bounded_sheet_dimensions() {
        for (mode, pixels) in [("tiles", 96), ("pixels", 32)] {
            let plan = assets(mode);
            let files = array(&plan["files"]);
            let dimensions = array(&plan["expectedDimensions"]);
            assert_eq!(files.len(), 73);
            assert_eq!(dimensions.len(), files.len());
            assert_eq!(array(&plan["animations"]["entries"]).len(), 27);
            let mut sheets = 0;
            for (filename, dimension) in files.iter().zip(dimensions) {
                if s(filename).starts_with("animations-v1/") {
                    sheets += 1;
                    assert_eq!(dimension, &json!({"width":pixels*3,"height":pixels*4}));
                } else {
                    assert_eq!(dimension, &json!({"width":pixels,"height":pixels}));
                }
            }
            assert_eq!(sheets, 27);
        }
    }

    #[test]
    fn character_animation_replaces_only_the_actor_above_its_underlay() {
        for mode in ["tiles", "pixels"] {
            let mut frame = sample_frame(mode);
            assert!(validate(&frame, &manifest(mode)).is_ok());
            let camera = json!({"size":32,"left":0,"top":0,"width":96,"height":32});
            let animated = plan(&frame, &camera, Rect::new(0.,0.,96.,32.), 1., mode);
            frame["map_animation"] = json!([]);
            let stationary = plan(&frame, &camera, Rect::new(0.,0.,96.,32.), 1., mode);
            assert_eq!(animated.len(), stationary.len());
            let changed = animated.iter().zip(&stationary).filter(|(a,b)| a != b)
                .collect::<Vec<_>>();
            assert_eq!(changed.len(), 1);
            assert_eq!(changed[0].0["image"], "animations-v1/actor.player/hurt.3.png");
            assert_eq!(changed[0].1["image"], "actor.player.png");
            assert_eq!(changed[0].0["rect"], changed[0].1["rect"]);
            assert!(animated.iter().any(|command| command["image"] == "terrain.door.png"));
        }
    }

    #[test]
    fn character_animation_rejects_stale_actors_invalid_clips_and_hidden_cells() {
        for (field, value) in [("id",json!(1)),("state",json!("unknown")),("frame",json!(3)),("x",json!(0)),("y",json!(0))] {
            let mut frame = sample_frame("tiles");
            frame["map_animation"][0][field] = value;
            assert_eq!(validate(&frame, &manifest("tiles")), Err("Invalid character animation frame"));
        }
        let mut frame = sample_frame("tiles");
        frame["map_actors"][0]["glyph"] = json!(65);
        assert!(validate(&frame, &manifest("tiles")).is_err());
        let mut frame = sample_frame("tiles");
        frame["map_animation"][0]["frame"] = json!(100);
        let commands = plan(&frame, &json!({"size":32,"left":0,"top":0,"width":96,"height":32}), Rect::new(0.,0.,96.,32.), 1., "tiles");
        assert!(commands.iter().any(|command| command["image"] == "invalid-animation/actor.player"));
        assert!(!commands.iter().any(|command| command["image"] == "actor.player.png"));
    }
}
