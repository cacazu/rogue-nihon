//! Software rendering in Rust. The host receives only a completed RGBA frame.
mod fonts;
mod images;
pub use images::{Image, ImageSet};

use serde_json::Value;
use std::{
    collections::{BTreeMap, VecDeque},
    rc::Rc,
};
use tiny_skia::{
    Color, FillRule, LineCap, LineJoin, Mask, Paint, Path, PathBuilder, Pixmap, Rect, Stroke,
    Transform,
};

#[derive(Clone, Copy, Default, Debug)]
pub struct Measurement {
    pub width: f64,
    pub ascent: f64,
    pub descent: f64,
}
#[derive(Clone)]
struct State {
    alpha: f32,
    clip: Option<Rc<Mask>>,
    clip_key: Vec<u64>,
}
const MAX_MASK_CACHE_BYTES: usize = 16 * 1024 * 1024;
const MAX_MASK_CACHE_ENTRIES: usize = 8;
pub struct Renderer {
    fonts: fonts::Fonts,
    frame: Pixmap,
    paths: BTreeMap<String, Path>,
    masks: VecDeque<(Vec<u64>, Rc<Mask>)>,
    mask_bytes: usize,
}
impl Renderer {
    pub fn new(text_font: Vec<u8>, emoji_font: Vec<u8>) -> Result<Self, String> {
        Ok(Self {
            fonts: fonts::Fonts::new(text_font, emoji_font)?,
            frame: Pixmap::new(1, 1).unwrap(),
            paths: BTreeMap::new(),
            masks: VecDeque::new(),
            mask_bytes: 0,
        })
    }
    pub fn measure(&mut self, text: &str, size: f64, bold: bool, mono: bool) -> Measurement {
        if !size.is_finite() || size <= 0. {
            return Measurement::default();
        }
        self.fonts.layout(text, size as f32, bold, mono).measurement
    }
    pub fn rgba(&self) -> &[u8] {
        // Painting starts with an opaque frame. Source-over preserves alpha255,
        // so premultiplied RGB is also straight RGBA for the browser transfer.
        self.frame.data()
    }
    pub fn render(
        &mut self,
        width: u32,
        height: u32,
        ratio: f64,
        commands: &[Value],
        sets: &mut BTreeMap<String, ImageSet>,
    ) -> Result<(), String> {
        if !ratio.is_finite() || ratio <= 0. {
            return Err("Invalid raster pixel ratio".into());
        }
        if self.frame.width() != width || self.frame.height() != height {
            self.frame = Pixmap::new(width, height).ok_or("Invalid raster surface dimensions")?;
            self.masks.clear();
            self.mask_bytes = 0;
        }
        self.frame.fill(Color::BLACK);
        let mut state = State {
            alpha: 1.,
            clip: None,
            clip_key: vec![u64::from(width), u64::from(height), ratio.to_bits()],
        };
        let mut stack = Vec::new();
        let transform = Transform::from_scale(ratio as f32, ratio as f32);
        for command in commands {
            let r = &command["rect"];
            let (x, y, w, h) = (
                number(&r["x"]),
                number(&r["y"]),
                number(&r["w"]),
                number(&r["h"]),
            );
            match text(&command["op"]) {
                "save" => {
                    stack.push(state.clone());
                    let alpha = number(&command["alpha"]);
                    if (0. ..=1.).contains(&alpha) {
                        state.alpha = alpha as f32;
                    }
                }
                "restore" => {
                    if let Some(saved) = stack.pop() {
                        state = saved;
                    }
                }
                "clip" => {
                    stack.push(state.clone());
                    state
                        .clip_key
                        .extend([x.to_bits(), y.to_bits(), w.to_bits(), h.to_bits()]);
                    if let Some(index) = self
                        .masks
                        .iter()
                        .position(|(key, _)| key == &state.clip_key)
                    {
                        let entry = self.masks.remove(index).unwrap();
                        state.clip = Some(entry.1.clone());
                        self.masks.push_back(entry);
                        continue;
                    }
                    if let Some(rect) = rectangle(x, y, w, h)
                        && let Some(mask) =
                            integer_clip(width, height, ratio, rect, state.clip.as_deref())
                    {
                        state.clip = Some(self.remember_mask(&state.clip_key, mask));
                        continue;
                    }
                    let mut mask = match state.clip.as_deref() {
                        Some(previous) => previous.clone(),
                        None => {
                            let mut mask =
                                Mask::new(width, height).ok_or("Invalid clip surface")?;
                            mask.data_mut().fill(255);
                            mask
                        }
                    };
                    if let Some(rect) = rectangle(x, y, w, h) {
                        let path = PathBuilder::from_rect(rect);
                        mask.intersect_path(&path, FillRule::Winding, true, transform);
                    } else {
                        mask.clear();
                    }
                    state.clip = Some(self.remember_mask(&state.clip_key, mask));
                }
                "rect" => {
                    if let Some(rect) = rectangle(x, y, w, h) {
                        let paint = paint(text(&command["color"]), state.alpha)?;
                        self.frame
                            .fill_rect(rect, &paint, transform, state.clip.as_deref());
                    }
                }
                "box" => {
                    if let Some(path) = rounded_box(x, y, w, h, number(&command["radius"])) {
                        let fill = paint(text(&command["fill"]), state.alpha)?;
                        self.frame.fill_path(
                            &path,
                            &fill,
                            FillRule::Winding,
                            transform,
                            state.clip.as_deref(),
                        );
                        if command["stroke"].is_string() {
                            let stroke = paint(text(&command["stroke"]), state.alpha)?;
                            self.frame.stroke_path(
                                &path,
                                &stroke,
                                &Stroke {
                                    width: 1.,
                                    ..Stroke::default()
                                },
                                transform,
                                state.clip.as_deref(),
                            );
                        }
                    }
                }
                "circle" => {
                    let radius = number(&command["radius"]);
                    if radius > 0. {
                        if let Some(path) = PathBuilder::from_circle(
                            number(&command["x"]) as f32,
                            number(&command["y"]) as f32,
                            radius as f32,
                        ) {
                            let paint = paint(text(&command["color"]), state.alpha)?;
                            self.frame.fill_path(
                                &path,
                                &paint,
                                FillRule::Winding,
                                transform,
                                state.clip.as_deref(),
                            );
                        }
                    }
                }
                "path" => {
                    let source = text(&command["path"]);
                    if source.is_empty() || w <= 0. || h <= 0. {
                        continue;
                    }
                    if !self.paths.contains_key(source) {
                        self.paths.insert(source.into(), svg_path(source)?);
                    }
                    let path = &self.paths[source];
                    let transform = Transform::from_row(
                        (w * ratio / 24.) as f32,
                        0.,
                        0.,
                        (h * ratio / 24.) as f32,
                        (x * ratio) as f32,
                        (y * ratio) as f32,
                    );
                    let fill = command["fill"].as_bool().unwrap_or(false);
                    let mut stroke = Stroke {
                        width: 1.8,
                        line_cap: LineCap::Round,
                        line_join: LineJoin::Round,
                        ..Stroke::default()
                    };
                    if command["outline"].is_object() {
                        stroke.width = (if fill { 0. } else { 1.8 }
                            + 2. * number(&command["outline"]["width"]) * 24. / w)
                            as f32;
                        let paint = paint(text(&command["outline"]["color"]), state.alpha)?;
                        self.frame.stroke_path(
                            path,
                            &paint,
                            &stroke,
                            transform,
                            state.clip.as_deref(),
                        );
                    }
                    let paint = paint(text(&command["color"]), state.alpha)?;
                    if fill {
                        self.frame.fill_path(
                            path,
                            &paint,
                            FillRule::Winding,
                            transform,
                            state.clip.as_deref(),
                        );
                    } else {
                        stroke.width = 1.8;
                        self.frame.stroke_path(
                            path,
                            &paint,
                            &stroke,
                            transform,
                            state.clip.as_deref(),
                        );
                    }
                }
                "image" => {
                    let name = text(&command["set"]);
                    let set = sets
                        .get_mut(name)
                        .ok_or_else(|| format!("Missing tile set: {name}"))?;
                    images::draw_image(
                        &mut self.frame,
                        set,
                        command,
                        ratio,
                        state.alpha,
                        state.clip.as_deref(),
                    )?;
                }
                "text" => self.text(command, ratio as f32, &state)?,
                other => return Err(format!("Unknown draw command: {other}")),
            }
        }
        Ok(())
    }
    fn remember_mask(&mut self, key: &[u64], mask: Mask) -> Rc<Mask> {
        let bytes = mask.data().len();
        let mask = Rc::new(mask);
        if bytes <= MAX_MASK_CACHE_BYTES {
            while self.masks.len() >= MAX_MASK_CACHE_ENTRIES
                || self.mask_bytes + bytes > MAX_MASK_CACHE_BYTES
            {
                let (_, removed) = self.masks.pop_front().unwrap();
                self.mask_bytes -= removed.data().len();
            }
            self.mask_bytes += bytes;
            self.masks.push_back((key.to_vec(), mask.clone()));
        }
        mask
    }
    fn text(&mut self, command: &Value, ratio: f32, state: &State) -> Result<(), String> {
        let size = number(&command["size"]) as f32;
        if size <= 0. || !size.is_finite() {
            return Ok(());
        }
        let bold = command["bold"].as_bool().unwrap_or(false);
        let mono = command["mono"].as_bool().unwrap_or(false);
        let layout = self.fonts.layout(text(&command["text"]), size, bold, mono);
        let ink = color(text(&command["color"]))?;
        let x = number(&command["x"]) as f32 * ratio;
        let baseline = (number(&command["y"]) as f32 + layout.baseline) * ratio;
        for glyph in &layout.glyphs {
            let gx = x + glyph.x * ratio;
            let gy = baseline - glyph.y * ratio;
            let Some(image) = self.fonts.glyph(*glyph, size * ratio, bold, gx, gy) else {
                continue;
            };
            let left = gx.floor() as i32 + image.placement.left;
            let top = gy.floor() as i32 - image.placement.top;
            if command["outline"].is_object() {
                let outline = color(text(&command["outline"]["color"]))?;
                let width = number(&command["outline"]["width"]) as f32 * ratio;
                let d = std::f32::consts::FRAC_1_SQRT_2;
                for (dx, dy) in [
                    (-1., 0.),
                    (1., 0.),
                    (0., -1.),
                    (0., 1.),
                    (-d, -d),
                    (d, -d),
                    (-d, d),
                    (d, d),
                ] {
                    blit_glyph(
                        &mut self.frame,
                        &image,
                        left + (dx * width).round() as i32,
                        top + (dy * width).round() as i32,
                        outline,
                        state,
                        true,
                    );
                }
            }
            blit_glyph(&mut self.frame, &image, left, top, ink, state, false);
        }
        Ok(())
    }
}

