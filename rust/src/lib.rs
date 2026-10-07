//! Original Rogue C logic connected to Rust display, input and platform layers.
//! Each game has one single-threaded Wasm instance. Browser repaint never calls C.
mod abi;
mod display;
mod entities;
mod input;
mod map_tiles;
mod platform;
mod presentation;

use abi::*;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::VecDeque;
use std::ffi::{CStr, CString, c_char};

unsafe extern "C" {
    fn rg_core_start(seed: u32, name: *const c_char) -> i32;
    fn rg_core_inspect(out: *mut u32, capacity: u32) -> u32;
    fn rg_core_save_bytes(out: *mut *mut u8, length: *mut u32) -> i32;
    fn rg_core_load_bytes(bytes: *const u8, length: u32) -> i32;
    fn rg_core_save_free(bytes: *mut u8);
    fn js_rg_read_event() -> i32;
    fn js_rg_flush_input();
    fn js_rg_present(json: *const u8, length: u32);
    fn js_rg_store(json: *const u8, length: u32);
    fn js_rg_outcome(code: i32, text: *const u8, length: u32);
}

#[derive(Default)]
struct Session {
    seed: u32,
    name: String,
    checkpoint: Vec<u8>,
    journal: Vec<i32>,
    replay: VecDeque<i32>,
    restore_checkpoint: Vec<u8>,
    input_index: u32,
    last_frame: Option<Value>,
    map_effects: Vec<(u32, u32, u8)>,
    checkpoint_error: Option<String>,
    trace_enabled: bool,
    language: String,
    presentation: presentation::Presentation,
    checkpoint_presentation: Value,
    text_mode: bool,
    text_is_name: bool,
    name_edit_changed: bool,
    text_limit: usize,
    text_bytes: Vec<u8>,
    text_pending: VecDeque<i32>,
}

thread_local! { static SESSION: RefCell<Session> = RefCell::new(Session::default()); }

fn emit(value: &Value) {
    if let Ok(bytes) = serde_json::to_vec(value)
        && let Ok(length) = u32::try_from(bytes.len())
    {
        // SAFETY: The synchronous JS import borrows this live byte slice only
        // during the call, and copies it to the browser's message transport.
        unsafe {
            js_rg_present(bytes.as_ptr(), length);
        }
    }
}

/// Resolve identity at render time so C's fixed-width alias is never displayed.
fn replace_player_names(value: &mut Value, name: &str) {
    match value {
        Value::Object(object)
            if object.get("type").and_then(Value::as_str) == Some("player_name") =>
        {
            *value = json!({"type":"literal","text":name});
        }
        Value::Object(object) => {
            for value in object.values_mut() {
                replace_player_names(value, name);
            }
        }
        Value::Array(array) => {
            for value in array {
                replace_player_names(value, name);
            }
        }
        _ => {}
    }
}

fn emit_input_context() {
    let event = SESSION.with(|session| {
        let session = session.borrow();
        if session.language != "ja" {return None;}
        Some(json!({"type":"input-context","input":session.presentation.render("ja", &session.name)["input"]}))
    });
    if let Some(event) = event {
        emit(&event);
    }
}

/// Observational UI metadata. C still owns its original logical cells.
/// # Safety
/// String pointers are readable and NUL terminated for the synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_ui(
    scope: *const c_char,
    row: i32,
    column: i32,
    id: *const c_char,
    args: *const c_char,
    fallback: *const c_char,
) {
    if [scope, id, args, fallback]
        .iter()
        .any(|pointer| pointer.is_null())
    {
        return;
    }
    // SAFETY: The ABI requires live NUL-terminated strings at all four pointers.
    let (scope, id, args, fallback) = unsafe {
        (
            CStr::from_ptr(scope),
            CStr::from_ptr(id),
            CStr::from_ptr(args),
            CStr::from_ptr(fallback),
        )
    };
    let args = serde_json::from_slice(args.to_bytes()).unwrap_or(Value::Null);
    SESSION.with(|session| {
        session.borrow_mut().presentation.update(
            &scope.to_string_lossy(),
            row,
            column,
            &id.to_string_lossy(),
            args,
            &fallback.to_string_lossy(),
        )
    });
    if row < 0 && scope.to_bytes() == b"input" {
        emit_input_context();
    }
}

