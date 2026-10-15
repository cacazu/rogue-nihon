//! One owned startup request per fresh game instance; no virtual filesystem.
use crate::platform;
use serde_json::Value;
use std::cell::RefCell;
#[cfg(feature = "test-hooks")]
use std::ffi::c_char;

// An outer JSON string can double the UTF-8 size of a valid saved JSON document.
// The remaining bytes cover the small, fixed startup fields.
const MAX_CONFIG: usize = platform::MAX_ENVELOPE * 2 + 1024;
const MAX_ALLOCATIONS: usize = 8;

pub(crate) struct Startup {
    pub locale: &'static str,
    pub trace: bool,
    pub message_paging: platform::MessagePaging,
    pub restore: Option<Vec<u8>>,
    #[cfg(feature = "test-hooks")]
    fixture: Option<String>,
}

enum State {
    Fresh,
    Configured(Startup),
    Consumed,
}
thread_local! {
    static STATE: RefCell<State> = const { RefCell::new(State::Fresh) };
    // Rust retains each allocation until the caller returns its exact pointer/length.
    static BUFFERS: RefCell<Vec<Box<[u8]>>> = const { RefCell::new(Vec::new()) };
    #[cfg(feature = "test-hooks")]
    static FIXTURE: RefCell<Option<String>> = const { RefCell::new(None) };
}

fn parse(bytes: &[u8]) -> Result<Startup, String> {
    if bytes.is_empty() || bytes.len() > MAX_CONFIG {
        return Err("invalid startup configuration size".into());
    }
    let mut value: Value = serde_json::from_slice(bytes)
        .map_err(|_| "invalid startup configuration JSON".to_owned())?;
    let object = value
        .as_object_mut()
        .ok_or("startup configuration must be an object")?;
    if object.keys().any(|key| {
        let permitted = matches!(
            key.as_str(),
            "locale" | "trace" | "message_paging" | "restore"
        );
        #[cfg(feature = "test-hooks")]
        let permitted = permitted || key == "fixture";
        !permitted
    }) {
        return Err("unknown startup configuration field".into());
    }
    let locale = match object.get("locale").and_then(Value::as_str) {
        Some("ja") => "ja",
        Some("en") => "en",
        _ => return Err("invalid startup locale".into()),
    };
    let trace = object
        .get("trace")
        .and_then(Value::as_bool)
        .ok_or("invalid startup trace flag")?;
    let message_paging = match object.get("message_paging").and_then(Value::as_str) {
        Some("classic") => platform::MessagePaging::Legacy,
        Some("log") => platform::MessagePaging::Log,
        _ => return Err("invalid startup narration policy".into()),
    };
    let restore = match object.remove("restore") {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) if text.len() <= platform::MAX_ENVELOPE => {
            Some(text.into_bytes())
        }
        _ => return Err("invalid startup restore buffer".into()),
    };
    #[cfg(feature = "test-hooks")]
    let fixture = match object.remove("fixture") {
        None | Some(Value::Null) => None,
        Some(Value::String(text))
            if !text.is_empty()
                && text.len() < 64
                && text
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')) =>
        {
            Some(text)
        }
        _ => return Err("invalid startup regression fixture".into()),
    };
    Ok(Startup {
        locale,
        trace,
        message_paging,
        restore,
        #[cfg(feature = "test-hooks")]
        fixture,
    })
}

/// Copies and validates one startup JSON request. The caller retains the buffer.
/// A successful configuration cannot be replaced, including after the game exits.
///
/// # Safety
/// `bytes` points to `length` readable bytes during this synchronous call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_configure(bytes: *const u8, length: u32) -> i32 {
    if !STATE.with(|state| matches!(*state.borrow(), State::Fresh)) {
        return -3;
    }
    if bytes.is_null() || length == 0 || length as usize > MAX_CONFIG {
        return -2;
    }
    // SAFETY: The caller lends a live, bounded byte slice for this call only.
    let bytes = unsafe { std::slice::from_raw_parts(bytes, length as usize) };
    let startup = match parse(bytes) {
        Ok(startup) => startup,
        Err(_) => return -2,
    };
    STATE.with(|state| *state.borrow_mut() = State::Configured(startup));
    0
}

pub(crate) fn take() -> Result<Startup, String> {
    let previous = STATE.with(|state| std::mem::replace(&mut *state.borrow_mut(), State::Consumed));
    match previous {
        State::Configured(startup) => {
            #[cfg(feature = "test-hooks")]
            FIXTURE.with(|fixture| *fixture.borrow_mut() = startup.fixture.clone());
            Ok(startup)
        }
        State::Fresh => Err("startup configuration missing".into()),
        State::Consumed => Err("game instance already consumed".into()),
    }
}

/// Allocates a writable host transfer buffer owned by this Rust instance.
/// Returns null for zero, excessive size, too many live buffers or allocation failure.
#[unsafe(no_mangle)]
pub extern "C" fn rg_alloc(length: u32) -> *mut u8 {
    let length = length as usize;
    if length == 0 || length > MAX_CONFIG {
        return std::ptr::null_mut();
    }
    BUFFERS.with(|buffers| {
        let mut buffers = buffers.borrow_mut();
        if buffers.len() >= MAX_ALLOCATIONS
            || buffers.iter().map(|bytes| bytes.len()).sum::<usize>() > MAX_CONFIG - length
        {
            return std::ptr::null_mut();
        }
        let mut bytes = Vec::new();
        if bytes.try_reserve_exact(length).is_err() {
            return std::ptr::null_mut();
        }
        bytes.resize(length, 0);
        let mut bytes = bytes.into_boxed_slice();
        let pointer = bytes.as_mut_ptr();
        buffers.push(bytes);
        pointer
    })
}

