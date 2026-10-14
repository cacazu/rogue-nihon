//! Owned fonts, cluster fallback, shaping, ink measurement and glyph rasterization.
use crate::Measurement;
use std::{collections::BTreeMap, rc::Rc};
use swash::{
    CacheKey, FontRef,
    scale::{Render, ScaleContext, Source, StrikeWith, image::Image},
    shape::ShapeContext,
    text::{
        Properties, Script,
        cluster::{CharCluster, Emoji, Parser, Status, Token},
    },
};

struct Font {
    data: Vec<u8>,
    offset: u32,
    key: CacheKey,
}
impl Font {
    fn new(data: Vec<u8>) -> Result<Self, String> {
        let reference = FontRef::from_index(&data, 0).ok_or("Invalid raster font")?;
        let (offset, key) = (reference.offset, reference.key);
        Ok(Self { data, offset, key })
    }
    fn as_ref(&self) -> FontRef<'_> {
        FontRef {
            data: &self.data,
            offset: self.offset,
            key: self.key,
        }
    }
}
#[derive(Clone, Copy)]
pub(crate) struct Glyph {
    pub font: usize,
    pub id: u16,
    pub x: f32,
    pub y: f32,
}
pub(crate) struct Layout {
    pub measurement: Measurement,
    pub baseline: f32,
    pub glyphs: Vec<Glyph>,
}
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct LayoutKey {
    text: String,
    size: u32,
    bold: bool,
    mono: bool,
}
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct GlyphKey {
    font: usize,
    id: u16,
    size: u32,
    bold: bool,
    x: u8,
    y: u8,
}
pub(crate) struct Fonts {
    fonts: Vec<Font>,
    shapes: ShapeContext,
    scales: ScaleContext,
    layouts: BTreeMap<LayoutKey, Rc<Layout>>,
    glyphs: BTreeMap<GlyphKey, Option<Rc<Image>>>,
}
impl Fonts {
    pub fn new(text: Vec<u8>, emoji: Vec<u8>) -> Result<Self, String> {
        Ok(Self {
            fonts: vec![Font::new(text)?, Font::new(emoji)?],
            shapes: ShapeContext::new(),
            scales: ScaleContext::new(),
            layouts: BTreeMap::new(),
            glyphs: BTreeMap::new(),
        })
    }
    pub fn layout(&mut self, text: &str, size: f32, bold: bool, mono: bool) -> Rc<Layout> {
        let key = LayoutKey {
            text: text.into(),
            size: size.to_bits(),
            bold,
            mono,
        };
        if let Some(layout) = self.layouts.get(&key) {
            return layout.clone();
        }
        if self.layouts.len() >= 4096 {
            self.layouts.clear();
        }
        let metrics = self.fonts[0].as_ref().metrics(&[]).scale(size);
        // The Canvas command ABI uses the top of the em box. Keep that anchor
        // for both measurements and painting, including negative ink ascent.
        let alignment_height = metrics.ascent + metrics.descent;
        let baseline = if alignment_height > 0. {
            size * metrics.ascent / alignment_height
        } else {
            size * 0.8
        };
        let mut parser = Parser::new(
            Script::Latin,
            text.char_indices().map(|(offset, ch)| Token {
                ch,
                offset: offset as u32,
                len: ch.len_utf8() as u8,
                info: ch.into(),
                data: 0,
            }),
        );
        let mut cluster = CharCluster::new();
        let mut clusters = Vec::new();
        while parser.next(&mut cluster) {
            let script = cluster
                .chars()
                .iter()
                .map(|c| Properties::from(c.ch).script())
                .find(|s| !matches!(s, Script::Common | Script::Inherited))
                .unwrap_or(Script::Latin);
            // Default includes text symbols such as the direction arrows. Use
            // their Japanese outline when available, then fall back to the
            // emoji font for missing pictographs. Explicit VS16 and emoji ZWJ
            // sequences retain color presentation even when an outline exists.
            let color_presentation = cluster.info().is_emoji()
                && (cluster.info().emoji() == Emoji::Color
                    || (cluster.info().emoji() != Emoji::Text
                        && cluster.chars().iter().any(|ch| ch.ch == '\u{200d}')));
            let order = if color_presentation { [1, 0] } else { [0, 1] };
            let mut selected = order[0];
            for index in order {
                let charmap = self.fonts[index].as_ref().charmap();
                match cluster.map(|ch| charmap.map(ch)) {
                    Status::Complete => {
                        selected = index;
                        break;
                    }
                    Status::Keep => selected = index,
                    Status::Discard => {}
                }
            }
            clusters.push((cluster, selected, script));
        }
        let mut glyphs = Vec::new();
        let mut advance = 0f32;
        let mut start = 0;
        while start < clusters.len() {
            let (_, font, script) = clusters[start];
            let mut end = start + 1;
            while end < clusters.len() && clusters[end].1 == font && clusters[end].2 == script {
                end += 1;
            }
            let reference = self.fonts[font].as_ref();
            let mut shaper = self
                .shapes
                .builder(reference)
                .script(script)
                .size(size)
                .variations([("wght", if bold { 600. } else { 400. })])
                .features([
                    ("liga", if mono { 0 } else { 1 }),
                    ("kern", if mono { 0 } else { 1 }),
                ])
                .build();
            for (cluster, _, _) in &clusters[start..end] {
                shaper.add_cluster(cluster);
            }
            shaper.shape_with(|cluster| {
                let beginning = advance;
                for glyph in cluster.glyphs {
                    glyphs.push(Glyph {
                        font,
                        id: glyph.id,
                        x: advance + glyph.x,
                        y: glyph.y,
                    });
                    advance += glyph.advance;
                }
                if mono && !cluster.glyphs.is_empty() {
                    // The ASCII map keeps a fixed cell width even with the
                    // proportional Japanese font; attached marks have no cell.
                    let source = text
                        .get(cluster.source.start as usize..cluster.source.end as usize)
                        .unwrap_or("");
                    let count = source
                        .chars()
                        .filter(|ch| {
                            Properties::from(*ch).combining_class() == 0
                                && !matches!(*ch, '\u{200d}' | '\u{fe0e}' | '\u{fe0f}')
                        })
                        .count()
                        .max(1);
                    advance = beginning + size * 0.6 * count as f32;
                }
            });
            start = end;
        }
        let mut top = f32::INFINITY;
        let mut bottom = f32::NEG_INFINITY;
        for glyph in &glyphs {
            if let Some(image) = self.glyph(*glyph, size, bold, 0., 0.) {
                if image.placement.width == 0 || image.placement.height == 0 {
                    continue;
                }
                let y = baseline - glyph.y - image.placement.top as f32;
                top = top.min(y);
                bottom = bottom.max(y + image.placement.height as f32);
            }
        }
        let (ascent, descent) = if top.is_finite() {
            (-top as f64, bottom as f64)
        } else {
            (0., 0.)
        };
        let layout = Rc::new(Layout {
            measurement: Measurement {
                width: advance as f64,
                ascent,
                descent,
            },
            baseline,
            glyphs,
        });
        self.layouts.insert(key, layout.clone());
        layout
    }
    pub fn glyph(
        &mut self,
        glyph: Glyph,
        size: f32,
        bold: bool,
        x: f32,
        y: f32,
    ) -> Option<Rc<Image>> {
        // Fractional placement is quantized to quarters of a device pixel so
        // repeated pans do not create an unbounded glyph cache.
        let phase = |v: f32| ((v - v.floor()) * 4.).floor() as u8;
        let (x, y) = (phase(x), phase(y));
        let key = GlyphKey {
            font: glyph.font,
            id: glyph.id,
            size: size.to_bits(),
            bold,
            x,
            y,
        };
        if let Some(image) = self.glyphs.get(&key) {
            return image.clone();
        }
        if self.glyphs.len() >= 8192 {
            self.glyphs.clear();
        }
        let reference = self.fonts[glyph.font].as_ref();
        let mut scaler = self
            .scales
            .builder(reference)
            .size(size)
            .hint(false)
            .variations([("wght", if bold { 600. } else { 400. })])
            .build();
        let image = Render::new(&[Source::ColorBitmap(StrikeWith::BestFit), Source::Outline])
            .offset(swash::zeno::Vector::new(x as f32 / 4., y as f32 / 4.))
            .render(&mut scaler, glyph.id)
            .map(Rc::new);
        self.glyphs.insert(key, image.clone());
        image
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Renderer;
    use serde_json::json;

    #[test]
    fn text_arrows_use_japanese_outlines_and_emoji_keep_color() {
        let assets =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../web/assets/fonts");
        let mut renderer = Renderer::new(
            std::fs::read(assets.join("NotoSansJP.ttf")).unwrap(),
            std::fs::read(assets.join("NotoColorEmoji.ttf")).unwrap(),
        )
        .unwrap();
        let font = renderer.fonts.fonts[0].as_ref();
        for arrow in ['↖', '↗', '↙', '↘'] {
            assert_ne!(font.charmap().map(arrow), 0);
        }
        let arrows = renderer.fonts.layout("↖↗↙↘", 24., false, false);
        assert_eq!(arrows.glyphs.len(), 4);
        assert!(arrows.glyphs.iter().all(|glyph| glyph.font == 0));
        renderer
            .render(
                256,
                64,
                1.,
                &[json!({
                    "op":"text", "text":"↖↗↙↘", "x":4, "y":4, "size":24,
                    "color":"#fff", "bold":false, "mono":false,
                })],
                &mut BTreeMap::new(),
            )
            .unwrap();
        assert!(renderer.rgba().chunks_exact(4).any(|pixel| pixel[0] > 0));
        assert!(
            renderer
                .rgba()
                .chunks_exact(4)
                .all(|pixel| pixel[0] == pixel[1] && pixel[1] == pixel[2])
        );
        for text in ["💪", "👑", "🧑\u{200d}💻", "↖\u{fe0f}"] {
            let emoji = renderer.fonts.layout(text, 24., false, false);
            assert_eq!(emoji.glyphs.len(), 1);
            assert_eq!(emoji.glyphs[0].font, 1);
            renderer
                .render(
                    64,
                    64,
                    1.,
                    &[json!({
                        "op":"text", "text":text, "x":4, "y":4, "size":24,
                        "color":"#fff", "bold":false, "mono":false,
                    })],
                    &mut BTreeMap::new(),
                )
                .unwrap();
            assert!(
                renderer
                    .rgba()
                    .chunks_exact(4)
                    .any(|pixel| pixel[0].abs_diff(pixel[1]) > 40
                        || pixel[1].abs_diff(pixel[2]) > 40),
                "{text} must retain its color bitmap"
            );
        }
        let text_arrow = renderer.fonts.layout("↖\u{fe0e}", 24., false, false);
        assert_eq!(text_arrow.glyphs[0].font, 0);
    }
}