/// Marks C's explicit UTF-8 string editor. General commands remain ASCII keys.
/// # Safety
/// `initial` is null or a readable NUL-terminated UTF-8 string during this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_text_mode(enabled: i32, limit: u32, initial: *const c_char) {
    let initial = if initial.is_null() {
        String::new()
    } else {
        // SAFETY: The C editor owns this live, terminated option string.
        unsafe { CStr::from_ptr(initial) }
            .to_string_lossy()
            .into_owned()
    };
    SESSION.with(|session| {
        let mut session = session.borrow_mut();
        if enabled == 0 && session.text_is_name {
            session.name_edit_changed = !session.text_bytes.is_empty();
        }
        session.text_mode = enabled != 0;
        session.text_limit = (limit as usize).min(50);
        session.text_bytes.clear();
        session.text_pending.clear();
        if enabled != 0 {
            session.text_is_name = enabled == 2;
            if session.text_is_name {
                session.name_edit_changed = false;
            }
            let initial = if enabled == 2 {
                session.name.clone()
            } else if enabled == 3 && initial == "slime-mold" {
                String::new()
            } else {
                initial
            };
            session.presentation.input = json!({"kind":"text","limit_bytes":session.text_limit,
                "initial":initial,"current_text":initial});
            if enabled == 3 && initial.is_empty() {
                session.presentation.input["placeholder"] = Value::String(
                    display::message_language(
                        "input.default_fruit",
                        &json!([]),
                        "slime-mold (default)",
                        &session.language,
                    )
                    .text,
                );
            }
        } else {
            session.presentation.input = json!({"kind":"command"});
        }
    });
    emit_input_context();
}

/// # Safety
/// `name` is a live NUL-terminated UTF-8 string from C's completed name editor.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_player_name(name: *const c_char) {
    if name.is_null() {
        return;
    }
    // SAFETY: C calls only after validating and terminating its editor buffer.
    if let Ok(name) = unsafe { CStr::from_ptr(name) }.to_str()
        && name.len() <= 50
        && !name.chars().any(char::is_control)
    {
        SESSION.with(|session| {
            let mut session = session.borrow_mut();
            // An empty Enter keeps the original name in C. Preserve the real
            // identity too when that C name is only the initial ASCII alias.
            if session.name_edit_changed {
                session.name = name.into();
            }
        });
    }
}

fn notice(text: &str) {
    let language = SESSION.with(|session| session.borrow().language.clone());
    let id = if text.contains("name") {
        "platform.name_error"
    } else if text.contains("journal limit") {
        "platform.input_limit"
    } else if text.contains("save unavailable") {
        "platform.save_error"
    } else if text.contains("save") || text.contains("checkpoint") {
        "platform.restore_error"
    } else {
        "platform.error"
    };
    let rendered = display::message_language(id, &json!([]), text, &language);
    emit(
        &json!({"type":"message","id":id,"text":rendered.text,"args":[],"fallback":text,
        "fallback_used":!rendered.missing_ids.is_empty(),"missing_ids":rendered.missing_ids}),
    );
}

fn words() -> [u32; RG_SNAPSHOT_WORDS as usize] {
    let mut snapshot = [0_u32; RG_SNAPSHOT_WORDS as usize];
    // SAFETY: C receives a writable fixed-size array and capacity from the same
    // ABI header; inspect only copies state and never updates logic or RNG.
    unsafe {
        rg_core_inspect(snapshot.as_mut_ptr(), RG_SNAPSHOT_WORDS);
    }
    snapshot
}

