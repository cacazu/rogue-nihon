//! PNG decoding and the native pixel-art rotation cache have no browser dependencies.
use serde_json::Value;
use std::{collections::BTreeMap, io::Cursor};
use tiny_skia::{FilterQuality, IntSize, Mask, Pixmap, PixmapPaint, Transform};

const MAX_IMAGE_DIMENSION: u32 = 4096;
const MAX_IMAGE_PIXELS: usize = 4 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;

pub struct Image {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    opaque: bool,
    pub(crate) pixmap: Pixmap,
}
impl Image {
    pub fn decode_png(bytes: &[u8]) -> Result<Self, String> {
        let mut decoder = png::Decoder::new(Cursor::new(bytes));
        decoder.set_transformations(png::Transformations::normalize_to_color8());
        let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
        // png::Limits bounds the decoder's internal buffers, not the caller's
        // output allocation. Validate IHDR dimensions before allocating either
        // decoded channels or the RGBA conversion buffer.
        byte_count(reader.info().width, reader.info().height)?;
        let size = reader
            .output_buffer_size()
            .ok_or("PNG dimensions overflow")?;
        if size > MAX_IMAGE_BYTES {
            return Err("Image exceeds raster byte limit".into());
        }
        let mut data = vec![0; size];
        let info = reader.next_frame(&mut data).map_err(|e| e.to_string())?;
        data.truncate(info.buffer_size());
        if info.bit_depth != png::BitDepth::Eight {
            return Err("PNG did not decode to 8-bit channels".into());
        }
        let mut rgba = Vec::with_capacity(byte_count(info.width, info.height)?);
        match info.color_type {
            png::ColorType::Rgba => rgba = data,
            png::ColorType::Rgb => {
                for rgb in data.chunks_exact(3) {
                    rgba.extend_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
                }
            }
            png::ColorType::Grayscale => {
                for grey in data {
                    rgba.extend_from_slice(&[grey, grey, grey, 255]);
                }
            }
            png::ColorType::GrayscaleAlpha => {
                for pixel in data.chunks_exact(2) {
                    rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]]);
                }
            }
            png::ColorType::Indexed => return Err("PNG palette was not expanded".into()),
        }
        Self::from_rgba(info.width, info.height, rgba)
    }
    pub fn from_rgba(width: u32, height: u32, rgba: Vec<u8>) -> Result<Self, String> {
        if rgba.len() != byte_count(width, height)? {
            return Err("RGBA image dimensions do not match its bytes".into());
        }
        let size = IntSize::from_wh(width, height).ok_or("Invalid image dimensions")?;
        let mut premultiplied = rgba.clone();
        for pixel in premultiplied.chunks_exact_mut(4) {
            for channel in 0..3 {
                pixel[channel] = ((pixel[channel] as u32 * pixel[3] as u32 + 127) / 255) as u8;
            }
        }
        let pixmap = Pixmap::from_vec(premultiplied, size).ok_or("Invalid image storage")?;
        let opaque = rgba.chunks_exact(4).all(|pixel| pixel[3] == 255);
        Ok(Self {
            width,
            height,
            rgba,
            opaque,
            pixmap,
        })
    }
    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }
    pub fn rgba(&self) -> &[u8] {
        &self.rgba
    }
    /// Copy a complete sprite cell without resampling or altering straight RGBA.
    pub fn crop(&self, x: u32, y: u32, width: u32, height: u32) -> Result<Self, String> {
        let bytes = byte_count(width, height)?;
        if x.checked_add(width).is_none_or(|right| right > self.width)
            || y.checked_add(height)
                .is_none_or(|bottom| bottom > self.height)
        {
            return Err("Sprite crop is outside its image".into());
        }
        let row_bytes = width as usize * 4;
        let mut rgba = Vec::with_capacity(bytes);
        for row in y..y + height {
            let start = (row as usize * self.width as usize + x as usize) * 4;
            rgba.extend_from_slice(&self.rgba[start..start + row_bytes]);
        }
        Self::from_rgba(width, height, rgba)
    }
    fn native_rotation(&self, degrees: f64) -> Result<Self, String> {
        if self.width != 32 || self.height != 32 || !degrees.is_finite() {
            return Err("Invalid native pixel image".into());
        }
        // Preserve the original 32px sampling grid before destination enlargement.
        let mut rgba = vec![0; 32 * 32 * 4];
        let cos = degrees.to_radians().cos();
        let sin = degrees.to_radians().sin();
        for y in 0..32 {
            for x in 0..32 {
                let dx = x as f64 + 0.5 - 16.;
                let dy = y as f64 + 0.5 - 16.;
                let sx = (dx * cos + dy * sin + 16.).floor() as i32;
                let sy = (-dx * sin + dy * cos + 16.).floor() as i32;
                if (0..32).contains(&sx) && (0..32).contains(&sy) {
                    let from = (sy * 32 + sx) as usize * 4;
                    let to = (y * 32 + x) * 4;
                    rgba[to..to + 4].copy_from_slice(&self.rgba[from..from + 4]);
                }
            }
        }
        Self::from_rgba(32, 32, rgba)
    }
}
fn byte_count(width: u32, height: u32) -> Result<usize, String> {
    if width == 0 || height == 0 {
        return Err("Empty image".into());
    }
    if width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION {
        return Err("Image exceeds raster dimension limit".into());
    }
    let pixels = (width as usize)
        .checked_mul(height as usize)
        .ok_or("Image dimensions overflow")?;
    if pixels > MAX_IMAGE_PIXELS {
        return Err("Image exceeds raster pixel limit".into());
    }
    let bytes = pixels.checked_mul(4).ok_or("Image dimensions overflow")?;
    if bytes > MAX_IMAGE_BYTES {
        return Err("Image exceeds raster byte limit".into());
    }
    Ok(bytes)
}

