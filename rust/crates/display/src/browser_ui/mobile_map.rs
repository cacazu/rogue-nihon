//! A fit-to-screen diagram of the current public map. It never fills unseen cells.
use super::*;

impl BrowserUi {
    pub(super) fn draw_mobile_full_map(&mut self, map: Rect) {
        self.center_key.clear();
        let frame = self.model["frame"].clone();
        let width = n(&frame["width"]).max(1.);
        let height = (n(&frame["height"]) - 2.).max(1.);
        let size = ((map.w - 16.).max(1.) / width).min((map.h - 144.).max(1.) / height);
        let camera = Camera {
            size,
            cell_h: size,
            left: width * size / 2. - map.w / 2.,
            top: height * size / 2. - map.h / 2.,
            width: map.w,
            height: map.h,
        };
        self.camera = Some(camera);
        self.widgets.begin_clip(map);
        self.text(
            &self.t("mobile.full_map"),
            map.x + 16.,
            map.y + map.h / 2. - height * size / 2. - 40.,
            map.w - 32.,
            17.,
            TEXT,
            true,
        );
        for (index, glyph) in s(&frame["map_cells"]).bytes().enumerate() {
            let x = index % width as usize;
            let y = index / width as usize;
            if y == 0 || y > height as usize || glyph == b' ' {
                continue;
            }
            let color = match glyph {
                b'@' => "#9ef0c3",
                b'%' => "#dca9ff",
                b'A'..=b'Z' => "#ff8b87",
                b'-' | b'|' => "#677c85",
                b'+' | b'#' => "#a5c1ca",
                b'.' => "#243b42",
                _ => "#ebcf91",
            };
            self.widgets.rect(
                Rect::new(
                    map.x + x as f64 * size - camera.left,
                    map.y + (y - 1) as f64 * size - camera.top,
                    size,
                    size,
                ),
                color,
            );
        }
        // The position marker is visible even when a map cell is only a few px.
        let player = &frame["player"];
        let px = map.x + n(&player["x"]) * size - camera.left + size / 2.;
        let py = map.y + (n(&player["y"]) - 1.) * size - camera.top + size / 2.;
        self.widgets.box_rect(
            Rect::new(px - 5., py - 5., 10., 10.),
            "transparent",
            Some("#9ef0c3"),
            0.,
        );
        let legend_y = map.y + map.h / 2. + height * size / 2. + 20.;
        for (index, (id, color)) in [
            ("mobile.map_player", "#9ef0c3"),
            ("mobile.map_stairs", "#dca9ff"),
            ("mobile.map_enemy", "#ff8b87"),
            ("mobile.map_item", "#ebcf91"),
        ]
        .iter()
        .enumerate()
        {
            let x = map.x + 16. + (index % 2) as f64 * (map.w - 32.) / 2.;
            let y = legend_y + (index / 2) as f64 * 32.;
            self.widgets.rect(Rect::new(x, y + 4., 12., 12.), color);
            self.text(
                &self.t(id),
                x + 20.,
                y,
                (map.w - 32.) / 2. - 24.,
                17.,
                TEXT,
                false,
            );
        }
        self.widgets.end_clip();
    }
}