/// Returns an exact allocation to its owner. Unknown, repeated or mismatched
/// pointer/length pairs are ignored without constructing a slice or freeing memory.
#[unsafe(no_mangle)]
pub extern "C" fn rg_dealloc(pointer: *mut u8, length: u32) {
    BUFFERS.with(|buffers| {
        let mut buffers = buffers.borrow_mut();
        if let Some(index) = buffers.iter().position(|bytes| {
            bytes.as_ptr() == pointer.cast_const() && bytes.len() == length as usize
        }) {
            buffers.swap_remove(index);
        }
    });
}

/// Copies the configured test fixture ID into C's bounded local buffer.
/// This symbol and its state are absent from production builds.
///
/// # Safety
/// `output` points to `capacity` writable bytes during this synchronous call.
#[cfg(feature = "test-hooks")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn rg_host_fixture_id(output: *mut c_char, capacity: u32) -> i32 {
    if output.is_null() || capacity == 0 {
        return -1;
    }
    FIXTURE.with(|fixture| {
        let fixture = fixture.borrow();
        let Some(text) = fixture.as_deref() else {
            return 0;
        };
        if text.len() >= capacity as usize {
            return -1;
        }
        // SAFETY: The caller lends this writable C buffer. The validated ASCII
        // ID fits together with its NUL terminator and cannot alias our String.
        unsafe {
            std::ptr::copy_nonoverlapping(text.as_ptr(), output.cast(), text.len());
            output.add(text.len()).write(0);
        }
        text.len() as i32
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &[u8] =
        r#"{"locale":"ja","trace":true,"message_paging":"log","restore":"{\"saved\":\"勇者\"}"}"#
            .as_bytes();

    #[test]
    fn configuration_copies_owned_restore_and_is_consumed_once() {
        STATE.with(|state| *state.borrow_mut() = State::Fresh);
        let pointer = rg_alloc(CONFIG.len() as u32);
        assert!(!pointer.is_null());
        // SAFETY: rg_alloc returned exactly CONFIG.len() writable bytes.
        unsafe {
            std::ptr::copy_nonoverlapping(CONFIG.as_ptr(), pointer, CONFIG.len());
            assert_eq!(rg_configure(pointer, CONFIG.len() as u32), 0);
        }
        rg_dealloc(pointer, CONFIG.len() as u32);
        let startup = take().expect("owned configuration");
        assert_eq!(startup.locale, "ja");
        assert!(startup.trace);
        assert!(startup.message_paging == platform::MessagePaging::Log);
        assert_eq!(
            startup.restore.as_deref(),
            Some("{\"saved\":\"勇者\"}".as_bytes())
        );
        assert!(take().is_err());
        // SAFETY: CONFIG is an immutable static byte slice.
        assert_eq!(
            unsafe { rg_configure(CONFIG.as_ptr(), CONFIG.len() as u32) },
            -3
        );
    }

    #[test]
    fn invalid_requests_do_not_replace_fresh_state() {
        STATE.with(|state| *state.borrow_mut() = State::Fresh);
        for bytes in [
            &b"[]"[..],
            &b"{\"locale\":\"fr\",\"trace\":false,\"message_paging\":\"classic\"}"[..],
            &b"{\"locale\":\"en\",\"trace\":1,\"message_paging\":\"classic\"}"[..],
            &b"{\"locale\":\"en\",\"trace\":false,\"message_paging\":\"classic\",\"restore\":[1]}"
                [..],
            &b"{\"locale\":\"en\",\"trace\":false,\"message_paging\":\"classic\",\"files\":[]}"[..],
            &b"\xff"[..],
        ] {
            // SAFETY: Each test byte slice remains readable during the call.
            assert_eq!(
                unsafe { rg_configure(bytes.as_ptr(), bytes.len() as u32) },
                -2
            );
        }
        assert!(STATE.with(|state| matches!(*state.borrow(), State::Fresh)));
        // SAFETY: Null is checked before constructing a slice.
        assert_eq!(unsafe { rg_configure(std::ptr::null(), 1) }, -2);
    }

    #[test]
    fn transfer_buffers_require_the_exact_owner_pair() {
        let pointer = rg_alloc(4);
        assert!(!pointer.is_null());
        rg_dealloc(pointer, 3);
        assert!(BUFFERS.with(|buffers| {
            buffers
                .borrow()
                .iter()
                .any(|bytes| bytes.as_ptr() == pointer)
        }));
        rg_dealloc(pointer, 4);
        rg_dealloc(pointer, 4);
        assert!(BUFFERS.with(|buffers| buffers.borrow().is_empty()));
        assert!(rg_alloc(0).is_null());
        assert!(rg_alloc((MAX_CONFIG + 1) as u32).is_null());
    }

    #[cfg(feature = "test-hooks")]
    #[test]
    fn regression_fixture_is_owned_and_copied_with_a_terminator() {
        let request =
            br#"{"locale":"en","trace":false,"message_paging":"classic","fixture":"ending-death"}"#;
        STATE.with(|state| *state.borrow_mut() = State::Fresh);
        // SAFETY: request remains readable for this synchronous call.
        assert_eq!(
            unsafe { rg_configure(request.as_ptr(), request.len() as u32) },
            0
        );
        take().expect("fixture startup");
        let mut output = [127_i8; 64];
        // SAFETY: output lends 64 writable bytes to the bounded copy.
        assert_eq!(
            unsafe { rg_host_fixture_id(output.as_mut_ptr(), output.len() as u32) },
            12
        );
        assert_eq!(output[12], 0);
        assert_eq!(&output[..12], b"ending-death".map(|byte| byte as i8));
        // SAFETY: The buffer is live; its short capacity is rejected before copying.
        assert_eq!(unsafe { rg_host_fixture_id(output.as_mut_ptr(), 12) }, -1);
    }
}
