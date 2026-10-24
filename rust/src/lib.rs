//! Original Rogue C logic connected to Bevy display, input and platform plugins.
//! Each game has one single-threaded Wasm instance. Browser repaint never calls C.
mod engine;
mod host;
#[cfg(target_os = "emscripten")]
mod runtime;
mod session;
mod startup;

use abi::*;
use rogue_contract as abi;
use rogue_display::{display, identity::replace_player_names};
use rogue_input::{self as input, inventory};
use rogue_platform as platform;
use serde_json::{Value, json};
use session::Session;
use std::ffi::{CStr, CString, c_char};
use std::cell::RefCell;

unsafe extern "C" {
    fn rg_core_start(seed: u32, name: *const c_char) -> i32;
    fn rg_core_inspect(out: *mut u32, capacity: u32) -> u32;
    fn rg_core_save_bytes(out: *mut *mut u8, length: *mut u32) -> i32;
    #[cfg(feature = "test-hooks")]
    fn rg_core_load_bytes(bytes: *const u8, length: u32) -> i32;
    fn rg_core_save_free(bytes: *mut u8);
}

/// Owns a C serializer allocation. All exits use its matching C deallocator.
struct CoreSaveBuffer {
    pointer: *mut u8,
    length: u32,
}
impl CoreSaveBuffer {
    fn capture() -> Result<Self, String> {
        let mut buffer = Self {
            pointer: std::ptr::null_mut(),
            length: 0,
        };
        // SAFETY: C writes the allocation and length; no runtime borrow is held.
        let result = unsafe { rg_core_save_bytes(&mut buffer.pointer, &mut buffer.length) };
        if result != 0
            || buffer.pointer.is_null()
            || buffer.length == 0
            || buffer.length as usize > platform::MAX_CHECKPOINT
        {
            return Err(format!("checkpoint capture failed ({result})"));
        }
        Ok(buffer)
    }
    fn bytes(&self) -> &[u8] {
        // SAFETY: capture validated the serializer result and bounded its length;
        // the C allocation remains owned by self until Drop.
        unsafe { std::slice::from_raw_parts(self.pointer, self.length as usize) }
    }
}
impl Drop for CoreSaveBuffer {
    fn drop(&mut self) {
        if !self.pointer.is_null() {
            // SAFETY: C owns any non-null output even on failure. This is its
            // matching deallocator, called exactly once by the sole owner.
            unsafe { rg_core_save_free(self.pointer) };
        }
    }
}

fn emit(value: &Value) {
    if let Ok(bytes) = serde_json::to_vec(value)
        && u32::try_from(bytes.len()).is_ok()
    {
        host::present(&bytes);
    }
}

thread_local! { static RUN_FRAME: RefCell<Option<Value>> = const { RefCell::new(None) }; }
fn flush_run_frame() {
    if let Some(frame)=RUN_FRAME.with(|slot| slot.borrow_mut().take()) {emit(&frame);}
}
fn clear_run_permit() {
    engine::with_session_mut(|session| session.input.target_run.clear());
    flush_run_frame();
}
fn emit_game_frame(frame: Value) {
    let important=frame["map_actor_events"].as_array().is_some_and(|events|
        events.iter().any(|event| event["kind"] != "move"))
        || frame["map_projectile_events"].as_array().is_some_and(|events| !events.is_empty());
    if !important && engine::with_session(|session| session.input.target_run.coalescing()) {
        RUN_FRAME.with(|slot| *slot.borrow_mut()=Some(frame));
    } else {
        flush_run_frame();
        emit(&frame);
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
        clear_run_permit();
        emit_input_context();
    }
}

