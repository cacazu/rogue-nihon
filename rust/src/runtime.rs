//! Standalone libc services owned by Rust rather than an Emscripten JS runtime.
//!
//! These symbols are called only by the C/Rust libc inside this Wasm instance.
//! Pointer arguments refer to live, initialized caller allocations, and output
//! pointers refer to writable allocations for the duration of the call. Bounds
//! checks reject malformed addresses; they do not extend allocation lifetimes.
#![cfg(target_os = "emscripten")]

use crate::host;
use std::{cell::Cell, mem::size_of};

// Emscripten's errno ABI uses WASI values, not the Linux errno numbering.
const SUCCESS: u16 = 0;
const TOO_BIG: u16 = 1;
const BAD_FD: u16 = 8;
const FAULT: u16 = 21;
const INVALID: u16 = 28;
const IO: u16 = 29;
const NO_MEMORY: u16 = 48;
const NOT_SUPPORTED: u16 = 58;
const OVERFLOW: u16 = 61;
const RANGE: u16 = 68;
const MAX_STDIO_BYTES: usize = 64 * 1024;
const MAX_STDIO_VECTORS: usize = 1024;

#[repr(C)]
#[derive(Clone, Copy)]
struct IoVector {
    pointer: *const u8,
    length: usize,
}

fn in_memory(pointer: *const u8, length: usize) -> bool {
    if length == 0 {
        return true;
    }
    if pointer.is_null() {
        return false;
    }
    let limit = std::arch::wasm32::memory_size::<0>().saturating_mul(65536);
    (pointer as usize)
        .checked_add(length)
        .is_some_and(|end| end <= limit)
}

unsafe fn write_output<T: Copy>(pointer: *mut T, value: T) -> Result<(), u16> {
    if !in_memory(pointer.cast(), size_of::<T>()) {
        return Err(FAULT);
    }
    // SAFETY: The caller supplies a writable output allocation; its full range
    // was checked above. Unaligned writes avoid adding an alignment contract.
    unsafe { pointer.write_unaligned(value) };
    Ok(())
}

#[unsafe(no_mangle)]
unsafe extern "C" fn __wasi_environ_sizes_get(count: *mut u32, bytes: *mut u32) -> u16 {
    // SAFETY: Both are libc-provided output allocations under this module's ABI.
    if let Err(error) = unsafe { write_output(count, 0) } {
        return error;
    }
    // SAFETY: Same output contract as count.
    unsafe { write_output(bytes, 0) }.map_or_else(|error| error, |_| SUCCESS)
}

#[unsafe(no_mangle)]
extern "C" fn __wasi_environ_get(_environment: *mut *mut u8, _bytes: *mut u8) -> u16 {
    // The preceding size query reports zero entries and zero string bytes.
    SUCCESS
}

#[unsafe(no_mangle)]
extern "C" fn emscripten_notify_memory_growth(_index: i32) {
    // The Rust Worker reads memory.buffer afresh for each synchronous transfer.
}

#[unsafe(no_mangle)]
unsafe extern "C" fn __syscall_getcwd(pointer: *mut u8, capacity: usize) -> i32 {
    if capacity == 0 {
        return -i32::from(INVALID);
    }
    if capacity < 2 {
        return -i32::from(RANGE);
    }
    if !in_memory(pointer, 2) {
        return -i32::from(FAULT);
    }
    // SAFETY: Libc supplies a writable buffer and two bytes were checked above.
    unsafe {
        pointer.write(b'/');
        pointer.add(1).write(0);
    }
    2
}

fn unsupported_descriptor(fd: u32) -> u16 {
    if fd <= 2 { NOT_SUPPORTED } else { BAD_FD }
}

