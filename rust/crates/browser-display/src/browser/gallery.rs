//! Asset previews share the Rust PNG decoder and transfer complete RGBA frames only.
use super::*;
use rogue_raster::Image;

thread_local! {
    static GALLERY: RefCell<Option<Rc<Gallery>>> = const { RefCell::new(None) };
}

struct View {
    canvas: HtmlCanvasElement,
    context: CanvasRenderingContext2d,
    frames: Vec<Vec<u8>>,
    duration: f64,
    displayed: Cell<Option<usize>>,
}

struct Gallery {
    window: Window,
    play: HtmlButtonElement,
    selection: HtmlSelectElement,
    views: Vec<View>,
    playing: Cell<bool>,
    paused_at: Cell<f64>,
    offset: Cell<f64>,
    frame_id: Cell<Option<i32>>,
    callback: RefCell<Option<AnimationCallback>>,
    listeners: RefCell<Vec<Listener>>,
}

impl Drop for Gallery {
    fn drop(&mut self) {
        if let Some(id) = self.frame_id.take() {
            let _ = self.window.cancel_animation_frame(id);
        }
    }
}

pub(super) fn start(document: Document) -> Result<(), JsValue> {
    let window = document
        .default_view()
        .ok_or_else(|| JsValue::from_str("Gallery window unavailable"))?;
    wasm_bindgen_futures::spawn_local(async move {
        if let Err(failure) = load(window, &document).await {
            if let Some(summary) = document.get_element_by_id("summary") {
                summary.set_text_content(Some("画像の読み込みに失敗しました。"));
            }
            if let Some(root) = document.document_element() {
                let _ = root.set_attribute("data-error", "true");
            }
            error(failure);
        }
    });
    Ok(())
}

fn element(document: &Document, name: &str, content: &str) -> Result<Element, JsValue> {
    let result = document.create_element(name)?;
    result.set_text_content(Some(content));
    Ok(result)
}

fn target(document: &Document, id: &str) -> Result<Element, JsValue> {
    document
        .get_element_by_id(id)
        .ok_or_else(|| JsValue::from_str(id))
}

fn canvas(
    document: &Document,
    width: u32,
    height: u32,
    label: &str,
) -> Result<(HtmlCanvasElement, CanvasRenderingContext2d), JsValue> {
    let canvas: HtmlCanvasElement = document.create_element("canvas")?.dyn_into()?;
    canvas.set_width(width);
    canvas.set_height(height);
    canvas.set_attribute("role", "img")?;
    canvas.set_attribute("aria-label", label)?;
    let context = canvas
        .get_context("2d")?
        .ok_or_else(|| JsValue::from_str("Gallery Canvas unavailable"))?
        .dyn_into()?;
    Ok((canvas, context))
}

fn present(
    context: &CanvasRenderingContext2d,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<(), JsValue> {
    let frame =
        ImageData::new_with_u8_clamped_array_and_sh(wasm_bindgen::Clamped(rgba), width, height)?;
    context.put_image_data(&frame, 0., 0.)
}

async fn image(base: &str, filename: &str) -> Result<Image, JsValue> {
    let path = asset_path(base, filename)?;
    let bytes = super::fetch_bytes(&path).await?;
    Image::decode_png(&bytes).map_err(|message| JsValue::from_str(&message))
}

// Gallery manifests contain repository asset paths, not arbitrary URLs. The
// browser supplies only the page pathname; Rust resolves manifest/image paths.
fn asset_path(base: &str, reference: &str) -> Result<String, JsValue> {
    if !base.starts_with('/')
        || base.starts_with("//")
        || reference.is_empty()
        || reference.starts_with("//")
        || !reference
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"/._-".contains(&byte))
    {
        return Err(JsValue::from_str("Invalid gallery asset path"));
    }
    let directory = if reference.starts_with('/') {
        ""
    } else {
        base.rsplit_once('/')
            .ok_or_else(|| JsValue::from_str("Gallery base directory unavailable"))?
            .0
    };
    let mut segments = Vec::new();
    for segment in directory.split('/').chain(reference.split('/')) {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            segment => segments.push(segment),
        }
    }
    Ok(format!("/{}", segments.join("/")))
}

