//! PNG bytes and decoded RGBA rasters are owned and transformed in Rust.
use super::*;
use rogue_raster::{Image, ImageSet};
use wasm_bindgen_futures::{JsFuture, future_to_promise};
pub(super) type Tiles = ImageSet;
pub(super) async fn load(plan: &Value) -> Result<(Tiles, Value), JsValue> {
    let files: Vec<_> = plan["files"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|name| text(name).to_string())
        .collect();
    let requests = js_sys::Array::new();
    for name in &files {
        let url = format!("{}{}", text(&plan["base"]), name);
        requests.push(&future_to_promise(async move {
            let bytes = fetch_bytes(&url).await?;
            Ok(js_sys::Uint8Array::from(bytes.as_slice()).into())
        }));
    }
    let downloaded = js_sys::Array::from(&JsFuture::from(js_sys::Promise::all(&requests)).await?);
    let mut images = BTreeMap::new();
    let mut dimensions = Vec::new();
    for (index, name) in files.into_iter().enumerate() {
        let bytes = js_sys::Uint8Array::new(&downloaded.get(index as u32)).to_vec();
        let image = Image::decode_png(&bytes).map_err(|e| JsValue::from_str(&e))?;
        dimensions.push(json!({"width":image.width(),"height":image.height()}));
        images.insert(name, image);
    }
    Ok((ImageSet::new(images), json!(dimensions)))
}
#[cfg(feature = "browser-test")]
#[wasm_bindgen]
pub fn rotate_pixels(input: &[u8], degrees: f64) -> Result<Vec<u8>, JsValue> {
    rogue_display::browser_ui::pixels::rotate(input, degrees).map_err(JsValue::from_str)
}
/// Test consumers receive copied RGBA bytes, never browser image or cache handles.
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
        let (tiles, _) = load(&plan).await?;
        Ok(Self { tiles })
    }
    pub fn images(&self) -> usize {
        self.tiles.images()
    }
    pub fn rotations(&self) -> usize {
        self.tiles.rotations()
    }
    pub fn rasterize(
        &mut self,
        command: &str,
        width: u32,
        height: u32,
    ) -> Result<Vec<u8>, JsValue> {
        let command: Value =
            serde_json::from_str(command).map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.tiles
            .rasterize(&command, width, height)
            .map_err(|e| JsValue::from_str(&e))
    }
}
