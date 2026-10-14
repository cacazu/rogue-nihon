//! Single producer / single consumer transport. Values remain opaque until game input.
use js_sys::{Atomics, Int32Array, SharedArrayBuffer};
use wasm_bindgen::prelude::*;
const WRITE: u32 = 0;
const READ: u32 = 1;
const CLOSED: u32 = 2;
const HEADER: u32 = 3;

#[cfg_attr(feature = "browser-test", wasm_bindgen(js_name = EventQueue))]
pub struct Queue {
    pub(super) buffer: SharedArrayBuffer,
    pub(super) capacity: u32,
    words: Int32Array,
}
#[cfg_attr(feature = "browser-test", wasm_bindgen(js_class = EventQueue))]
impl Queue {
    #[cfg_attr(feature = "browser-test", wasm_bindgen(constructor))]
    pub fn new(buffer: Option<SharedArrayBuffer>, capacity: u32) -> Result<Self, JsValue> {
        if !(2..=65536).contains(&capacity) || !capacity.is_power_of_two() {
            return Err(JsValue::from_str(
                "Queue capacity must be a power of two from 2 to 65536",
            ));
        }
        let buffer = buffer.unwrap_or_else(|| SharedArrayBuffer::new((HEADER + capacity) * 4));
        if buffer.byte_length() != (HEADER + capacity) * 4 {
            return Err(JsValue::from_str("Queue size mismatch"));
        }
        let words = Int32Array::new(&buffer);
        Ok(Self {
            buffer,
            capacity,
            words,
        })
    }
    #[cfg(feature = "browser-test")]
    #[wasm_bindgen(getter, js_name = buffer)]
    pub fn shared(&self) -> SharedArrayBuffer {
        self.buffer.clone()
    }
    #[cfg(feature = "browser-test")]
    #[wasm_bindgen(getter, js_name = capacity)]
    pub fn size(&self) -> u32 {
        self.capacity
    }
    #[cfg_attr(feature = "browser-test", wasm_bindgen(js_name = pushMany))]
    pub fn push_many(&self, values: &[i32]) -> Result<bool, JsValue> {
        if values.len() > self.capacity as usize || self.load(CLOSED)? != 0 {
            return Ok(false);
        }
        let write = self.load(WRITE)?;
        let read = self.load(READ)?;
        if write.wrapping_sub(read) as usize + values.len() > self.capacity as usize {
            return Ok(false);
        }
        for (index, value) in values.iter().enumerate() {
            Atomics::store(
                &self.words,
                HEADER + (write.wrapping_add(index as u32) & (self.capacity - 1)),
                *value,
            )?;
        }
        // Publish only after the entire batch is written, including a text/save sequence.
        Atomics::store(
            &self.words,
            WRITE,
            write.wrapping_add(values.len() as u32) as i32,
        )?;
        if !values.is_empty() {
            Atomics::notify_with_count(&self.words, WRITE, 1)?;
        }
        Ok(true)
    }
    pub fn take(&self) -> Result<i32, JsValue> {
        loop {
            let read = self.load(READ)?;
            let write = self.load(WRITE)?;
            if read != write {
                let value = Atomics::load(&self.words, HEADER + (read & (self.capacity - 1)))?;
                Atomics::store(&self.words, READ, read.wrapping_add(1) as i32)?;
                return Ok(value);
            }
            if self.load(CLOSED)? != 0 {
                return Err(JsValue::from_str("Input queue closed"));
            }
            Atomics::wait(&self.words, WRITE, write as i32)?;
        }
    }
    pub fn close(&self) -> Result<(), JsValue> {
        Atomics::store(&self.words, CLOSED, 1)?;
        Atomics::notify_with_count(&self.words, WRITE, 1)?;
        Ok(())
    }
    pub fn discard(&self) -> Result<Vec<u32>, JsValue> {
        let mut cursor = self.load(READ)?;
        let write = self.load(WRITE)?;
        let mut values = Vec::new();
        while cursor != write {
            values.push(self.load(HEADER + (cursor & (self.capacity - 1)))?);
            cursor = cursor.wrapping_add(1);
        }
        Atomics::store(&self.words, READ, write as i32)?;
        Ok(values)
    }
    #[cfg_attr(feature = "browser-test", wasm_bindgen(getter))]
    #[cfg_attr(not(feature = "browser-test"), allow(dead_code))]
    pub fn pending(&self) -> Result<u32, JsValue> {
        Ok(self.load(WRITE)?.wrapping_sub(self.load(READ)?))
    }
}
impl Queue {
    fn load(&self, index: u32) -> Result<u32, JsValue> {
        Ok(Atomics::load(&self.words, index)? as u32)
    }
}
