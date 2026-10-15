//! Semantic tile validation, visibility-aware composition and device rectangles.
use super::*;
pub fn manifest(mode: &str) -> Value {
    manifest_ref(mode).clone()
}
pub fn manifest_ref(mode: &str) -> &'static Value {
    static PIXELS: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    static TILES: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let (cache, source) = if mode == "pixels" {
        (
            &PIXELS,
            include_str!("../../../../../web/assets/pixels-v2/manifest.json"),
        )
    } else {
        (
            &TILES,
            include_str!("../../../../../web/assets/tiles/manifest.json"),
        )
    };
    cache.get_or_init(|| {
        let mut value: Value = serde_json::from_str(source).expect("Tile manifest");
        value["browser_mode"] = json!(if mode == "pixels" { "pixels" } else { "tiles" });
        value["pixel_art"] = json!(mode == "pixels");
        value
    })
}
/// Artwork clips only. Presentation time never advances the original game.
pub fn animation_manifest(mode: &str) -> Value {
    animation_manifest_ref(mode).clone()
}
fn animation_manifest_ref(mode: &str) -> &'static Value {
    static PIXELS: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    static TILES: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let (cache, source) = if mode == "pixels" {
        (
            &PIXELS,
            include_str!("../../../../../web/assets/pixels-v2/animations-v1/manifest.json"),
        )
    } else {
        (
            &TILES,
            include_str!("../../../../../web/assets/tiles/animations-v1/manifest.json"),
        )
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
            let width = frame["width"]
                .as_u64()
                .ok_or("Invalid character animation frame")?;
            let height = frame["height"]
                .as_u64()
                .ok_or("Invalid character animation frame")?;
            let mut positions = std::collections::BTreeSet::new();
            for projection in array(&frame["map_animation"]) {
                let invalid = "Invalid character animation frame";
                let id = projection["id"]
                    .as_u64()
                    .filter(|id| *id <= u32::MAX as u64)
                    .ok_or(invalid)?;
                let x = projection["x"]
                    .as_u64()
                    .filter(|x| *x < width)
                    .ok_or(invalid)?;
                let y = projection["y"]
                    .as_u64()
                    .filter(|y| *y > 0 && *y < height.saturating_sub(1))
                    .ok_or(invalid)?;
                let index = y
                    .checked_mul(width)
                    .and_then(|row| row.checked_add(x))
                    .and_then(|index| usize::try_from(index).ok())
                    .ok_or(invalid)?;
                if !positions.insert((x, y)) {
                    return Err(invalid);
                }
                let actor = array(&frame["map_actors"])
                    .iter()
                    .find(|actor| {
                        actor["id"].as_u64() == Some(id)
                            && actor["x"].as_u64() == Some(x)
                            && actor["y"].as_u64() == Some(y)
                    })
                    .ok_or(invalid)?;
                let tile = frame["map_tiles"][index].as_u64().ok_or(invalid)? as usize;
                let visual = entries.get(tile).ok_or(invalid)?;
                let animation = array(&animations["entries"])
                    .iter()
                    .find(|entry| entry["id"] == visual["id"])
                    .ok_or(invalid)?;
                let glyph = s(&animation["glyph"])
                    .as_bytes()
                    .first()
                    .copied()
                    .ok_or(invalid)?;
                if actor["glyph"].as_u64() != Some(u64::from(glyph)) {
                    return Err(invalid);
                }
                for (field, bound) in [("displayX", width), ("displayY", height)] {
                    if let Some(value) = projection.get(field) {
                        let value = value
                            .as_f64()
                            .filter(|v| v.is_finite() && *v >= 0. && *v < bound as f64)
                            .ok_or(invalid)?;
                        let _ = value;
                    }
                }
                if projection
                    .get("facing")
                    .is_some_and(|v| !matches!(v.as_i64(), Some(-1 | 1)))
                    || ["stopped", "animated"]
                        .iter()
                        .any(|field| projection.get(*field).is_some_and(|v| !v.is_boolean()))
                {
                    return Err(invalid);
                }
                let state = s(&projection["state"]);
                if !matches!(state, "idle" | "move" | "attack" | "hurt") {
                    return Err(invalid);
                }
                let frame = projection["frame"]
                    .as_u64()
                    .and_then(|frame| usize::try_from(frame).ok())
                    .ok_or(invalid)?;
                if animation["animations"][state]["frames"]
                    .get(frame)
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
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
        .map(|e| {
            (
                s(&e["image"]).to_owned(),
                json!({"width":pixels,"height":pixels}),
            )
        })
        .collect::<BTreeMap<_, _>>();
    for entry in array(&animation["entries"]) {
        files.insert(
            format!("animations-v1/{}", s(&entry["sheet"])),
            json!({"width":pixels*3,"height":pixels*4}),
        );
    }
    let expected = files.values().collect::<Vec<_>>();
    let names = files.keys().collect::<Vec<_>>();
    json!({"kind":"assets","set":mode,"base":if mode=="pixels" {"/web/assets/pixels-v2/"} else {"/web/assets/tiles/"},
        "pixels":m["tile_pixels"],"files":names,"expectedDimensions":expected,"manifest":m,"animations":animation})
}
pub fn plan(frame: &Value, camera: &Value, rect: Rect, ratio: f64, mode: &str) -> Vec<Value> {
    let m = manifest_ref(mode);
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
    let projections = array(&frame["map_animation"])
        .iter()
        .filter_map(|projection| {
            Some((
                (projection["x"].as_u64()?, projection["y"].as_u64()?),
                projection,
            ))
        })
        .collect::<BTreeMap<_, _>>();
    let mut commands = Vec::new();
    let mut actors = Vec::new();
    // Terrain uses the viewport. Public sprites use their displayed position,
    // even when skipped paints put the latest destination outside the viewport.
    let mut cells = (start_y..end_y)
        .flat_map(|y| (start_x..end_x).map(move |x| (y, x)))
        .collect::<std::collections::BTreeSet<_>>();
    cells.extend(projections.keys().filter_map(|&(x, y)| {
        (x < width as u64 && y > 0 && y < height.saturating_sub(1) as u64)
            .then_some((y as usize, x as usize))
    }));
    for (y, x) in cells {
        let Some(id) = frame["map_tiles"][y * width + x]
            .as_u64()
            .map(|v| v as usize)
            .filter(|v| *v < entries.len())
        else {
            continue;
        };
        let is_actor = s(&entries[id]["id"]).starts_with("actor.")
            || s(&entries[id]["id"]).starts_with("monster.");
        let projection = projections.get(&(x as u64, y as u64));
        let terrain = underlays
            .get(&(y * width + x))
            .copied()
            .filter(|tile| id > 7 && *tile <= 7);
        let ground = terrain.unwrap_or(id);
        let base = match s(&entries[ground]["id"]) {
            "terrain.unexplored" => 0,
            "terrain.passage" => 2,
            _ => 1,
        };
        let px = ((x as f64 * size - left) * ratio).round();
        let py = (((y - 1) as f64 * size - top) * ratio).round();
        let w = (((x + 1) as f64 * size - left) * ratio).round() - px;
        let h = ((y as f64 * size - top) * ratio).round() - py;
        let mut layers = vec![base];
        if terrain.is_some() && ground != base {
            layers.push(ground);
        }
        if id != base {
            layers.push(id);
        }
        for tile in layers {
            let actor = tile == id && is_actor;
            if !actor && (x < start_x || x >= end_x || y < start_y || y >= end_y) {
                continue;
            }
            let mut image = entries[tile]["image"].clone();
            let mut draw_x = px / ratio;
            let mut draw_y = py / ratio;
            let mut flip = false;
            if actor && let Some(projection) = projection {
                let entry = array(&animations["entries"])
                    .iter()
                    .find(|e| e["id"] == entries[tile]["id"]);
                if projection["animated"] != false {
                    let index = projection["frame"]
                        .as_u64()
                        .and_then(|v| usize::try_from(v).ok());
                    let filename = entry
                        .and_then(|e| {
                            index.and_then(|i| {
                                e["animations"][s(&projection["state"])]["frames"].get(i)
                            })
                        })
                        .and_then(Value::as_str)
                        .filter(|v| !v.is_empty());
                    image = json!(
                        filename
                            .map(|name| format!("animations-v1/{name}"))
                            .unwrap_or_else(|| format!(
                                "invalid-animation/{}",
                                s(&entries[tile]["id"])
                            ))
                    );
                }
                draw_x += (projection["displayX"].as_f64().unwrap_or(x as f64) - x as f64) * size;
                draw_y += (projection["displayY"].as_f64().unwrap_or(y as f64) - y as f64) * size;
                let facing = projection["facing"].as_i64().unwrap_or(1);
                let native = entry.map(|e| s(&e["facing"])).unwrap_or("right");
                flip = if native == "left" {
                    facing > 0
                } else {
                    facing < 0
                };
            }
            if actor
                && (draw_x + w / ratio <= 0.
                    || draw_y + h / ratio <= 0.
                    || draw_x >= n(&camera["width"])
                    || draw_y >= n(&camera["height"]))
            {
                continue;
            }
            let command = json!({"op":"image","set":if mode=="pixels" {"pixels"} else {"tiles"},"image":image,
                    "rotation":entries[tile]["rotation"].as_f64().unwrap_or(0.),"pixelArt":m["tile_pixels"]==32,"flipX":flip,
                    "rect":Rect::new(rect.x+draw_x,rect.y+draw_y,w/ratio,h/ratio)});
            if actor {
                actors.push(command);
            } else {
                commands.push(command);
            }
        }
    }
    // Terrain never paints over a sprite crossing a neighbouring cell.
    commands.extend(actors);
    commands
}

#[cfg(test)]
mod animation_tests {
    use super::*;

    fn sample_frame(mode: &str) -> Value {
        let ids = array(&manifest(mode)["entries"])
            .iter()
            .map(|entry| entry["id"].clone())
            .collect::<Vec<_>>();
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
            assert!(
                array(&plan["animations"]["entries"])
                    .iter()
                    .all(|entry| matches!(s(&entry["facing"]), "left" | "right" | "front"))
            );
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
    fn character_animation_moves_only_the_sprite_and_matches_native_facing() {
        for mode in ["tiles", "pixels"] {
            let mut frame = sample_frame(mode);
            frame["map_animation"][0]["displayX"] = json!(0.5);
            frame["map_animation"][0]["facing"] = json!(-1);
            assert!(validate(&frame, &manifest(mode)).is_ok());
            let commands = plan(
                &frame,
                &json!({"size":32,"left":0,"top":0,"width":96,"height":32}),
                Rect::new(0., 0., 96., 32.),
                1.,
                mode,
            );
            let sprite = commands
                .iter()
                .find(|c| c["image"] == "animations-v1/actor.player/hurt.3.png")
                .unwrap();
            assert_eq!(sprite["rect"]["x"], 16.);
            assert_eq!(sprite["flipX"], mode == "tiles");
            let door = commands
                .iter()
                .find(|c| c["image"] == "terrain.door.png")
                .unwrap();
            assert_eq!(door["rect"]["x"], 32.);
            assert_eq!(commands.last(), Some(sprite));
            frame["map_animation"][0]["displayX"] = json!(3.);
            assert!(validate(&frame, &manifest(mode)).is_err());
        }
    }

    #[test]
    fn character_animation_keeps_a_retargeted_sprite_at_the_camera_edge() {
        let mut frame = sample_frame("pixels");
        frame["width"] = json!(8);
        frame["map_tiles"] = json!([
            0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 8, 0, 0, 0, 0, 0, 0, 0, 0
        ]);
        frame["map_underlays"][0]["x"] = json!(7);
        frame["map_actors"][0]["x"] = json!(7);
        frame["map_animation"][0]["x"] = json!(7);
        frame["map_animation"][0]["displayX"] = json!(0.);
        assert!(validate(&frame, &manifest("pixels")).is_ok());
        let commands = plan(
            &frame,
            &json!({"size":32,"left":0,"top":0,"width":32,"height":32}),
            Rect::new(0., 0., 32., 32.),
            1.,
            "pixels",
        );
        let sprite = commands
            .iter()
            .find(|c| c["image"] == "animations-v1/actor.player/hurt.3.png")
            .unwrap();
        assert_eq!(sprite["rect"]["x"], 0.);
        assert_eq!(
            commands.len(),
            2,
            "Only visible terrain and the projected sprite are drawn"
        );
    }
    #[test]
    fn character_animation_replaces_only_the_actor_above_its_underlay() {
        for mode in ["tiles", "pixels"] {
            let mut frame = sample_frame(mode);
            assert!(validate(&frame, &manifest(mode)).is_ok());
            let camera = json!({"size":32,"left":0,"top":0,"width":96,"height":32});
            let animated = plan(&frame, &camera, Rect::new(0., 0., 96., 32.), 1., mode);
            frame["map_animation"] = json!([]);
            let stationary = plan(&frame, &camera, Rect::new(0., 0., 96., 32.), 1., mode);
            assert_eq!(animated.len(), stationary.len());
            let changed = animated
                .iter()
                .zip(&stationary)
                .filter(|(a, b)| a != b)
                .collect::<Vec<_>>();
            assert_eq!(changed.len(), 1);
            assert_eq!(
                changed[0].0["image"],
                "animations-v1/actor.player/hurt.3.png"
            );
            assert_eq!(changed[0].1["image"], "actor.player.png");
            assert_eq!(changed[0].0["rect"], changed[0].1["rect"]);
            assert!(
                animated
                    .iter()
                    .any(|command| command["image"] == "terrain.door.png")
            );
        }
    }

    #[test]
    fn character_animation_rejects_stale_actors_invalid_clips_and_hidden_cells() {
        for (field, value) in [
            ("id", json!(1)),
            ("state", json!("unknown")),
            ("frame", json!(3)),
            ("x", json!(0)),
            ("y", json!(0)),
        ] {
            let mut frame = sample_frame("tiles");
            frame["map_animation"][0][field] = value;
            assert_eq!(
                validate(&frame, &manifest("tiles")),
                Err("Invalid character animation frame")
            );
        }
        let mut frame = sample_frame("tiles");
        frame["map_actors"][0]["glyph"] = json!(65);
        assert!(validate(&frame, &manifest("tiles")).is_err());
        let mut frame = sample_frame("tiles");
        frame["map_animation"][0]["frame"] = json!(100);
        let commands = plan(
            &frame,
            &json!({"size":32,"left":0,"top":0,"width":96,"height":32}),
            Rect::new(0., 0., 96., 32.),
            1.,
            "tiles",
        );
        assert!(
            commands
                .iter()
                .any(|command| command["image"] == "invalid-animation/actor.player")
        );
        assert!(
            !commands
                .iter()
                .any(|command| command["image"] == "actor.player.png")
        );
    }
}
