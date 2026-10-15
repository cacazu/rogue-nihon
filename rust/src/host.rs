//! Fixed-width synchronous host imports; no JavaScript runtime or string ABI.
#[cfg(target_os = "emscripten")]
mod browser {
    #[link(wasm_import_module = "rogue")]
    unsafe extern "C" {
        #[link_name = "read_event"]
        pub fn read_event() -> i32;
        #[link_name = "flush_input"]
        pub fn flush_input();
        #[link_name = "present"]
        pub fn present(pointer: *const u8, length: u32);
        #[link_name = "store"]
        pub fn store(pointer: *const u8, length: u32);
        #[link_name = "outcome"]
        pub fn outcome(code: i32, pointer: *const u8, length: u32);
        #[link_name = "clock_milliseconds"]
        pub fn clock_milliseconds() -> f64;
        #[link_name = "diagnostic"]
        pub fn diagnostic(pointer: *const u8, length: u32);
        #[link_name = "calendar_year"]
        pub fn calendar_year() -> i32;
    }
}
// Native layer-check executables supply the same host ABI without browser dependencies.
#[cfg(not(target_os = "emscripten"))]
mod browser {
    unsafe extern "C" {
        #[link_name = "js_rg_read_event"]
        pub fn read_event() -> i32;
        #[link_name = "js_rg_flush_input"]
        pub fn flush_input();
        #[link_name = "js_rg_present"]
        pub fn present(pointer: *const u8, length: u32);
        #[link_name = "js_rg_store"]
        pub fn store(pointer: *const u8, length: u32);
        #[link_name = "js_rg_outcome"]
        pub fn outcome(code: i32, pointer: *const u8, length: u32);
    }
}
pub fn read_event() -> i32 {
    // SAFETY: The synchronous host returns one opaque integer and does not re-enter C.
    unsafe { browser::read_event() }
}
pub fn flush_input() {
    // SAFETY: This callback borrows no memory and only discards pending transport values.
    unsafe { browser::flush_input() }
}
pub fn present(bytes: &[u8]) {
    let length = u32::try_from(bytes.len()).expect("Host buffer length fits the ABI");
    // SAFETY: The host reads and copies this slice before returning.
    unsafe { browser::present(bytes.as_ptr(), length) }
}
pub fn store(bytes: &[u8]) {
    let length = u32::try_from(bytes.len()).expect("Host buffer length fits the ABI");
    // SAFETY: The host reads and copies this slice before returning.
    unsafe { browser::store(bytes.as_ptr(), length) }
}
pub fn outcome(code: i32, bytes: &[u8]) {
    let length = u32::try_from(bytes.len()).expect("Host buffer length fits the ABI");
    // SAFETY: The host reads and copies this slice before returning.
    unsafe { browser::outcome(code, bytes.as_ptr(), length) }
}
#[cfg(target_os = "emscripten")]
pub fn clock_milliseconds() -> f64 {
    // SAFETY: The browser observes its clock without entering the game again.
    unsafe { browser::clock_milliseconds() }
}
#[cfg(target_os = "emscripten")]
pub fn diagnostic(bytes: &[u8]) {
    let length = u32::try_from(bytes.len()).expect("Diagnostic buffer fits the ABI");
    // SAFETY: The browser host synchronously copies these diagnostic bytes.
    unsafe { browser::diagnostic(bytes.as_ptr(), length) }
}
#[cfg(target_os = "emscripten")]
#[unsafe(no_mangle)]
pub extern "C" fn rg_host_calendar_year() -> i32 {
    // SAFETY: This observes the browser's local year without updating the game.
    unsafe { browser::calendar_year() }
}