#[unsafe(no_mangle)]
extern "C" fn __wasi_fd_close(fd: u32) -> u16 {
    unsupported_descriptor(fd)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn __wasi_fd_seek(
    fd: u32,
    _offset: i64,
    _whence: u8,
    position: *mut u64,
) -> u16 {
    // SAFETY: Position is a libc-provided writable output allocation.
    if let Err(error) = unsafe { write_output(position, 0) } {
        return error;
    }
    unsupported_descriptor(fd)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn __wasi_fd_read(
    fd: u32,
    _vectors: *const IoVector,
    _count: usize,
    read: *mut usize,
) -> u16 {
    // SAFETY: Read count is a libc-provided writable output allocation.
    if let Err(error) = unsafe { write_output(read, 0) } {
        return error;
    }
    // Game input has its own typed host channel, never a fabricated stdin file.
    unsupported_descriptor(fd)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn __wasi_fd_write(
    fd: u32,
    vectors: *const IoVector,
    count: usize,
    written: *mut usize,
) -> u16 {
    // SAFETY: Written count is a libc-provided writable output allocation.
    if let Err(error) = unsafe { write_output(written, 0) } {
        return error;
    }
    if fd != 1 && fd != 2 {
        return unsupported_descriptor(fd);
    }
    if count > MAX_STDIO_VECTORS {
        return TOO_BIG;
    }
    if !in_memory(vectors.cast(), count * size_of::<IoVector>()) {
        return FAULT;
    }
    let mut total = 0usize;
    for index in 0..count {
        // SAFETY: Libc supplies initialized descriptors; their whole range was
        // checked above. The ABI permits unaligned descriptor addresses.
        let vector = unsafe { vectors.add(index).read_unaligned() };
        if !in_memory(vector.pointer, vector.length) {
            return FAULT;
        }
        let Some(next) = total.checked_add(vector.length) else {
            return TOO_BIG;
        };
        if next > MAX_STDIO_BYTES {
            return TOO_BIG;
        }
        total = next;
    }
    let mut bytes = Vec::new();
    if bytes.try_reserve_exact(total).is_err() {
        return NO_MEMORY;
    }
    for index in 0..count {
        // SAFETY: Same live, initialized descriptor range checked above.
        let vector = unsafe { vectors.add(index).read_unaligned() };
        if vector.length == 0 {
            continue;
        }
        // SAFETY: Libc supplies live initialized byte allocations. Their ranges
        // were checked before any host call; no callback runs during this copy.
        bytes.extend_from_slice(unsafe {
            std::slice::from_raw_parts(vector.pointer, vector.length)
        });
    }
    if !bytes.is_empty() {
        // Join iovecs before forwarding, preserving UTF-8 split across vectors.
        host::diagnostic(&bytes);
    }
    // SAFETY: The output allocation was checked before processing descriptors.
    unsafe { written.write_unaligned(total) };
    SUCCESS
}

thread_local! {
    static LAST_MONOTONIC: Cell<u64> = const { Cell::new(0) };
}

#[unsafe(no_mangle)]
unsafe extern "C" fn __wasi_clock_time_get(
    clock: u32,
    _precision: u64,
    timestamp: *mut u64,
) -> u16 {
    // SAFETY: Timestamp is a libc-provided writable output allocation.
    if let Err(error) = unsafe { write_output(timestamp, 0) } {
        return error;
    }
    // Only realtime and monotonic clocks exist in this browser integration.
    if clock > 1 {
        return NOT_SUPPORTED;
    }
    let milliseconds = host::clock_milliseconds();
    if !milliseconds.is_finite() || milliseconds < 0.0 {
        return IO;
    }
    let nanoseconds = milliseconds * 1_000_000.0;
    if nanoseconds >= u64::MAX as f64 {
        return OVERFLOW;
    }
    let mut value = nanoseconds as u64;
    if clock == 1 {
        LAST_MONOTONIC.with(|last| {
            value = value.max(last.get());
            last.set(value);
        });
    }
    // SAFETY: The timestamp allocation was checked before the host clock call.
    unsafe { timestamp.write_unaligned(value) };
    SUCCESS
}
