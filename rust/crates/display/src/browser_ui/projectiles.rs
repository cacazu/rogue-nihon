//! Projectile overlays share the map camera, clipping and existing image sets.
use super::*;
impl BrowserUi {
    pub(super) fn draw_projectiles(&mut self, frame: &Value, map: Rect, camera: Camera) {
        let mode = s(&self.model["displayMode"]);
        let pixels = mode == "pixels";
        let entries = tiles::manifest_ref(mode)["entries"]
            .as_array()
            .expect("map images");
        let width = n(&frame["width"]) as usize;
        for flight in array(&frame["map_projectile_animation"]) {
            let x = n(&flight["x"]);
            let y = n(&flight["y"]);
            if !x.is_finite() || !y.is_finite() || x < 0. || y < 1. {
                continue;
            }
            let index = y.round() as usize * width + x.round() as usize;
            // Current visibility can change while an earlier cast is playing.
            if s(&frame["map_cells"])
                .as_bytes()
                .get(index)
                .is_none_or(|cell| *cell == b' ')
            {
                continue;
            }
            let rect = Rect::new(
                map.x + x * camera.size - camera.left,
                map.y + (y - 1.) * camera.cell_h - camera.top,
                camera.size,
                camera.cell_h,
            );
            if rect.x + rect.w < map.x
                || rect.y + rect.h < map.y
                || rect.x > map.x + map.w
                || rect.y > map.y + map.h
            {
                continue;
            }
            let rotation = n(&flight["rotation"]);
            if flight["kind"] == "arrow" {
                // Right-facing shaft, arrowhead and fletching; turn once to the
                // shot direction. There is no spinning for arrows.
                let angle = rotation.to_radians();
                let (sin, cos) = angle.sin_cos();
                let mut path = String::new();
                for (op, px, py) in [
                    ('M', 3., 12.),
                    ('L', 21., 12.),
                    ('M', 16., 7.),
                    ('L', 21., 12.),
                    ('L', 16., 17.),
                    ('M', 4., 8.),
                    ('L', 8., 12.),
                    ('L', 4., 16.),
                ] {
                    let dx = px - 12.;
                    let dy = py - 12.;
                    path.push_str(&format!(
                        "{op}{:.3} {:.3}",
                        12. + dx * cos - dy * sin,
                        12. + dx * sin + dy * cos
                    ));
                }
                self.widgets.commands.push(json!({"op":"path","path":path,"rect":rect,"color":"@map.projectile.arrow","projectile":true}));
            } else {
                let id = if flight["kind"] == "magic" {
                    "effect.bolt_horizontal"
                } else {
                    let Some(tile) = flight["glyph"]
                        .as_u64()
                        .and_then(|glyph| u8::try_from(glyph).ok())
                        .and_then(crate::map_tiles::glyph)
                    else {
                        continue;
                    };
                    crate::map_tiles::IDS[usize::from(tile)]
                };
                let Some(entry) = entries.iter().find(|entry| entry["id"] == id) else {
                    continue;
                };
                self.widgets.commands.push(json!({"op":"image","set":mode,"image":entry["image"],"rect":rect,
                    "rotation":rotation,"fitRotation":flight["kind"]=="item","pixelArt":pixels,"projectile":true}));
            }
        }
    }
}