fn trace() {
    let enabled = SESSION.with(|session| session.borrow().trace_enabled);
    if enabled {
        let snapshot = words();
        let input_index = SESSION.with(|session| session.borrow().input_index);
        emit(&json!({"type":"trace","words":snapshot,"input_index":input_index}));
    }
}

fn bounded_name(value: &str) -> String {
    let mut end = value.len().min(49);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].replace('\0', "")
}

/// Runs the original C game in the current Worker until it exits.
///
/// # Safety
/// `name` is null or a readable NUL-terminated UTF-8 string for this call. The
/// caller must create a fresh Wasm instance for each invocation/new game.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_run(seed: u32, name: *const c_char) -> i32 {
    let name = if name.is_null() {
        "Rogue".to_owned()
    } else {
        // SAFETY: Guaranteed by the exported function's caller contract.
        bounded_name(&unsafe { CStr::from_ptr(name) }.to_string_lossy())
    };
    let language = if std::fs::read_to_string("/locale.txt")
        .ok()
        .is_some_and(|s| s.trim() == "en")
    {
        "en"
    } else {
        "ja"
    };
    SESSION.with(|state| state.borrow_mut().language = language.into());
    if name.chars().any(char::is_control) {
        notice("invalid player name");
        return -2;
    }
    let mut session = Session {
        seed,
        name,
        language: language.into(),
        ..Session::default()
    };
    session.trace_enabled = std::fs::metadata("/trace.enabled").is_ok();
    match std::fs::read("/restore.json") {
        Ok(bytes) => match platform::Envelope::parse(&bytes) {
            Ok(saved) => match saved.checkpoint() {
                Ok(checkpoint) => {
                    session.seed = saved.seed;
                    session.name = saved.name;
                    session.input_index = saved.input_index - saved.inputs.len() as u32;
                    session.restore_checkpoint = checkpoint;
                    session.replay = saved.inputs.into();
                    if !saved.presentation.is_null() {
                        match serde_json::from_value(saved.presentation) {
                            Ok(presentation) => session.presentation = presentation,
                            Err(_) => {
                                notice("invalid saved presentation");
                                return -2;
                            }
                        }
                    }
                }
                Err(error) => {
                    notice(&error);
                    return -2;
                }
            },
            Err(error) => {
                notice(&error);
                return -2;
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            notice(&format!("save read failed: {error}"));
            return -2;
        }
    }
    let initial_seed = session.seed;
    // The real UTF-8 identity is owned by Rust. The original fixed-cell C name
    // has an ASCII alias until the user explicitly changes it in the editor.
    let c_name = if session.name.is_ascii() {
        session.name.clone()
    } else {
        "Player".into()
    };
    let name = match CString::new(c_name.as_bytes()) {
        Ok(name) => name,
        Err(_) => return -2,
    };
    SESSION.with(|state| *state.borrow_mut() = session);
    // SAFETY: CString remains live until C returns. All callbacks use the same
    // single-threaded module and hold no RefCell borrow across a call into C.
    unsafe { rg_core_start(initial_seed, name.as_ptr()) }
}