pub struct ImageSet {
    images: BTreeMap<String, Image>,
    rotated: BTreeMap<(String, u64), Image>,
}
impl ImageSet {
    pub fn new(images: BTreeMap<String, Image>) -> Self {
        Self {
            images,
            rotated: BTreeMap::new(),
        }
    }
    pub fn images(&self) -> usize {
        self.images.len()
    }
    pub fn rotations(&self) -> usize {
        self.rotated.len()
    }
    /// Standalone transparent raster for the image gallery and scoped tile tests.
    pub fn rasterize(
        &mut self,
        command: &Value,
        width: u32,
        height: u32,
    ) -> Result<Vec<u8>, String> {
        let mut frame = Pixmap::new(width, height).ok_or("Invalid image raster dimensions")?;
        let commands = command
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_else(|| std::slice::from_ref(command));
        for command in commands {
            draw_image(&mut frame, self, command, 1., 1., None)?;
        }
        // Pixmap stores premultiplied channels; ImageData expects straight RGBA.
        let mut rgba = frame.take();
        for pixel in rgba.chunks_exact_mut(4) {
            let alpha = pixel[3] as u32;
            if alpha > 0 && alpha < 255 {
                for channel in 0..3 {
                    pixel[channel] =
                        ((pixel[channel] as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
                }
            }
        }
        Ok(rgba)
    }
    pub(crate) fn image(
        &mut self,
        name: &str,
        rotation: f64,
        pixel_art: bool,
    ) -> Result<&Image, String> {
        if rotation != 0. && pixel_art {
            let key = (name.to_owned(), rotation.to_bits());
            if !self.rotated.contains_key(&key) {
                let image = self
                    .images
                    .get(name)
                    .ok_or_else(|| format!("Missing tile image: {name}"))?;
                self.rotated
                    .insert(key.clone(), image.native_rotation(rotation)?);
            }
            Ok(&self.rotated[&key])
        } else {
            self.images
                .get(name)
                .ok_or_else(|| format!("Missing tile image: {name}"))
        }
    }
}

pub(crate) fn draw_image(
    frame: &mut Pixmap,
    set: &mut ImageSet,
    command: &Value,
    ratio: f64,
    alpha: f32,
    clip: Option<&Mask>,
) -> Result<(), String> {
    let rect = &command["rect"];
    let (x, y, w, h) = (
        super::number(&rect["x"]),
        super::number(&rect["y"]),
        super::number(&rect["w"]),
        super::number(&rect["h"]),
    );
    if w <= 0. || h <= 0. {
        return Ok(());
    }
    let rotation = super::number(&command["rotation"]);
    let pixel_art = command["pixelArt"].as_bool().unwrap_or(false);
    let image = set.image(super::text(&command["image"]), rotation, pixel_art)?;
    let degrees = if pixel_art { 0. } else { rotation };
    let flip = command["flipX"] == true;
    if degrees == 0.
        && alpha == 1.
        && blit_opaque(
            frame,
            image,
            [x * ratio, y * ratio, w * ratio, h * ratio],
            flip,
            clip,
        )
    {
        return Ok(());
    }
    let (cos, sin) = (degrees.to_radians().cos(), degrees.to_radians().sin());
    let (sx, sy) = (
        w / image.width as f64 * ratio * if flip { -1. } else { 1. },
        h / image.height as f64 * ratio,
    );
    let (a, b, c, d) = (cos * sx, sin * sx, -sin * sy, cos * sy);
    let (cx, cy) = ((x + w / 2.) * ratio, (y + h / 2.) * ratio);
    let (tx, ty) = (
        cx - a * image.width as f64 / 2. - c * image.height as f64 / 2.,
        cy - b * image.width as f64 / 2. - d * image.height as f64 / 2.,
    );
    let transform =
        Transform::from_row(a as f32, b as f32, c as f32, d as f32, tx as f32, ty as f32);
    let paint = PixmapPaint {
        opacity: alpha,
        quality: FilterQuality::Nearest,
        ..PixmapPaint::default()
    };
    frame.draw_pixmap(0, 0, image.pixmap.as_ref(), &paint, transform, clip);
    Ok(())
}

/// Opaque, axis-aligned map tiles need only nearest sampling and byte copies.
/// Keep fractional positions, transparent sprites and rotations on the general
/// compositor. Sending every floor pixel through its floating-point shader
/// pipeline stalls the same thread that receives browser input.
fn blit_opaque(
    frame: &mut Pixmap,
    image: &Image,
    rect: [f64; 4],
    flip: bool,
    clip: Option<&Mask>,
) -> bool {
    let [x, y, width, height] = rect;
    if !image.opaque
        || rect
            .iter()
            .any(|v| !v.is_finite() || v.fract() != 0. || v.abs() > i32::MAX as f64 / 2.)
        || width <= 0.
        || height <= 0.
        || width > f64::from(MAX_IMAGE_DIMENSION)
        || height > f64::from(MAX_IMAGE_DIMENSION)
    {
        return false;
    }
    let (x, y, width, height) = (x as i32, y as i32, width as u32, height as u32);
    let fw = frame.width() as usize;
    let left = x.max(0) as usize;
    let right = (x + width as i32).max(0).min(frame.width() as i32) as usize;
    let top = y.max(0) as usize;
    let bottom = (y + height as i32).max(0).min(frame.height() as i32) as usize;
    if left >= right || top >= bottom {
        return true;
    }
    let xs = (left..right)
        .map(|dx| {
            let offset = (2 * (dx as i64 - i64::from(x)) + 1) as u64;
            let offset = if flip {
                2 * u64::from(width) - offset
            } else {
                offset
            };
            (offset * u64::from(image.width) / (2 * u64::from(width))) as usize
        })
        .collect::<Vec<_>>();
    let target = frame.data_mut();
    for dy in top..bottom {
        let sy = ((2 * (dy as i64 - i64::from(y)) + 1) as u64 * u64::from(image.height)
            / (2 * u64::from(height))) as usize;
        let row = &image.rgba[sy * image.width as usize * 4..(sy + 1) * image.width as usize * 4];
        let coverage = clip.map(|mask| &mask.data()[dy * fw + left..dy * fw + right]);
        let target = &mut target[(dy * fw + left) * 4..(dy * fw + right) * 4];
        if !flip && width == image.width && coverage.is_none_or(|row| row.iter().all(|v| *v == 255))
        {
            let start = xs[0] * 4;
            target.copy_from_slice(&row[start..start + target.len()]);
            continue;
        }
        for (i, pixel) in target.chunks_exact_mut(4).enumerate() {
            let coverage = coverage.map_or(255, |row| row[i]);
            let source = &row[xs[i] * 4..xs[i] * 4 + 4];
            match coverage {
                0 => {}
                255 => pixel.copy_from_slice(source),
                coverage => {
                    for channel in 0..4 {
                        pixel[channel] = ((u32::from(source[channel]) * u32::from(coverage)
                            + u32::from(pixel[channel]) * (255 - u32::from(coverage))
                            + 127)
                            / 255) as u8;
                    }
                }
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_tile_blits_preserve_sampling_flip_clipping_and_alpha() {
        let image = Image::from_rgba(
            4,
            3,
            (0..12)
                .flat_map(|i| [i * 20, 255 - i * 10, 30, 255])
                .collect(),
        )
        .unwrap();
        for (x, y, width, height, ratio) in [
            (0., 0., 4., 3., 1.),
            (-2., -1., 12., 6., 1.),
            (1., 2., 6., 5., 1.),
            (0.5, 1.5, 8., 6., 2.),
        ] {
            for flip in [false, true] {
                let mut expected = Pixmap::new(24, 20).unwrap();
                expected.fill(tiny_skia::Color::from_rgba8(25, 50, 75, 128));
                let mut actual = expected.clone();
                let mut mask = Mask::new(24, 20).unwrap();
                for (i, v) in mask.data_mut().iter_mut().enumerate() {
                    *v = [0, 64, 128, 255][i % 4];
                }
                let sx = width * ratio / 4.;
                let sy = height * ratio / 3.;
                expected.draw_pixmap(
                    0,
                    0,
                    image.pixmap.as_ref(),
                    &PixmapPaint::default(),
                    Transform::from_row(
                        if flip { -sx as f32 } else { sx as f32 },
                        0.,
                        0.,
                        sy as f32,
                        ((x + if flip { width } else { 0. }) * ratio) as f32,
                        (y * ratio) as f32,
                    ),
                    Some(&mask),
                );
                assert!(blit_opaque(
                    &mut actual,
                    &image,
                    [x * ratio, y * ratio, width * ratio, height * ratio],
                    flip,
                    Some(&mask)
                ));
                assert!(
                    actual
                        .data()
                        .iter()
                        .zip(expected.data())
                        .all(|(a, b)| a.abs_diff(*b) <= 1),
                    "Tile pixels differ at {x},{y} {width}x{height} flip={flip}"
                );
            }
        }
        let mut target = Pixmap::new(4, 3).unwrap();
        assert!(!blit_opaque(
            &mut target,
            &image,
            [0.25, 0., 4., 3.],
            false,
            None
        ));
        let transparent = Image::from_rgba(1, 1, vec![0; 4]).unwrap();
        assert!(!blit_opaque(
            &mut target,
            &transparent,
            [0., 0., 1., 1.],
            false,
            None
        ));
    }

    #[test]
    fn sprite_flip_mirrors_native_pixels_without_changing_alpha() {
        let pixels = vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0];
        let image = Image::from_rgba(3, 1, pixels).unwrap();
        let mut set = ImageSet::new(BTreeMap::from([("actor.png".into(), image)]));
        let mut command = serde_json::json!({"image":"actor.png","rect":{"x":0,"y":0,"w":3,"h":1},"pixelArt":true});
        let original = set.rasterize(&command, 3, 1).unwrap();
        command["flipX"] = true.into();
        let mirrored = set.rasterize(&command, 3, 1).unwrap();
        assert_eq!(
            mirrored,
            original
                .chunks_exact(4)
                .rev()
                .flatten()
                .copied()
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn sprite_crop_preserves_pixels_and_alpha_across_rows() {
        let pixels = vec![
            1, 2, 3, 255, 4, 5, 6, 0, 7, 8, 9, 128, 10, 11, 12, 64, 13, 14, 15, 255, 16, 17, 18, 0,
        ];
        let sheet = Image::from_rgba(3, 2, pixels.clone()).unwrap();
        let cell = sheet.crop(1, 0, 2, 2).unwrap();
        assert_eq!((cell.width(), cell.height()), (2, 2));
        assert_eq!(
            cell.rgba(),
            &[4, 5, 6, 0, 7, 8, 9, 128, 13, 14, 15, 255, 16, 17, 18, 0]
        );
        assert_eq!(sheet.rgba(), pixels);
        assert_eq!(sheet.crop(2, 1, 1, 1).unwrap().rgba(), &[16, 17, 18, 0]);
    }

    #[test]
    fn sprite_crop_rejects_empty_outside_and_overflowing_bounds() {
        let sheet = Image::from_rgba(3, 2, vec![0; 24]).unwrap();
        for (x, y, w, h) in [
            (3, 0, 1, 1),
            (0, 2, 1, 1),
            (2, 1, 2, 1),
            (u32::MAX, 0, 2, 1),
            (0, u32::MAX, 1, 2),
        ] {
            assert_eq!(
                sheet.crop(x, y, w, h).err().as_deref(),
                Some("Sprite crop is outside its image")
            );
        }
        assert_eq!(sheet.crop(0, 0, 0, 1).err().as_deref(), Some("Empty image"));
    }

    #[test]
    fn transparent_sprite_batch_preserves_its_underlay() {
        let floor = Image::from_rgba(2, 1, vec![255, 0, 0, 255, 255, 0, 0, 255]).unwrap();
        let actor = Image::from_rgba(2, 1, vec![0, 0, 0, 0, 0, 255, 0, 255]).unwrap();
        let mut set = ImageSet::new(BTreeMap::from([
            ("floor".into(), floor),
            ("actor".into(), actor),
        ]));
        let commands = serde_json::json!([
            {"image":"floor","rect":{"x":0,"y":0,"w":2,"h":1}},
            {"image":"actor","rect":{"x":0,"y":0,"w":2,"h":1}}
        ]);
        assert_eq!(
            set.rasterize(&commands, 2, 1).unwrap(),
            [255, 0, 0, 255, 0, 255, 0, 255]
        );
    }

    #[test]
    fn oversized_png_ihdr_is_rejected_before_output_allocation() {
        for (width, height, expected) in [
            (8192, 1, "Image exceeds raster dimension limit"),
            (4096, 2048, "Image exceeds raster pixel limit"),
        ] {
            let mut bytes = Vec::new();
            {
                let mut encoder = png::Encoder::new(&mut bytes, width, height);
                encoder.set_color(png::ColorType::Rgba);
                // read_info reaches a valid oversized IHDR and an IDAT header.
                // There is no compressed pixel payload: an attempted decode
                // would fail with a different error after allocating output.
                let mut writer = encoder.write_header().unwrap();
                writer.write_chunk(png::chunk::IDAT, &[]).unwrap();
            }
            assert_eq!(Image::decode_png(&bytes).err().as_deref(), Some(expected));
            assert_eq!(
                Image::from_rgba(width, height, Vec::new()).err().as_deref(),
                Some(expected)
            );
        }
    }
}