/// Marks C's explicit UTF-8 string editor. General commands remain ASCII keys.
/// # Safety
/// `initial` is null or a readable NUL-terminated UTF-8 string during this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_text_mode(enabled: i32, limit: u32, initial: *const c_char) {
    clear_run_permit();
    let initial = if initial.is_null() {
        String::new()
    } else {
        // SAFETY: The C editor owns this live, terminated option string.
        unsafe { CStr::from_ptr(initial) }
            .to_string_lossy()
            .into_owned()
    };
    engine::with_session_mut(|session| {
        if enabled != 0 {
            let initial = if enabled == 2 {
                session.platform.name().to_owned()
            } else if enabled == 3 && initial == "slime-mold" {
                String::new()
            } else {
                initial
            };
            session.input.begin_text(limit as usize, &initial);
            let row = session
                .display
                .presentation
                .lines
                .iter()
                .rev()
                .find(|line| line["scope"] == "options")
                .map(|line| line["row"].clone());
            session.display.presentation.input = json!({"kind":"text","limit_bytes":session.input.text_limit(),
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
            session.input.end_text();
            session.display.presentation.input = json!({"kind":"command"});
        }
    });
    emit_input_context();
}

/// # Safety
/// `name` is a live NUL-terminated UTF-8 string from C's changed name editor.
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
        // C owns whether get_str actually changed the option, including its
        // empty edit, previous-option '-' and home-expansion '~' semantics.
        engine::with_session_mut(|session| session.platform.set_player_name(name.into()));
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
    let enabled = engine::with_session(|session| session.platform.trace_enabled());
    if enabled {
        let snapshot = words();
        let input_index = engine::with_session(|session| session.platform.input_index());
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
    let startup = match startup::take() {
        Ok(startup) => startup,
        Err(error) => {
            notice(&error);
            return -2;
        }
    };
    let language = startup.locale;
    engine::with_session_mut(|state| state.display.language = language.into());
    if name.chars().any(char::is_control) {
        notice("invalid player name");
        return -2;
    }
    let mut session = Session {
        platform: platform::Session::new(seed, name),
        display: rogue_display::DisplayState {
            language: language.into(),
            ..Default::default()
        },
        ..Session::default()
    };
    let trace_enabled = startup.trace;
    session.platform.set_trace_enabled(trace_enabled);
    session.platform.set_message_paging(startup.message_paging);
    if let Some(bytes) = startup.restore {
        match platform::Envelope::parse(&bytes).and_then(|saved| {
            let restore_index = saved.input_index;
            platform::Session::restore(saved, session.platform.message_paging())
                .map(|(platform, presentation)| (platform, presentation, restore_index))
        }) {
            Ok((mut platform, mut presentation, restore_index)) => {
                platform.set_trace_enabled(trace_enabled);
                session.input.inventory =
                    inventory::Inventory::restore(&mut presentation, restore_index);
                session.platform = platform;
                if !presentation.is_null() {
                    match serde_json::from_value(presentation) {
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
        }
    }
    let initial_seed = session.platform.seed();
    // The real UTF-8 identity is owned by Rust. The original fixed-cell C name
    // has an ASCII alias until the user explicitly changes it in the editor.
    let c_name = if session.platform.name().is_ascii() {
        session.platform.name().to_owned()
    } else {
        "Player".into()
    };
    let name = match CString::new(c_name.as_bytes()) {
        Ok(name) => name,
        Err(_) => return -2,
    };
    engine::reset(session);
    engine::map_actor(rogue_display::map::ActorObservation::Replay(
        engine::with_session(|session| !session.platform.restore_data().is_empty()),
    ));
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
                .platform
                .message_paging()
                .requires_acknowledgement(session.platform.input_index()),
        )
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn rg_host_inventory_browser_enabled() -> i32 {
    engine::with_session(|session| {
        i32::from(
            session
                .input
                .inventory
                .enabled(session.platform.input_index()),
        )
    })
}

/// Returns one original game key, consuming raw browser events in Rust.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_read_key() -> i32 {
    clear_run_permit();
    let ui = engine::render_ui();
    emit(&json!({"type":"presentation","ui":ui}));
    trace();
    loop {
        let pending = engine::with_session_mut(|session| session.input.pending_key());
        let replay = if pending.is_none() {
            engine::with_session_mut(|session| session.platform.next_replay_key())
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
            // The final replay key can produce frames after its queue empties.
            // Keep those actions suppressed until the first real input wait.
            engine::map_actor(rogue_display::map::ActorObservation::Replay(false));
            // The host waits on the Worker's SAB queue and does not update the game.
            let raw = engine::with_session_mut(|session| session.input.take_deferred_event())
                .unwrap_or_else(|| host::read_event() as u32);
            if target_run_start_key(raw as i32).is_some() && ui["input"]["kind"] == "command"
                && !ui["window"].is_object() {
                raw as i32
            } else { match engine::decode(raw) {
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
            } }
        };
        // Validate every source, including journal replay, before setting a C start marker.
        if target_run_start_key(key).is_some()
            && (ui["input"]["kind"] != "command" || ui["window"].is_object()) {
            notice("target-run journal context mismatch");
            return -1;
        }
        // A boundary token can never become an ordinary char command, including replay.
        if key == RG_KEY_TARGET_RUN_CONTINUE as i32 || key == RG_KEY_TARGET_RUN_STOP as i32 {
            notice("target-run journal context mismatch");
            return -1;
        }
        let accepted = engine::accept_key(key);
        if !accepted {
            notice("input journal limit reached; restart from a safe checkpoint");
            return -1;
        }
        emit_input_context();
        if let Some(original) = target_run_start_key(key) {
            let sequence=engine::current_player_event_sequence();
            let interrupt=host::interrupt_epoch();
            engine::with_session_mut(|session| {
                session.input.mark_target_run_start();
                session.input.target_run.start(sequence,interrupt);
            });
            return i32::from(original);
        }
        return key;
    }
}

/// C consumes this marker after readchar has safely received an ordinary byte.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_take_target_run_start() -> i32 {
    engine::with_session_mut(|session| i32::from(session.input.take_target_run_start()))
}

/// A target run pauses at the existing action boundary without re-running look or daemons.
/// Only continue/stop are journalled here; a manual fallback is deferred to normal input.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_target_run_gate(direction: i32) -> i32 {
    use input::target_run::Decision;
    loop {
        let replay=engine::with_session_mut(|session| session.platform.next_replay_key());
        let control=if let Some(key)=replay {
            emit(&json!({"type":"input-context","input":{"kind":"run-boundary","direction":direction}}));
            trace();
            if key!=RG_KEY_TARGET_RUN_CONTINUE as i32 && key!=RG_KEY_TARGET_RUN_STOP as i32 {
                notice("target-run journal context mismatch");return -1;
            }
            key
        } else {
            let frame=engine::cached_frame().unwrap_or(Value::Null);
            let sequence=engine::current_player_event_sequence();
            let interrupt=host::interrupt_epoch();
            let decision=engine::with_session_mut(|session| session.input.target_run
                .decision(&frame,direction as u8,sequence,interrupt));
            match decision {
                Decision::Continue => RG_KEY_TARGET_RUN_CONTINUE as i32,
                Decision::Stop => {flush_run_frame();RG_KEY_TARGET_RUN_STOP as i32},
                Decision::Wait => {
                    flush_run_frame();
                    emit(&json!({"type":"input-context","input":{"kind":"run-boundary","direction":direction}}));
                    trace();
                    engine::map_actor(rogue_display::map::ActorObservation::Replay(false));
                    let raw=host::read_event() as u32;
                    if target_run_permit(raw).is_some() {
                        let granted=engine::with_session_mut(|session| session.input.target_run
                            .grant(raw,&frame,direction as u8));
                        if granted {continue;}
                        RG_KEY_TARGET_RUN_STOP as i32
                    } else {
                        match raw {
                            RG_KEY_TARGET_RUN_CONTINUE | RG_KEY_TARGET_RUN_STOP => raw as i32,
                            RG_KEY_SAVE => {persist();continue;},
                            RG_KEY_END_INPUT => return -1,
                            _ => {
                                engine::with_session_mut(|session| session.input.defer_event(raw));
                                RG_KEY_TARGET_RUN_STOP as i32
                            }
                        }
                    }
                }
            }
        };
        if !engine::accept_key(control) {
            notice("input journal limit reached; restart from a safe checkpoint");return -1;
        }
        if control==RG_KEY_TARGET_RUN_STOP as i32 {clear_run_permit();emit_input_context();}
        return control;
    }
}

/// Natural C stops end the whole target, rather than starting another run segment.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_target_run_ended(reason: i32) {
    clear_run_permit();
    emit(&json!({"type":"target-run-ended","reason":if reason == 1 { "no-command" } else { "natural" }}));
    emit_input_context();
}