/// Returns one original game key, consuming raw browser events in Rust.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_read_key() -> i32 {
    trace();
    loop {
        let pending = SESSION.with(|session| session.borrow_mut().text_pending.pop_front());
        let replay = if pending.is_none() {
            SESSION.with(|session| session.borrow_mut().replay.pop_front())
        } else {
            None
        };
        let key = if let Some(key) = pending.or(replay) {
            key
        } else {
            // SAFETY: Synchronous host import waits on the Worker's SAB queue;
            // it does not re-enter Wasm or execute a game update.
            let raw = unsafe { js_rg_read_event() } as u32;
            let scalar = raw & RG_EVENT_SCALAR_MASK;
            let text_key = SESSION.with(|state| {
                let mut state = state.borrow_mut();
                // The knowledge adapter reports erasechar() == 8. Browser
                // Backspace/DEL must become that C editor key before journaling.
                if state.text_mode && scalar == 127 && raw & RG_EVENT_ALT == 0 {
                    return Some(8);
                }
                if state.text_mode
                    && scalar > 127
                    && scalar <= 0x10ffff
                    && raw & (RG_EVENT_CTRL | RG_EVENT_ALT) == 0
                {
                    if let Some(character) = char::from_u32(scalar).filter(|c| !c.is_control()) {
                        let mut buffer = [0_u8; 4];
                        let bytes = character.encode_utf8(&mut buffer).as_bytes();
                        if state.text_bytes.len() + bytes.len() <= state.text_limit {
                            state
                                .text_pending
                                .extend(bytes.iter().skip(1).map(|b| i32::from(*b)));
                            return Some(i32::from(bytes[0]));
                        }
                    }
                    return Some(-2);
                }
                None
            });
            if text_key == Some(-2) {
                continue;
            }
            if let Some(key) = text_key {
                key
            } else {
                match input::decode(raw) {
                    input::Input::Key(key) => key,
                    input::Input::Save => {
                        persist();
                        continue;
                    }
                    input::Input::End => return -1,
                    input::Input::Ignore => continue,
                }
            }
        };
        let accepted = SESSION.with(|session| {
            let mut session = session.borrow_mut();
            if session.journal.len() >= platform::MAX_INPUTS {
                return false;
            }
            session.journal.push(key);
            session.input_index = session.input_index.wrapping_add(1);
            if session.text_mode {
                match key {
                    21 => session.text_bytes.clear(),
                    8 | 127 => {
                        if let Some(last) = session.text_bytes.pop()
                            && last & 0xc0 == 0x80
                        {
                            while session.text_bytes.last().is_some_and(|b| b & 0xc0 == 0x80) {
                                session.text_bytes.pop();
                            }
                            session.text_bytes.pop();
                        }
                    }
                    32..=255 if session.text_bytes.len() < session.text_limit => {
                        session.text_bytes.push(key as u8)
                    }
                    _ => {}
                }
                if let Ok(text) = String::from_utf8(session.text_bytes.clone()) {
                    session.presentation.input["current_text"] = Value::String(text);
                }
            }
            true
        });
        if !accepted {
            notice("input journal limit reached; restart from a safe checkpoint");
            return -1;
        }
        emit_input_context();
        return key;
    }
}

/// Discards browser typeahead; semantic replay records already consumed in the
/// original session remain intact and are not pending keyboard events.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_flush_input() {
    // SAFETY: Host import only advances its raw SAB read counter. It does not
    // re-enter Wasm or mutate the recorded semantic input journal.
    unsafe {
        js_rg_flush_input();
    }
}

