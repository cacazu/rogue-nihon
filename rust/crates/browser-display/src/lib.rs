//! Main-thread UI FFI. Independent from the C/Worker game instance and its RNG.
mod controller;
mod policies;
#[cfg(test)]
mod tests;
use controller::Controller;
use rogue_display::widgets::TextSize;
use serde_json::{Value, json};
use std::cell::RefCell;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "canvas")]
unsafe extern "C" {
    fn measure_text(pointer: *const u8, length: usize, size: f64, flags: u32, metric: u32) -> f64;
}
fn measure(text: &str, size: f64, bold: bool, mono: bool) -> TextSize {
    #[cfg(target_arch = "wasm32")]
    {
        let flags = u32::from(bold) | u32::from(mono) << 1;
        // SAFETY: JS synchronously reads the live UTF-8 slice during this import.
        unsafe {
            TextSize {
                width: measure_text(text.as_ptr(), text.len(), size, flags, 0),
                ascent: measure_text(text.as_ptr(), text.len(), size, flags, 1),
                descent: measure_text(text.as_ptr(), text.len(), size, flags, 2),
            }
        }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (bold, mono);
        TextSize {
            width: text.chars().count() as f64 * size * 0.6,
            ascent: 0.,
            descent: size,
        }
    }
}
// Both initializers are already const; the toolchain also reports this lint on
// the thread_local macro's expansion, where that source block is not visible.
thread_local! {
    #[allow(clippy::missing_const_for_thread_local)]
    static UI: RefCell<Option<Controller>> = const { RefCell::new(None) };
    #[allow(clippy::missing_const_for_thread_local)]
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}
#[unsafe(no_mangle)]
pub extern "C" fn ui_alloc(length: usize) -> *mut u8 {
    let buffer = vec![0_u8; length].into_boxed_slice();
    Box::into_raw(buffer).cast::<u8>()
}
/// # Safety
/// Pointer and length must refer to one live allocation from `ui_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ui_free(pointer: *mut u8, length: usize) {
    // SAFETY: Caller returns the exact allocation and original length once.
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            pointer, length,
        )));
    }
}
/// # Safety
/// Pointer must reference `length` readable bytes until the synchronous call ends.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn ui_request(pointer: *const u8, length: usize) {
    // SAFETY: The JS adapter supplies the live allocation it filled with JSON.
    let input = unsafe { std::slice::from_raw_parts(pointer, length) };
    let result = serde_json::from_slice::<Value>(input)
        .map(|request| {
            UI.with(|ui| {
                let mut slot = ui.borrow_mut();
                slot.get_or_insert_with(|| Controller::new(measure))
                    .request(request)
            })
        })
        .unwrap_or_else(|error| json!({"error":error.to_string()}));
    OUTPUT.with(|output| {
        *output.borrow_mut() = serde_json::to_vec(&result).expect("UI response JSON")
    });
}
#[unsafe(no_mangle)]
pub extern "C" fn ui_output_pointer() -> *const u8 {
    OUTPUT.with(|v| v.borrow().as_ptr())
}
#[unsafe(no_mangle)]
pub extern "C" fn ui_output_length() -> usize {
    OUTPUT.with(|v| v.borrow().len())
}
