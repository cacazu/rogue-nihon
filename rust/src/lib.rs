//! Original Rogue C logic connected to Bevy display, input and platform plugins.
//! Each game has one single-threaded Wasm instance. Browser repaint never calls C.
mod engine;
mod session;

use abi::*;
use rogue_contract as abi;
use rogue_display::{display, identity::replace_player_names};
use rogue_input::{self as input, inventory};
use rogue_platform as platform;
use serde_json::{Value, json};
use session::Session;
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

fn emit_input_context() {
    let ui = engine::render_ui();
    emit(&json!({"type":"input-context","input":ui["input"]}));
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
    engine::with_session_mut(|session| {
        session.display.presentation.update(
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
    engine::with_session_mut(|session| {
        if enabled == 0 && session.input.text_is_name {
            session.input.name_edit_changed = !session.input.text_bytes.is_empty();
        }
        session.input.text_mode = enabled != 0;
        session.input.text_limit = (limit as usize).min(50);
        session.input.text_bytes.clear();
        session.input.text_pending.clear();
        if enabled != 0 {
            session.input.text_is_name = enabled == 2;
            if session.input.text_is_name {
                session.input.name_edit_changed = false;
            }
            let initial = if enabled == 2 {
                session.name.clone()
            } else if enabled == 3 && initial == "slime-mold" {
                String::new()
            } else {
                initial
            };
            let row = session
                .display
                .presentation
                .lines
                .iter()
                .rev()
                .find(|line| line["scope"] == "options")
                .map(|line| line["row"].clone());
            session.display.presentation.input = json!({"kind":"text","limit_bytes":session.input.text_limit,
                "initial":initial,"current_text":initial,"row":row});
            if enabled == 3 && initial.is_empty() {
                session.display.presentation.input["placeholder"] = Value::String(
                    display::message_language(
                        "input.default_fruit",
                        &json!([]),
                        "slime-mold (default)",
                        &session.display.language,
                    )
                    .text,
                );
            }
        } else {
            session.display.presentation.input = json!({"kind":"command"});
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
        engine::with_session_mut(|session| {
            // An empty Enter keeps the original name in C. Preserve the real
            // identity too when that C name is only the initial ASCII alias.
            if session.input.name_edit_changed {
                session.name = name.into();
            }
        });
    }
}

fn notice(text: &str) {
    let language = engine::with_session(|session| session.display.language.clone());
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
    let enabled = engine::with_session(|session| session.trace_enabled);
    if enabled {
        let snapshot = words();
        let input_index = engine::with_session(|session| session.input_index);
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
    engine::with_session_mut(|state| state.display.language = language.into());
    if name.chars().any(char::is_control) {
        notice("invalid player name");
        return -2;
    }
    let mut session = Session {
        platform: platform::Session {
            seed,
            name,
            ..platform::Session::default()
        },
        display: rogue_display::DisplayState {
            language: language.into(),
            ..Default::default()
        },
        ..Session::default()
    };
    session.trace_enabled = std::fs::metadata("/trace.enabled").is_ok();
    if std::fs::read_to_string("/message-paging.txt")
        .ok()
        .is_some_and(|text| text.trim() == "log")
    {
        session.message_paging = platform::MessagePaging::Log;
    }
    match std::fs::read("/restore.json") {
        Ok(bytes) => match platform::Envelope::parse(&bytes) {
            Ok(mut saved) => match saved.checkpoint() {
                Ok(checkpoint) => {
                    let requested_log = session.message_paging == platform::MessagePaging::Log;
                    session.message_paging =
                        platform::MessagePaging::from_saved(&saved.presentation);
                    if requested_log && session.message_paging == platform::MessagePaging::Legacy {
                        session.message_paging =
                            platform::MessagePaging::ReplayLegacyUntil(saved.input_index);
                    }
                    session.input.inventory =
                        inventory::Inventory::restore(&mut saved.presentation, saved.input_index);
                    platform::MessagePaging::remove_marker(&mut saved.presentation);
                    session.seed = saved.seed;
                    session.name = saved.name;
                    session.input_index = saved.input_index - saved.inputs.len() as u32;
                    session.restore_checkpoint = checkpoint;
                    session.replay = saved.inputs.into();
                    if !saved.presentation.is_null() {
                        match serde_json::from_value(saved.presentation) {
                            Ok(presentation) => session.display.presentation = presentation,
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
    engine::reset(session);
    // SAFETY: CString remains live until C returns. All callbacks use the same
    // single-threaded module and hold no RefCell borrow across a call into C.
    unsafe { rg_core_start(initial_seed, name.as_ptr()) }
}

/// Ordinary narration has a separate presentation acknowledgement policy.
/// This observes session metadata and its input cursor; it never reads a key or changes C state.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_message_requires_acknowledgement() -> i32 {
    engine::with_session(|session| {
        i32::from(
            session
                .message_paging
                .requires_acknowledgement(session.input_index),
        )
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn rg_host_inventory_browser_enabled() -> i32 {
    engine::with_session(|session| i32::from(session.input.inventory.enabled(session.input_index)))
}

/// Returns one original game key, consuming raw browser events in Rust.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_read_key() -> i32 {
    let ui = engine::render_ui();
    emit(&json!({"type":"presentation","ui":ui}));
    trace();
    loop {
        let pending = engine::with_session_mut(|session| session.input.text_pending.pop_front());
        let replay = if pending.is_none() {
            engine::with_session_mut(|session| session.replay.pop_front())
        } else {
            None
        };
        let automatic = if pending.is_none() && replay.is_none() {
            engine::inventory_key()
        } else {
            None
        };
        let key = if let Some(key) = pending.or(replay).or(automatic) {
            key
        } else {
            // SAFETY: Synchronous host import waits on the Worker's SAB queue;
            // it does not re-enter Wasm or execute a game update.
            let raw = unsafe { js_rg_read_event() } as u32;
            match engine::decode(raw) {
                input::Input::Key(key) => key,
                input::Input::Save => {
                    persist();
                    continue;
                }
                input::Input::End => return -1,
                input::Input::Ignore => continue,
                input::Input::View => {
                    let ui = engine::render_ui();
                    emit(&json!({"type":"presentation","ui":ui}));
                    continue;
                }
            }
        };
        let accepted = engine::accept_key(key);
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
    let value = engine::present(value);
    emit(&value);
}

/// Tags a bolt that C has already drawn, without looking up hidden terrain.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_map_effect(x: i32, y: i32, glyph: i32, active: i32) {
    engine::map_effect(x, y, glyph, active);
}

/// Observes terrain beneath currently perceived actors without changing C state.
///
/// # Safety
/// `glyphs` points to `rows * columns` bytes for this synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_map_terrain(glyphs: *const u8, rows: u32, columns: u32) {
    let Some(length) = rows.checked_mul(columns).filter(|length| *length <= 4096) else {
        return;
    };
    if glyphs.is_null() {
        return;
    }
    // SAFETY: C guarantees the bounded borrowed observation buffer.
    let glyphs = unsafe { std::slice::from_raw_parts(glyphs, length as usize) };
    engine::map_terrain(glyphs.to_vec());
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
    let mut id = unsafe { CStr::from_ptr(id) }.to_string_lossy().into_owned();
    // SAFETY: Same caller-owned lifetime and termination contract as id.
    let args = unsafe { CStr::from_ptr(args) }.to_string_lossy();
    // SAFETY: Same caller-owned lifetime and termination contract as id.
    let fallback = unsafe { CStr::from_ptr(fallback) }.to_string_lossy();
    let mut arguments: Value = serde_json::from_str(&args).unwrap_or(Value::Null);
    let language = engine::with_session(|session| {
        // C's status command exposes the same public values as its HUD.
        // Translate that observation without changing C's legacy message buffer.
        if id != "message.clear"
            && !fallback.is_empty()
            && let Some(status) = session
                .display
                .presentation
                .lines
                .iter()
                .find(|line| line["scope"] == "status_message")
        {
            id = status["id"].as_str().unwrap_or("ui.status").into();
            arguments = status["args"].clone();
        }
        session
            .display
            .presentation
            .resolve_recall(&id, &mut arguments, &fallback);
        session.display.language.clone()
    });
    let mut rendered_arguments = arguments.clone();
    engine::with_session(|session| replace_player_names(&mut rendered_arguments, &session.name));
    let text = display::message_language(&id, &rendered_arguments, &fallback, &language);
    let event = json!({"type":"message","id":id,"text":text.text,"args":arguments,"fallback":fallback,
        "fallback_used":!text.missing_ids.is_empty(),"missing_ids":text.missing_ids});
    engine::with_session_mut(|session| session.display.presentation.remember(event.clone()));
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
        engine::with_session_mut(|session| {
            session.message_paging = session.message_paging.at_checkpoint(session.input_index);
            session.checkpoint = bytes;
            session.journal.clear();
            session.checkpoint_error = None;
            session.checkpoint_presentation =
                serde_json::to_value(&session.display.presentation).unwrap_or(Value::Null);
        });
    } else {
        if !pointer.is_null() {
            // SAFETY: The save API owns any non-null output allocation even on failure.
            unsafe {
                rg_core_save_free(pointer);
            }
        }
        engine::with_session_mut(|session| {
            session.checkpoint_error = Some(format!("checkpoint capture failed ({result})"))
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
    engine::with_session(|session| {
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
    let language = engine::with_session(|session| session.display.language.clone());
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
    if code >= 0 {
        engine::with_session_mut(|session| {
            session
                .display
                .presentation
                .lines
                .retain(|line| line["id"] != "ui.ending.return" && line["scope"] != "more");
            session.display.presentation.input = json!({"kind":"ended"});
            session.display.presentation.last_message = None;
        });
        let ui = engine::finish_ui();
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
    match engine::save_bytes() {
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
    let frame = engine::cached_frame();
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