/// Presents a copy of C's knowledge/view buffer without invoking look or RNG.
///
/// # Safety
/// `cells` points to `rows * columns` bytes for this synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_present(cells: *const u8, rows: u32, columns: u32) {
    let Some(length) = rows.checked_mul(columns).filter(|length| *length <= 4096) else {
        return;
    };
    if cells.is_null() {
        return;
    }
    // SAFETY: C's callback guarantees the bounded borrowed cell slice.
    let cells = unsafe { std::slice::from_raw_parts(cells, length as usize) };
    let cells: String = cells
        .iter()
        .map(|&byte| {
            if byte.is_ascii_graphic() || byte == b' ' {
                char::from(byte)
            } else {
                ' '
            }
        })
        .collect();
    let snapshot = words();
    let value = json!({"type":"frame","width":columns,"height":rows,"cells":cells,
        "player":{"x":snapshot[RG_SNAPSHOT_X as usize],"y":snapshot[RG_SNAPSHOT_Y as usize]},
        "stats":{"hp":snapshot[RG_SNAPSHOT_HP as usize],"max_hp":snapshot[RG_SNAPSHOT_MAX_HP as usize],
        "gold":snapshot[RG_SNAPSHOT_GOLD as usize],"level":snapshot[RG_SNAPSHOT_LEVEL as usize],
        "food":snapshot[RG_SNAPSHOT_FOOD as usize],"strength":snapshot[RG_SNAPSHOT_STRENGTH as usize],
        "armor":snapshot[RG_SNAPSHOT_ARMOR as usize],"experience":snapshot[RG_SNAPSHOT_EXPERIENCE as usize],
        "turn":snapshot[RG_SNAPSHOT_TURN as usize]}});
    let mut value = value;
    SESSION.with(|session| {
        let session = session.borrow();
        {
            let ui = session
                .presentation
                .render(&session.language, &session.name);
            let mut map = cells.as_bytes().to_vec();
            if ui["mode"] != "game" {
                map.fill(b' ');
            } else {
                for row in [0, rows.saturating_sub(1)] {
                    let start = row as usize * columns as usize;
                    map[start..start + columns as usize].fill(b' ');
                }
            }
            let (tiles, unknown) = map_tiles::map(&map, columns, rows, &session.map_effects);
            value["map_tiles"] = json!(tiles);
            value["map_tile_ids"] = json!(&map_tiles::IDS[..]);
            value["map_unknown_glyphs"] = json!(unknown);
            value["map_cells"] = Value::String(String::from_utf8(map).unwrap_or_default());
            value["ui"] = ui;
        }
    });
    SESSION.with(|session| session.borrow_mut().last_frame = Some(value.clone()));
    emit(&value);
}

/// Tags a bolt that C has already drawn, without looking up hidden terrain.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_map_effect(x: i32, y: i32, glyph: i32, active: i32) {
    SESSION.with(|state| {
        let mut state = state.borrow_mut();
        if active == 0 {
            state.map_effects.clear();
            return;
        }
        let (Ok(x), Ok(y), Ok(glyph)) = (u32::try_from(x), u32::try_from(y), u8::try_from(glyph))
        else {
            return;
        };
        if x >= 80 || y >= 24 || map_tiles::bolt(glyph).is_none() {
            return;
        }
        if let Some(effect) = state
            .map_effects
            .iter_mut()
            .find(|effect| effect.0 == x && effect.1 == y)
        {
            effect.2 = glyph;
        } else if state.map_effects.len() < 6 {
            state.map_effects.push((x, y, glyph));
        }
    });
}

/// Emits semantic message IDs and typed arguments to Rust presentation.
///
/// # Safety
/// All three pointers are readable, NUL-terminated strings for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_message(
    id: *const c_char,
    args: *const c_char,
    fallback: *const c_char,
) {
    if id.is_null() || args.is_null() || fallback.is_null() {
        return;
    }
    // SAFETY: C owns the three live NUL-terminated buffers under the ABI.
    let id = unsafe { CStr::from_ptr(id) }.to_string_lossy();
    // SAFETY: Same caller-owned lifetime and termination contract as id.
    let args = unsafe { CStr::from_ptr(args) }.to_string_lossy();
    // SAFETY: Same caller-owned lifetime and termination contract as id.
    let fallback = unsafe { CStr::from_ptr(fallback) }.to_string_lossy();
    let mut arguments: Value = serde_json::from_str(&args).unwrap_or(Value::Null);
    let language = SESSION.with(|session| {
        let session = session.borrow();
        session.presentation.resolve_recall(&id, &mut arguments);
        session.language.clone()
    });
    let mut rendered_arguments = arguments.clone();
    SESSION.with(|session| replace_player_names(&mut rendered_arguments, &session.borrow().name));
    let text = display::message_language(&id, &rendered_arguments, &fallback, &language);
    let event = json!({"type":"message","id":id,"text":text.text,"args":arguments,"fallback":fallback,
        "fallback_used":!text.missing_ids.is_empty(),"missing_ids":text.missing_ids});
    SESSION.with(|session| session.borrow_mut().presentation.remember(event.clone()));
    emit(&event);
}