fn frames(image: &Image, tile: u32, row: u32) -> Result<Vec<Vec<u8>>, JsValue> {
    if image.width() != tile * 3 || image.height() != tile * 4 {
        return Err(JsValue::from_str(
            "Gallery sheet dimensions do not match manifest",
        ));
    }
    let row_bytes = tile as usize * 4;
    let mut result = Vec::with_capacity(3);
    for column in 0..3 {
        let mut output = vec![0; row_bytes * tile as usize];
        for y in 0..tile {
            let start = (((row * tile + y) * image.width() + column * tile) * 4) as usize;
            let input = image
                .rgba()
                .get(start..start + row_bytes)
                .ok_or_else(|| JsValue::from_str("Gallery sheet pixels unavailable"))?;
            let output_start = y as usize * row_bytes;
            output[output_start..output_start + row_bytes].copy_from_slice(input);
        }
        result.push(output);
    }
    Ok(result)
}

async fn load(window: Window, document: &Document) -> Result<(), JsValue> {
    let specification = document
        .body()
        .and_then(|body| body.get_attribute("data-rogue-gallery"))
        .ok_or_else(|| JsValue::from_str("Gallery manifest unavailable"))?;
    let path = asset_path(&window.location().pathname()?, &specification)?;
    let manifest: Value = serde_json::from_slice(&super::fetch_bytes(&path).await?)
        .map_err(|failure| JsValue::from_str(&failure.to_string()))?;
    let tile = manifest["tile_pixels"]
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .filter(|size| *size > 0 && *size <= 4096)
        .ok_or_else(|| JsValue::from_str("Invalid gallery tile size"))?;
    let entries = manifest["entries"]
        .as_array()
        .ok_or_else(|| JsValue::from_str("Gallery entries unavailable"))?;
    let container = target(document, "characters")?;
    container.set_text_content(None);
    let mut views = Vec::new();
    for entry in entries {
        let label = text(&entry["labels"]["ja"]);
        let article = element(document, "article", "")?;
        article.set_attribute("data-id", text(&entry["id"]))?;
        article.append_child(
            &element(
                document,
                "h2",
                &format!("{} · {label}", text(&entry["glyph"])),
            )?
            .into(),
        )?;
        let group = element(document, "div", "")?;
        group.set_class_name("states");
        article.append_child(&group)?;
        let reference = element(document, "figure", "")?;
        let original = image(&path, text(&entry["source"]["image"])).await?;
        let (original_canvas, original_context) = canvas(
            document,
            original.width(),
            original.height(),
            &format!("{label} 元画像"),
        )?;
        original_canvas.set_class_name("reference");
        present(
            &original_context,
            original.width(),
            original.height(),
            original.rgba(),
        )?;
        reference.append_child(&original_canvas)?;
        reference.append_child(&element(document, "figcaption", "元画像")?.into())?;
        group.append_child(&reference)?;
        let sheet = image(&path, text(&entry["sheet"])).await?;
        for (row, (state, title)) in [
            ("idle", "待機"),
            ("move", "移動"),
            ("attack", "攻撃"),
            ("hurt", "被ダメージ"),
        ]
        .into_iter()
        .enumerate()
        {
            let figure = element(document, "figure", "")?;
            let (canvas, context) = canvas(document, tile, tile, &format!("{label} {title}"))?;
            canvas.set_attribute("data-state", state)?;
            figure.append_child(&canvas)?;
            figure.append_child(&element(document, "figcaption", title)?.into())?;
            group.append_child(&figure)?;
            let duration = manifest_duration(&entry["animations"][state]["frame_ms"])?;
            views.push(View {
                canvas,
                context,
                frames: frames(&sheet, tile, row as u32)?,
                duration,
                displayed: Cell::new(None),
            });
        }
        let details = element(document, "details", "")?;
        details.append_child(&element(document, "summary", "12コマのシート")?.into())?;
        let (sheet_canvas, sheet_context) = canvas(
            document,
            sheet.width(),
            sheet.height(),
            &format!("{label} 全12コマ"),
        )?;
        sheet_canvas.set_class_name("sheet");
        present(&sheet_context, sheet.width(), sheet.height(), sheet.rgba())?;
        details.append_child(&sheet_canvas)?;
        article.append_child(&details)?;
        container.append_child(&article)?;
    }
    target(document, "summary")?.set_text_content(Some(&format!(
        "{}キャラクター × 4状態 × 3コマ = {}枚",
        entries.len(),
        entries.len() * 12,
    )));
    let gallery = Rc::new(Gallery {
        window,
        play: target(document, "play")?.dyn_into()?,
        selection: target(document, "frame")?.dyn_into()?,
        views,
        playing: Cell::new(true),
        paused_at: Cell::new(0.),
        offset: Cell::new(js_sys::Date::now()),
        frame_id: Cell::new(None),
        callback: RefCell::new(None),
        listeners: RefCell::new(Vec::new()),
    });
    gallery.install()?;
    gallery.render()?;
    GALLERY.with(|slot| *slot.borrow_mut() = Some(gallery));
    document
        .document_element()
        .ok_or_else(|| JsValue::from_str("Gallery root unavailable"))?
        .set_attribute("data-ready", "true")
}

