//! PNG bytes and decoded RGBA rasters are owned and transformed in Rust.
use super::*;
use rogue_raster::{Image, ImageSet};
use std::{future::Future, task::Poll};
pub(super) type Tiles = ImageSet;
pub(super) async fn load(plan: &Value) -> Result<(Tiles, Value), JsValue> {
    let files: Vec<_> = plan["files"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|name| text(name).to_string())
        .collect();
    let mut requests: Vec<_> = files
        .iter()
        .map(|name| {
            let url = format!("{}{}", text(&plan["base"]), name);
            Some(Box::pin(async move { fetch_bytes(&url).await }))
        })
        .collect();
    let mut downloaded: Vec<Option<Vec<u8>>> = vec![None; requests.len()];
    let downloaded = std::future::poll_fn(move |context| {
        for (index, request) in requests.iter_mut().enumerate() {
            if let Some(future) = request {
                match future.as_mut().poll(context) {
                    Poll::Ready(Ok(bytes)) => {
                        downloaded[index] = Some(bytes);
                        *request = None;
                    }
                    Poll::Ready(Err(failure)) => return Poll::Ready(Err(failure)),
                    Poll::Pending => {}
                }
            }
        }
        if requests.iter().all(Option::is_none) {
            Poll::Ready(Ok(downloaded
                .iter_mut()
                .map(|bytes| bytes.take().unwrap())
                .collect::<Vec<_>>()))
        } else {
            Poll::Pending
        }
    })
    .await?;
    let mut images = BTreeMap::new();
    let mut dimensions = Vec::new();
    for (name, bytes) in files.into_iter().zip(downloaded) {
        let image = Image::decode_png(&bytes).map_err(|e| values::string(&e))?;
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