/// Discards browser typeahead; semantic replay records already consumed in the
/// original session remain intact and are not pending keyboard events.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_flush_input() {
    host::flush_input();
}

/// Presents a copy of C's knowledge/view buffer without invoking look or RNG.
///
/// # Safety
/// `cells` points to `rows * columns` bytes for this synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_present(cells: *const u8, rows: u32, columns: u32) {
    if rows != 24 || columns != 80 {
        return;
    }
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
    engine::with_session_mut(|session| {
        session.display.player = rogue_display::player_state::PlayerState::from_snapshot(
            snapshot[RG_SNAPSHOT_FLAGS as usize],
        );
    });
    let value = engine::present(value);
    emit_game_frame(value);
}

/// Tags a bolt that C has already drawn, without looking up hidden terrain.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_map_effect(x: i32, y: i32, glyph: i32, active: i32) {
    engine::map_effect(x, y, glyph, active);
}

/// Replaces only ephemeral public character metadata, never C state or saves.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_map_actor_reset(epoch: u32) {
    engine::map_actor(rogue_display::map::ActorObservation::Reset(epoch));
}

/// Window text is not a map observation. C retains public IDs while Rust
/// composites the cached map beneath its existing game window.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_map_actors_begin(step: u32) -> i32 {
    engine::map_actor(rogue_display::map::ActorObservation::Step(step));
    if engine::render_ui()["mode"] != "game" {
        return 0;
    }
    engine::map_actor(rogue_display::map::ActorObservation::Begin);
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn rg_host_map_actor(id: u32, x: i32, y: i32, glyph: i32, facing: i32, stopped: i32) {
    if !matches!(stopped, 0 | 1) { return; }
    engine::map_actor(rogue_display::map::ActorObservation::Actor { id, x, y, glyph, facing, stopped: stopped == 1 });
}

