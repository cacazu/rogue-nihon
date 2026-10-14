//! Emscripten imports are declared in Rust; wasm-bindgen generates their connection.
#[cfg(target_os = "emscripten")]
mod browser {
    use wasm_bindgen::prelude::*;
    #[wasm_bindgen]
    unsafe extern "C" {
        #[wasm_bindgen(js_namespace = ["globalThis", "RogueHost"], js_name = readEvent)]
        pub fn read_event() -> i32;
        #[wasm_bindgen(js_namespace = ["globalThis", "RogueHost"], js_name = flushInput)]
        pub fn flush_input();
        #[wasm_bindgen(js_namespace = ["globalThis", "RogueHost"], js_name = present)]
        pub fn present(pointer: u32, length: u32);
        #[wasm_bindgen(js_namespace = ["globalThis", "RogueHost"], js_name = store)]
        pub fn store(pointer: u32, length: u32);
        #[wasm_bindgen(js_namespace = ["globalThis", "RogueHost"], js_name = outcome)]
        pub fn outcome(code: i32, pointer: u32, length: u32);
    }
}
// Native layer-check executables supply the same host ABI without browser dependencies.
#[cfg(not(target_os = "emscripten"))]
mod native {
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
    #[cfg(target_os = "emscripten")]
    {
        browser::read_event()
    }
    #[cfg(not(target_os = "emscripten"))]
    {
        // SAFETY: The synchronous native host returns one opaque integer.
        unsafe { native::read_event() }
    }
}
pub fn flush_input() {
    #[cfg(target_os = "emscripten")]
    browser::flush_input();
    #[cfg(not(target_os = "emscripten"))]
    {
        // SAFETY: This host callback borrows no memory.
        unsafe { native::flush_input() }
    }
}
pub fn present(bytes: &[u8]) {
    let length = u32::try_from(bytes.len()).expect("Host buffer length fits the ABI");
    #[cfg(target_os = "emscripten")]
    browser::present(bytes.as_ptr() as u32, length);
    #[cfg(not(target_os = "emscripten"))]
    {
        // SAFETY: The host reads and copies this slice before returning.
        unsafe { native::present(bytes.as_ptr(), length) }
    }
}
pub fn store(bytes: &[u8]) {
    let length = u32::try_from(bytes.len()).expect("Host buffer length fits the ABI");
    #[cfg(target_os = "emscripten")]
    browser::store(bytes.as_ptr() as u32, length);
    #[cfg(not(target_os = "emscripten"))]
    {
        // SAFETY: The host reads and copies this slice before returning.
        unsafe { native::store(bytes.as_ptr(), length) }
    }
}
pub fn outcome(code: i32, bytes: &[u8]) {
    let length = u32::try_from(bytes.len()).expect("Host buffer length fits the ABI");
    #[cfg(target_os = "emscripten")]
    browser::outcome(code, bytes.as_ptr() as u32, length);
    #[cfg(not(target_os = "emscripten"))]
    {
        // SAFETY: The host reads and copies this slice before returning.
        unsafe { native::outcome(code, bytes.as_ptr(), length) }
    }
}
