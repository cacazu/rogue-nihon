//! Decoded browser image handles and rotated rasters are owned by their tile set.
use super::*;
use wasm_bindgen_futures::JsFuture;
pub(super) struct Tiles {
    images: BTreeMap<String, HtmlImageElement>,
    rotated: BTreeMap<(String, i32), HtmlCanvasElement>,
}
impl Tiles {
    pub(super) async fn load(plan: &Value) -> Result<(Self, Value), JsValue> {
        let mut images = BTreeMap::new();
        let mut dimensions = Vec::new();
        // All decodes start before waiting; their Rust futures retain the image handles.
        let mut pending = Vec::new();
        let promises = js_sys::Array::new();
        for filename in plan["files"].as_array().into_iter().flatten() {
            let name = text(filename).to_string();
            let image = HtmlImageElement::new()?;
            image.set_src(&format!("{}{}", text(&plan["base"]), name));
            promises.push(&image.decode());
            pending.push((name, image));
        }
        JsFuture::from(js_sys::Promise::all(&promises)).await?;
        for (name, image) in pending {
            dimensions.push(json!({"width":image.natural_width(),"height":image.natural_height()}));
            images.insert(name, image);
        }
        Ok((
            Self {
                images,
                rotated: BTreeMap::new(),
            },
            json!(dimensions),
        ))
    }
    pub(super) fn draw(
        &mut self,
        context: &CanvasRenderingContext2d,
        command: &Value,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Result<(), JsValue> {
        let name = text(&command["image"]);
        let image = self
            .images
            .get(name)
            .ok_or_else(|| JsValue::from_str("Missing tile image"))?;
        let rotation = number(&command["rotation"]);
        if rotation != 0. && command["pixelArt"].as_bool() == Some(true) {
            let key = (name.to_string(), rotation as i32);
            if !self.rotated.contains_key(&key) {
                self.rotated
                    .insert(key.clone(), Self::pixel_rotation(image, rotation)?);
            }
            context.draw_image_with_html_canvas_element_and_dw_and_dh(
                &self.rotated[&key],
                x,
                y,
                w,
                h,
            )?;
        } else if rotation != 0. {
            context.save();
            context.translate(x + w / 2., y + h / 2.)?;
            context.rotate(rotation.to_radians())?;
            context.draw_image_with_html_image_element_and_dw_and_dh(
                image,
                -w / 2.,
                -h / 2.,
                w,
                h,
            )?;
            context.restore();
        } else {
            context.draw_image_with_html_image_element_and_dw_and_dh(image, x, y, w, h)?;
        }
        Ok(())
    }
    fn pixel_rotation(
        image: &HtmlImageElement,
        degrees: f64,
    ) -> Result<HtmlCanvasElement, JsValue> {
        let document = web_sys::window()
            .and_then(|w| w.document())
            .ok_or_else(|| JsValue::from_str("Document unavailable"))?;
        let create = || -> Result<(HtmlCanvasElement, CanvasRenderingContext2d), JsValue> {
            let canvas: HtmlCanvasElement = document.create_element("canvas")?.dyn_into()?;
            canvas.set_width(32);
            canvas.set_height(32);
            let context: CanvasRenderingContext2d = canvas
                .get_context("2d")?
                .ok_or_else(|| JsValue::from_str("Canvas unavailable"))?
                .dyn_into()?;
            Ok((canvas, context))
        };
        let (_, source) = create()?;
        let (result, context) = create()?;
        source.set_image_smoothing_enabled(false);
        source.draw_image_with_html_image_element(image, 0., 0.)?;
        let input = source.get_image_data(0., 0., 32., 32.)?.data();
        let output = rogue_display::browser_ui::pixels::rotate(&input.0, degrees)
            .map_err(JsValue::from_str)?;
        let data =
            ImageData::new_with_u8_clamped_array_and_sh(wasm_bindgen::Clamped(&output), 32, 32)?;
        context.put_image_data(&data, 0., 0.)?;
        Ok(result)
    }
}
#[cfg(feature = "browser-test")]
#[wasm_bindgen]
pub fn rotate_pixels(input: &[u8], degrees: f64) -> Result<Vec<u8>, JsValue> {
    rogue_display::browser_ui::pixels::rotate(input, degrees).map_err(JsValue::from_str)
}
/// A raster resource has one Rust owner; exported consumers receive a handle, never its cache.
#[cfg(feature = "browser-test")]
#[wasm_bindgen]
pub struct TilePainter {
    tiles: Tiles,
}
#[cfg(feature = "browser-test")]
#[wasm_bindgen]
impl TilePainter {
    pub async fn load(plan: &str) -> Result<TilePainter, JsValue> {
        let plan = serde_json::from_str(plan).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let (tiles, _) = Tiles::load(&plan).await?;
        Ok(Self { tiles })
    }
    pub fn images(&self) -> usize {
        self.tiles.images.len()
    }
    pub fn rotations(&self) -> usize {
        self.tiles.rotated.len()
    }
    pub fn draw(
        &mut self,
        context: &CanvasRenderingContext2d,
        command: &str,
    ) -> Result<(), JsValue> {
        let command: Value =
            serde_json::from_str(command).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let r = &command["rect"];
        self.tiles.draw(
            context,
            &command,
            number(&r["x"]),
            number(&r["y"]),
            number(&r["w"]),
            number(&r["h"]),
        )
    }
}