#[unsafe(no_mangle)]
pub extern "C" fn rg_host_map_actor_event(id: u32, kind: u32) {
    engine::map_actor(rogue_display::map::ActorObservation::Event { id, kind });
}

/// Own-player interruptions reveal neither hidden attackers nor trap types.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_player_event(kind: u32) {
    let kind = match kind {
        RG_PLAYER_ATTACKED => "attacked",
        RG_PLAYER_TRAP => "trap",
        RG_PLAYER_ATTACK => "attack",
        _ => return,
    };
    emit(&json!({"type":"player-event","kind":kind,"sequence":engine::player_event_sequence()}));
}

/// Observe only public projectile metadata, never a rule or input operation.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_map_projectile(phase: u32, kind: u32, glyph: i32, x: i32, y: i32) {
    engine::map_projectile(rogue_display::projectile::Observation { phase, kind, glyph, x, y });
}

/// Observes terrain beneath currently perceived actors without changing C state.
///
/// # Safety
/// `glyphs` points to `rows * columns` bytes for this synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_map_terrain(glyphs: *const u8, rows: u32, columns: u32) {
    if rows != 24 || columns != 80 {
        return;
    }
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
    engine::with_session(|session| {
        replace_player_names(&mut rendered_arguments, session.platform.name())
    });
    let text = display::message_language(&id, &rendered_arguments, &fallback, &language);
    let event = json!({"type":"message","id":id,"text":text.text,"args":arguments,"fallback":fallback,
        "fallback_used":!text.missing_ids.is_empty(),"missing_ids":text.missing_ids});
    engine::with_session_mut(|session| session.display.presentation.remember(event.clone()));
    emit(&event);
}

/// C's safe outer-command boundary: capture state, then start a fresh journal.
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_checkpoint() {
    match CoreSaveBuffer::capture() {
        Ok(buffer) => {
            let bytes = buffer.bytes().to_vec();
            engine::with_session_mut(|session| {
                session.platform.capture_checkpoint(
                    bytes,
                    serde_json::to_value(&session.display.presentation).unwrap_or(Value::Null),
                );
            });
        }
        Err(error) => engine::with_session_mut(|session| session.platform.reject_checkpoint(error)),
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
        let checkpoint = session.platform.restore_data();
        if checkpoint.is_empty() {
            return 0;
        }
        // SAFETY: Caller provides valid outputs. Session's Vec allocation is not
        // modified while C runs; checkpoint callbacks use a distinct Vec.
        unsafe {
            *out = checkpoint.as_ptr();
            *length = checkpoint.len() as u32;
        }
        1
    })
}

/// Copies C's already-finalized score without changing game or RNG state.
///
/// # Safety
/// `name` points to `length` readable UTF-8 bytes for this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_score(amount:i32, flags:u32, monster:u32, level:i32, name:*const u8, length:u32, eligible:u32) {
    if name.is_null() || length>80 {return;}
    // SAFETY: The C caller owns the live bounded name for this observation.
    let bytes=unsafe {std::slice::from_raw_parts(name,length as usize)};
    let Ok(name)=std::str::from_utf8(bytes) else {return;};
    emit(&json!({"type":"score-result","score":amount,"flags":flags,"monster":monster,"level":level,"name":name,"eligible":eligible!=0}));
}

/// Reports a game outcome after C has completed its state updates.
///
/// # Safety
/// `message` is null or a readable NUL-terminated string during this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_outcome(code: i32, message: *const c_char) {
    clear_run_permit();
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
    host::outcome(code, translated.as_bytes());
}

fn persist() {
    match engine::save_bytes() {
        Ok(bytes) => {
            // The Rust host copies the envelope synchronously; durability is
            // acknowledged only after its asynchronous IndexedDB transaction.
            host::store(&bytes);
        }
        Err(error) => notice(&format!("save unavailable: {error}")),
    }
}

/// Repaints only the already captured Rust frame. Used by regression tests.
#[cfg(feature = "test-hooks")]
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
#[cfg(feature = "test-hooks")]
#[unsafe(no_mangle)]
pub extern "C" fn rg_test_save_roundtrip() -> i32 {
    let before = words();
    let Ok(buffer) = CoreSaveBuffer::capture() else {
        return -1;
    };
    // SAFETY: The owned C buffer remains alive throughout this synchronous load.
    let loaded = unsafe { rg_core_load_bytes(buffer.pointer, buffer.length) };
    if loaded != 0 || words() != before {
        -1
    } else {
        0
    }
}
