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
        Ok(())
    }
}
pub fn assets(mode: &str) -> Value {
    let m = manifest(mode);
    let files = array(&m["entries"])
        .iter()
        .map(|e| s(&e["image"]))
        .collect::<std::collections::BTreeSet<_>>();
    json!({"kind":"assets","set":mode,"base":if mode=="pixels" {"/web/assets/pixels-v2/"} else {"/web/assets/tiles/"},
        "pixels":m["tile_pixels"],"files":files,"manifest":m})
}
pub fn plan(frame: &Value, camera: &Value, rect: Rect, ratio: f64, mode: &str) -> Vec<Value> {
    let m = manifest(mode);
    let entries = array(&m["entries"]);
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
                commands.push(json!({"op":"image","set":if mode=="pixels" {"pixels"} else {"tiles"},
            "image":entries[tile]["image"],"rotation":entries[tile]["rotation"].as_f64().unwrap_or(0.),"pixelArt":m["tile_pixels"]==32,
            "rect":Rect::new(rect.x+px/ratio,rect.y+py/ratio,w/ratio,h/ratio)}));
            }
        }
    }
    commands
}