fn manifest_duration(value: &Value) -> Result<f64, JsValue> {
    value
        .as_f64()
        .filter(|duration| duration.is_finite() && *duration > 0.)
        .ok_or_else(|| JsValue::from_str("Invalid gallery frame duration"))
}

impl Gallery {
    fn install(self: &Rc<Self>) -> Result<(), JsValue> {
        let weak = Rc::downgrade(self);
        let callback = Closure::new(move |_: f64| {
            if let Some(gallery) = weak.upgrade() {
                gallery.frame_id.set(None);
                if let Err(failure) = gallery.render() {
                    error(failure);
                }
            }
        });
        *self.callback.borrow_mut() = Some(callback);
        self.listen(self.play.clone().into(), "click", |gallery| {
            let now = js_sys::Date::now();
            let playing = !gallery.playing.get();
            gallery.playing.set(playing);
            if playing {
                gallery
                    .offset
                    .set(gallery.offset.get() + now - gallery.paused_at.get());
            } else {
                gallery.paused_at.set(now);
            }
            gallery
                .play
                .set_text_content(Some(if playing { "一時停止" } else { "再生" }));
            gallery.render()
        })?;
        self.listen(self.selection.clone().into(), "change", Self::render)
    }

    fn listen(
        self: &Rc<Self>,
        target: EventTarget,
        name: &str,
        action: fn(&Gallery) -> Result<(), JsValue>,
    ) -> Result<(), JsValue> {
        let weak = Rc::downgrade(self);
        let callback = Closure::new(move |_: Event| {
            if let Some(gallery) = weak.upgrade()
                && let Err(failure) = action(&gallery)
            {
                error(failure);
            }
        });
        target.add_event_listener_with_callback(name, callback.as_ref().unchecked_ref())?;
        self.listeners.borrow_mut().push(Listener {
            target,
            name: name.to_string(),
            capture: false,
            callback,
        });
        Ok(())
    }

    fn render(&self) -> Result<(), JsValue> {
        if let Some(id) = self.frame_id.take() {
            self.window.cancel_animation_frame(id)?;
        }
        let value = self.selection.value();
        let selected = if value == "auto" {
            None
        } else {
            Some(
                value
                    .parse::<usize>()
                    .ok()
                    .filter(|frame| *frame < 3)
                    .ok_or_else(|| JsValue::from_str("Invalid gallery frame selection"))?,
            )
        };
        let now = if self.playing.get() {
            js_sys::Date::now()
        } else {
            self.paused_at.get()
        };
        for view in &self.views {
            let index = selected.unwrap_or_else(|| {
                (((now - self.offset.get()).max(0.) / view.duration).floor() as usize)
                    % view.frames.len()
            });
            if view.displayed.get() != Some(index) {
                present(
                    &view.context,
                    view.canvas.width(),
                    view.canvas.height(),
                    &view.frames[index],
                )?;
                view.canvas
                    .set_attribute("data-frame", &index.to_string())?;
                view.displayed.set(Some(index));
            }
        }
        if self.playing.get() && selected.is_none() {
            let callback = self.callback.borrow();
            let callback = callback
                .as_ref()
                .ok_or_else(|| JsValue::from_str("Gallery animation callback unavailable"))?;
            self.frame_id
                .set(Some(self.window.request_animation_frame(
                    callback.as_ref().unchecked_ref(),
                )?));
        }
        Ok(())
    }
}