/// C's safe outer-command boundary: capture state, then start a fresh journal.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_checkpoint() {
    let mut pointer = std::ptr::null_mut();
    let mut length = 0_u32;
    // SAFETY: C writes the owned allocation pointer/length; no Session borrow is
    // active while the serializer runs. Only C's matching allocator frees it.
    let result = unsafe { rg_core_save_bytes(&mut pointer, &mut length) };
    if result == 0
        && !pointer.is_null()
        && length > 0
        && length as usize <= platform::MAX_CHECKPOINT
    {
        // SAFETY: A successful serializer returns length readable owned bytes.
        let bytes = unsafe { std::slice::from_raw_parts(pointer, length as usize) }.to_vec();
        // SAFETY: Pointer was allocated by C save_bytes and is freed once.
        unsafe {
            rg_core_save_free(pointer);
        }
        SESSION.with(|session| {
            let mut session = session.borrow_mut();
            session.checkpoint = bytes;
            session.journal.clear();
            session.checkpoint_error = None;
            session.checkpoint_presentation =
                serde_json::to_value(&session.presentation).unwrap_or(Value::Null);
        });
    } else {
        if !pointer.is_null() {
            // SAFETY: The save API owns any non-null output allocation even on failure.
            unsafe {
                rg_core_save_free(pointer);
            }
        }
        SESSION.with(|session| {
            session.borrow_mut().checkpoint_error =
                Some(format!("checkpoint capture failed ({result})"))
        });
    }
}

/// Supplies an immutable restore checkpoint to C during startup.
///
/// # Safety
/// Output pointers are writable. The returned byte pointer is borrowed until
/// `rg_core_start` returns; C must not free or modify it.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_restore_data(out: *mut *const u8, length: *mut u32) -> i32 {
    if out.is_null() || length.is_null() {
        return -1;
    }
    SESSION.with(|session| {
        let session = session.borrow();
        if session.restore_checkpoint.is_empty() {
            return 0;
        }
        // SAFETY: Caller provides valid outputs. Session's Vec allocation is not
        // modified while C runs; checkpoint callbacks use a distinct Vec.
        unsafe {
            *out = session.restore_checkpoint.as_ptr();
            *length = session.restore_checkpoint.len() as u32;
        }
        1
    })
}

/// Reports a game outcome after C has completed its state updates.
///
/// # Safety
/// `message` is null or a readable NUL-terminated string during this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_outcome(code: i32, message: *const c_char) {
    let text = if message.is_null() {
        "".into()
    } else {
        // SAFETY: C callback owns the live NUL-terminated message buffer.
        unsafe { CStr::from_ptr(message) }.to_string_lossy()
    };
    let language = SESSION.with(|session| session.borrow().language.clone());
    let id = match text.as_ref() {
        "input ended" => "outcome.input_ended",
        "quit" => "outcome.quit",
        "died" => "outcome.died",
        "won" => "outcome.won",
        "invalid game state" => "outcome.invalid_state",
        "invalid restore checkpoint" | "restore unavailable" => "outcome.restore_error",
        "knowledge allocation failed" | "scratch allocation failed" => "outcome.allocation_error",
        _ if code == 2 => "outcome.won",
        _ => "outcome.ended",
    };
    let translated = display::message_language(id, &json!([]), &text, &language).text;
    if code >= 0 && language == "ja" {
        let ui = SESSION.with(|session| {
            let mut session = session.borrow_mut();
            session
                .presentation
                .lines
                .retain(|line| line["id"] != "ui.ending.return" && line["scope"] != "more");
            session.presentation.input = json!({"kind":"ended"});
            session.presentation.last_message = None;
            let ui = session.presentation.render("ja", &session.name);
            if let Some(frame) = &mut session.last_frame {
                frame["ui"] = ui.clone();
            }
            ui
        });
        // This updates presentation only, without inventing another C frame,
        // input read, turn, or RNG event after the game has exited.
        emit(&json!({"type":"presentation","ui":ui}));
    }
    // SAFETY: The synchronous host callback copies the borrowed text bytes.
    unsafe {
        js_rg_outcome(code, translated.as_ptr(), translated.len() as u32);
    }
}