fn integer_clip(
    width: u32,
    height: u32,
    ratio: f64,
    rect: Rect,
    previous: Option<&Mask>,
) -> Option<Mask> {
    let edges = [
        f64::from(rect.left()) * ratio,
        f64::from(rect.top()) * ratio,
        f64::from(rect.right()) * ratio,
        f64::from(rect.bottom()) * ratio,
    ];
    if edges.iter().any(|v| !v.is_finite() || v.fract() != 0.) {
        return None;
    }
    let [left, top, right, bottom] = edges;
    let left = left.clamp(0., f64::from(width)) as usize;
    let right = right.clamp(0., f64::from(width)) as usize;
    let top = top.clamp(0., f64::from(height)) as usize;
    let bottom = bottom.clamp(0., f64::from(height)) as usize;
    let mut mask = Mask::new(width, height)?;
    for y in top..bottom {
        let start = y * width as usize + left;
        let end = y * width as usize + right;
        if let Some(previous) = previous {
            mask.data_mut()[start..end].copy_from_slice(&previous.data()[start..end]);
        } else {
            mask.data_mut()[start..end].fill(255);
        }
    }
    Some(mask)
}

fn blit_glyph(
    frame: &mut Pixmap,
    image: &swash::scale::image::Image,
    left: i32,
    top: i32,
    color: [u8; 4],
    state: &State,
    shadow: bool,
) {
    use swash::scale::image::Content;
    let iw = image.placement.width as i32;
    let ih = image.placement.height as i32;
    let fw = frame.width() as i32;
    let fh = frame.height() as i32;
    for iy in (-top).max(0)..ih.min(fh - top) {
        for ix in (-left).max(0)..iw.min(fw - left) {
            let src = (iy * iw + ix) as usize;
            let dest = ((top + iy) * fw + left + ix) as usize;
            let mut rgba = match image.content {
                Content::Mask => [
                    color[0],
                    color[1],
                    color[2],
                    ((image.data[src] as u32 * color[3] as u32 + 127) / 255) as u8,
                ],
                Content::Color => {
                    let p = &image.data[src * 4..src * 4 + 4];
                    if shadow {
                        [
                            color[0],
                            color[1],
                            color[2],
                            ((p[3] as u32 * color[3] as u32 + 127) / 255) as u8,
                        ]
                    } else {
                        [p[0], p[1], p[2], p[3]]
                    }
                }
                Content::SubpixelMask => {
                    // Rendering requests grayscale coverage; retain a safe path
                    // for a future font source that yields subpixel data.
                    let p = &image.data[src * 4..src * 4 + 4];
                    [color[0], color[1], color[2], *p[..3].iter().max().unwrap()]
                }
            };
            let clip = state.clip.as_deref().map_or(255, |mask| mask.data()[dest]);
            rgba[3] = (rgba[3] as f32 * state.alpha * clip as f32 / 255.).round() as u8;
            let alpha = rgba[3] as u32;
            if alpha == 0 {
                continue;
            }
            let target = &mut frame.data_mut()[dest * 4..dest * 4 + 4];
            for channel in 0..3 {
                target[channel] =
                    ((rgba[channel] as u32 * alpha + target[channel] as u32 * (255 - alpha) + 127)
                        / 255) as u8;
            }
        }
    }
}
fn number(value: &Value) -> f64 {
    value.as_f64().filter(|v| v.is_finite()).unwrap_or(0.)
}
fn text(value: &Value) -> &str {
    value.as_str().unwrap_or("")
}
fn rectangle(x: f64, y: f64, w: f64, h: f64) -> Option<Rect> {
    let (x, w) = if w < 0. { (x + w, -w) } else { (x, w) };
    let (y, h) = if h < 0. { (y + h, -h) } else { (y, h) };
    Rect::from_xywh(x as f32, y as f32, w as f32, h as f32)
}
fn paint(value: &str, opacity: f32) -> Result<Paint<'static>, String> {
    let [r, g, b, a] = color(value)?;
    let mut paint = Paint::default();
    paint.set_color_rgba8(r, g, b, (a as f32 * opacity).round() as u8);
    paint.anti_alias = true;
    Ok(paint)
}
fn color(value: &str) -> Result<[u8; 4], String> {
    if value == "transparent" {
        return Ok([0, 0, 0, 0]);
    }
    if value == "black" {
        return Ok([0, 0, 0, 255]);
    }
    if value == "white" {
        return Ok([255, 255, 255, 255]);
    }
    let s = value
        .strip_prefix('#')
        .ok_or_else(|| format!("Unsupported raster color: {value}"))?;
    if !s.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("Invalid raster color: {value}"));
    }
    let parse =
        |s: &str| u8::from_str_radix(s, 16).map_err(|_| format!("Invalid raster color: {value}"));
    match s.len() {
        3 => Ok([
            parse(&s[0..1].repeat(2))?,
            parse(&s[1..2].repeat(2))?,
            parse(&s[2..3].repeat(2))?,
            255,
        ]),
        4 => Ok([
            parse(&s[0..1].repeat(2))?,
            parse(&s[1..2].repeat(2))?,
            parse(&s[2..3].repeat(2))?,
            parse(&s[3..4].repeat(2))?,
        ]),
        6 => Ok([parse(&s[0..2])?, parse(&s[2..4])?, parse(&s[4..6])?, 255]),
        8 => Ok([
            parse(&s[0..2])?,
            parse(&s[2..4])?,
            parse(&s[4..6])?,
            parse(&s[6..8])?,
        ]),
        _ => Err(format!("Invalid raster color: {value}")),
    }
}
fn rounded_box(x: f64, y: f64, w: f64, h: f64, r: f64) -> Option<Path> {
    if w <= 0. || h <= 0. {
        return None;
    }
    let r = r.max(0.).min(w / 2.).min(h / 2.);
    if r == 0. {
        return rectangle(x, y, w, h).map(PathBuilder::from_rect);
    }
    let (x, y, w, h, r) = (x as f32, y as f32, w as f32, h as f32, r as f32);
    let k = r * 0.5522848;
    let mut p = PathBuilder::new();
    p.move_to(x + r, y);
    p.line_to(x + w - r, y);
    p.cubic_to(x + w - r + k, y, x + w, y + r - k, x + w, y + r);
    p.line_to(x + w, y + h - r);
    p.cubic_to(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h);
    p.line_to(x + r, y + h);
    p.cubic_to(x + r - k, y + h, x, y + h - r + k, x, y + h - r);
    p.line_to(x, y + r);
    p.cubic_to(x, y + r - k, x + r - k, y, x + r, y);
    p.close();
    p.finish()
}
fn svg_path(source: &str) -> Result<Path, String> {
    use svgtypes::SimplePathSegment;
    let mut path = PathBuilder::new();
    for segment in svgtypes::SimplifyingPathParser::from(source) {
        match segment.map_err(|e| e.to_string())? {
            SimplePathSegment::MoveTo { x, y } => path.move_to(x as f32, y as f32),
            SimplePathSegment::LineTo { x, y } => path.line_to(x as f32, y as f32),
            SimplePathSegment::CurveTo {
                x1,
                y1,
                x2,
                y2,
                x,
                y,
            } => path.cubic_to(
                x1 as f32, y1 as f32, x2 as f32, y2 as f32, x as f32, y as f32,
            ),
            SimplePathSegment::Quadratic { x1, y1, x, y } => {
                path.quad_to(x1 as f32, y1 as f32, x as f32, y as f32)
            }
            SimplePathSegment::ClosePath => path.close(),
        }
    }
    path.finish().ok_or_else(|| "Empty SVG icon path".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn renderer() -> Renderer {
        let assets =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../web/assets/fonts");
        Renderer::new(
            std::fs::read(assets.join("NotoSansJP.ttf")).unwrap(),
            std::fs::read(assets.join("NotoColorEmoji.ttf")).unwrap(),
        )
        .unwrap()
    }
    fn pixel(frame: &[u8], width: usize, x: usize, y: usize) -> &[u8] {
        &frame[(y * width + x) * 4..(y * width + x + 1) * 4]
    }
    #[test]
    fn clip_cache_distinguishes_parent_bounds_and_surface_sizes() {
        let mut renderer = renderer();
        for (parent, width, height, covered) in [
            (16., 32, 24, true),
            (16., 32, 24, true),
            (8., 32, 24, false),
            (16., 48, 32, true),
        ] {
            let commands = [
                json!({"op":"rect","rect":{"x":0,"y":0,"w":width,"h":height},"color":"#fff"}),
                json!({"op":"clip","rect":{"x":0.25,"y":0.25,"w":parent,"h":20}}),
                json!({"op":"clip","rect":{"x":8,"y":0,"w":16,"h":20}}),
                json!({"op":"rect","rect":{"x":0,"y":0,"w":width,"h":height},"color":"#f00"}),
            ];
            renderer
                .render(width, height, 1., &commands, &mut BTreeMap::new())
                .unwrap();
            assert_eq!(
                pixel(renderer.rgba(), width as usize, 12, 10),
                if covered {
                    &[255, 0, 0, 255][..]
                } else {
                    &[255, 255, 255, 255][..]
                }
            );
            assert_eq!(
                pixel(renderer.rgba(), width as usize, 25, 10),
                &[255, 255, 255, 255]
            );
        }
    }
    #[test]
    fn integer_clips_match_path_coverage_and_preserve_previous_masks() {
        for rect in [
            Rect::from_xywh(2., 3., 5., 4.).unwrap(),
            Rect::from_xywh(-2., -3., 8., 8.).unwrap(),
            Rect::from_xywh(50., 50., 5., 5.).unwrap(),
        ] {
            for ratio in [1., 2.] {
                let mut previous = Mask::new(24, 24).unwrap();
                for (i, value) in previous.data_mut().iter_mut().enumerate() {
                    *value = (i % 256) as u8;
                }
                for previous in [None, Some(&previous)] {
                    let actual = integer_clip(24, 24, ratio, rect, previous).unwrap();
                    let mut expected = previous.cloned().unwrap_or_else(|| {
                        let mut mask = Mask::new(24, 24).unwrap();
                        mask.data_mut().fill(255);
                        mask
                    });
                    expected.intersect_path(
                        &PathBuilder::from_rect(rect),
                        FillRule::Winding,
                        true,
                        Transform::from_scale(ratio as f32, ratio as f32),
                    );
                    assert_eq!(actual.data(), expected.data());
                }
            }
        }
        assert!(
            integer_clip(24, 24, 1., Rect::from_xywh(0.25, 0., 4., 4.).unwrap(), None).is_none()
        );
    }
    #[test]
    fn nested_clips_opacity_and_vector_icons_render_inside_rust() {
        let mut renderer = renderer();
        let commands = vec![
            json!({"op":"rect","rect":{"x":0,"y":0,"w":24,"h":24},"color":"#fff"}),
            json!({"op":"clip","rect":{"x":2,"y":2,"w":20,"h":20}}),
            json!({"op":"save","alpha":0.5}),
            json!({"op":"rect","rect":{"x":0,"y":0,"w":24,"h":24},"color":"#000"}),
            json!({"op":"clip","rect":{"x":4,"y":4,"w":16,"h":16}}),
            json!({"op":"rect","rect":{"x":0,"y":0,"w":24,"h":24},"color":"#f00"}),
            json!({"op":"restore"}),
            json!({"op":"restore"}),
            json!({"op":"restore"}),
            json!({"op":"rect","rect":{"x":0,"y":0,"w":1,"h":1},"color":"#00f"}),
        ];
        renderer
            .render(48, 48, 2., &commands, &mut BTreeMap::new())
            .unwrap();
        assert_eq!(pixel(renderer.rgba(), 48, 0, 0), &[0, 0, 255, 255]);
        assert_eq!(pixel(renderer.rgba(), 48, 2, 2), &[255, 255, 255, 255]);
        let outer = pixel(renderer.rgba(), 48, 6, 6);
        assert!(outer[0].abs_diff(127) <= 1 && outer[0] == outer[1] && outer[1] == outer[2]);
        let inner = pixel(renderer.rgba(), 48, 12, 12);
        assert!(inner[0] > outer[0] && inner[1] < outer[1]);
        assert!(renderer.rgba().chunks_exact(4).all(|p| p[3] == 255));
        let commands = vec![
            json!({"op":"box","rect":{"x":0,"y":0,"w":24,"h":24},"fill":"#151515","stroke":"#555","radius":5}),
            json!({"op":"circle","x":12,"y":12,"radius":7,"color":"#0f0"}),
            json!({"op":"path","rect":{"x":0,"y":0,"w":24,"h":24},"path":"M21 12A9 9 0 1 1 3 12A9 9 0 1 1 21 12ZM7 12L10.5 15.5L17 8.5","fill":false,"color":"#fff","outline":{"color":"#000","width":2}}),
        ];
        renderer
            .render(48, 48, 2., &commands, &mut BTreeMap::new())
            .unwrap();
        assert!(
            renderer
                .rgba()
                .chunks_exact(4)
                .any(|p| p[..3] == [0, 255, 0])
        );
        assert!(
            renderer
                .rgba()
                .chunks_exact(4)
                .any(|p| p[..3] == [255, 255, 255])
        );
    }
    #[test]
    fn japanese_combining_emoji_and_monospace_share_measurement_and_painting() {
        let mut renderer = renderer();
        let japanese = renderer.measure("所有権勇者", 24., false, false);
        assert!(japanese.width > 100. && japanese.ascent + japanese.descent > 10.);
        assert!(
            (renderer.measure("が", 24., false, false).width
                - renderer.measure("か\u{3099}", 24., false, false).width)
                .abs()
                < 0.01
        );
        assert!(
            (renderer.measure("é", 24., false, false).width
                - renderer.measure("e\u{301}", 24., false, false).width)
                .abs()
                < 0.01
        );
        assert_eq!(
            renderer.measure("WWW", 20., false, true).width,
            renderer.measure("iii", 20., false, true).width
        );
        let emoji = renderer.fonts.layout("🧑\u{200d}💻", 24., false, false);
        assert_eq!(
            emoji.glyphs.len(),
            1,
            "Emoji ZWJ must stay in one shaped glyph"
        );
        let commands = [
            json!({"op":"text","text":"所有権勇者🧑\u{200d}💻か\u{3099}","x":4,"y":4,"size":24,"color":"#fff","bold":false,"mono":false}),
        ];
        renderer
            .render(400, 80, 2., &commands, &mut BTreeMap::new())
            .unwrap();
        assert!(
            renderer
                .rgba()
                .chunks_exact(4)
                .any(|p| p[0] > 10 && p[0] == p[1] && p[1] == p[2])
        );
        assert!(
            renderer
                .rgba()
                .chunks_exact(4)
                .any(|p| p[0].abs_diff(p[1]) > 40 || p[1].abs_diff(p[2]) > 40),
            "Color emoji must be decoded in Rust"
        );
    }
    #[test]
    fn png_palette_and_pixel_rotation_preserve_alpha_and_native_grid() {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 2, 1);
            encoder.set_color(png::ColorType::Indexed);
            encoder.set_palette(vec![255, 0, 0, 0, 0, 255]);
            encoder.set_trns(vec![255, 0]);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[0, 1])
                .unwrap();
        }
        let image = Image::decode_png(&bytes).unwrap();
        assert_eq!(image.width(), 2);
        assert_eq!(image.rgba(), &[255, 0, 0, 255, 0, 0, 255, 0]);
        let mut rgba = vec![0; 32 * 32 * 4];
        rgba[(5 * 32 + 2) * 4..(5 * 32 + 2) * 4 + 4].copy_from_slice(&[255, 70, 40, 255]);
        let mut set = ImageSet::new(BTreeMap::from([(
            "test".into(),
            Image::from_rgba(32, 32, rgba).unwrap(),
        )]));
        let command = json!({"op":"image","image":"test","pixelArt":true,"rotation":90,"rect":{"x":0,"y":0,"w":32,"h":32}});
        let rotated = set.rasterize(&command, 32, 32).unwrap();
        assert_eq!(pixel(&rotated, 32, 26, 2), &[255, 70, 40, 255]);
        assert_eq!(rotated.chunks_exact(4).filter(|p| p[3] != 0).count(), 1);
        let mut command = command;
        command["rotation"] = json!(45);
        let native = set.rasterize(&command, 32, 32).unwrap();
        command["rect"]["w"] = json!(128);
        command["rect"]["h"] = json!(128);
        let enlarged = set.rasterize(&command, 128, 128).unwrap();
        for y in 0..128 {
            for x in 0..128 {
                assert_eq!(
                    pixel(&enlarged, 128, x, y),
                    pixel(&native, 32, x / 4, y / 4)
                );
            }
        }
        assert!(enlarged.chunks_exact(4).all(|p| matches!(p[3], 0 | 255)));
        assert_eq!(set.rotations(), 2);
    }
}