fn persist() {
    let value = SESSION.with(|session| {
        let session = session.borrow();
        if let Some(error) = &session.checkpoint_error {
            return Err(error.clone());
        }
        platform::Envelope::new_with_presentation(
            session.seed,
            session.name.clone(),
            &session.checkpoint,
            session.journal.clone(),
            session.input_index,
            if session.language == "ja"
                || session.name.len() > 49
                || session.journal.iter().any(|key| *key > 127)
            {
                session.checkpoint_presentation.clone()
            } else {
                Value::Null
            },
        )
    });
    match value.and_then(|value| value.bytes()) {
        Ok(bytes) => {
            // SAFETY: JS copies the envelope and acknowledges IndexedDB success
            // asynchronously; handing bytes to JS alone does not claim durability.
            unsafe {
                js_rg_store(bytes.as_ptr(), bytes.len() as u32);
            }
        }
        Err(error) => notice(&format!("save unavailable: {error}")),
    }
}

/// Repaints only the already captured Rust frame. Used by regression tests.
#[unsafe(no_mangle)]
pub extern "C" fn rg_test_repaint() {
    let frame = SESSION.with(|session| session.borrow().last_frame.clone());
    if let Some(frame) = frame {
        emit(&frame);
    }
}

/// Copies an inspect snapshot to an allocated NUL-terminated JSON string.
/// Caller frees the returned buffer with `rg_string_free`.
#[unsafe(no_mangle)]
pub extern "C" fn rg_snapshot_json() -> *mut c_char {
    match serde_json::to_string(&words())
        .ok()
        .and_then(|value| CString::new(value).ok())
    {
        Some(value) => value.into_raw(),
        None => std::ptr::null_mut(),
    }
}

/// # Safety
/// `pointer` is null or an unfreed pointer returned by `rg_snapshot_json`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_string_free(pointer: *mut c_char) {
    if !pointer.is_null() {
        // SAFETY: Matching CString allocator; ownership is returned exactly once.
        drop(unsafe { CString::from_raw(pointer) });
    }
}

/// Validates an envelope without starting or mutating a game.
/// # Safety
/// `bytes` points to `length` readable bytes during this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_validate_envelope(bytes: *const u8, length: u32) -> i32 {
    if bytes.is_null() || length as usize > platform::MAX_ENVELOPE {
        return -1;
    }
    // SAFETY: Caller promises a readable, bounded borrowed slice.
    let bytes = unsafe { std::slice::from_raw_parts(bytes, length as usize) };
    match platform::Envelope::parse(bytes) {
        Ok(_) => 0,
        Err(_) => -1,
    }
}

/// Test-only roundtrip interface; a complete command boundary is required.
#[unsafe(no_mangle)]
pub extern "C" fn rg_test_save_roundtrip() -> i32 {
    let before = words();
    let mut pointer = std::ptr::null_mut();
    let mut length = 0_u32;
    // SAFETY: No callback/Session borrow is held. C API owns outputs.
    let result = unsafe { rg_core_save_bytes(&mut pointer, &mut length) };
    if result != 0 || pointer.is_null() {
        return -1;
    }
    // SAFETY: C-provided save buffer remains alive during load.
    let loaded = unsafe { rg_core_load_bytes(pointer, length) };
    // SAFETY: Matching C allocator, exactly one free after load finishes.
    unsafe {
        rg_core_save_free(pointer);
    }
    if loaded != 0 || words() != before {
        -1
    } else {
        0
    }
}
