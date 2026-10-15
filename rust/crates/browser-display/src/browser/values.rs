//! Rust owns value conversion and UTF-8/UTF-16 encoding at the browser boundary.
//! The generated bindings only read code units and create browser strings/objects.
use js_sys::{Array, JsString, Object, Reflect};
use serde_json::{Map, Number, Value};
use wasm_bindgen::{JsCast, JsValue, prelude::wasm_bindgen};

const MAX_DEPTH: usize = 128;
const STRING_CHUNK: usize = 2048;

pub(super) fn string(text: &str) -> JsValue {
    utf16_string(text).into()
}

fn utf16_string(text: &str) -> JsString {
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut result = JsString::from_char_code(&[]);
    // Bound the argument list passed to fromCharCode; large JSON/UI strings must
    // not depend on the browser's maximum number of function arguments.
    for chunk in units.chunks(STRING_CHUNK) {
        result = result.concat(&JsString::from_char_code(chunk));
    }
    result
}

pub(super) fn rust_string(value: &JsValue) -> Option<String> {
    value.dyn_ref::<JsString>().map(|text| {
        // Browser/IME strings may contain an unpaired surrogate. Match the
        // browser string boundary's replacement policy without a JS encoder.
        char::decode_utf16(text.iter())
            .map(|unit| unit.unwrap_or(char::REPLACEMENT_CHARACTER))
            .collect()
    })
}

/// The generated String ABI receives this exact Rust allocation. wasm-bindgen
/// exports Vec as a boxed slice, so its pointer/length also describe the layout
/// the normal String receiver frees. No JS encoder or second allocation is used.
#[wasm_bindgen]
pub fn browser_encode_utf8(value: JsString) -> Vec<u8> {
    char::decode_utf16(value.iter())
        .map(|unit| unit.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect::<String>()
        .into_bytes()
}

/// Decode the String ABI's borrowed bytes while its Rust owner is alive.
///
/// # Safety
/// `pointer` must identify `length` readable bytes in this instance's memory
/// until this synchronous call returns. The generated browser binding calls this
/// only for a live Rust string; ownership remains with that string's caller.
/// An exported `&[u8]` would assume ownership of a JS-allocated copy and must not
/// be used here, because it would free the original borrowed Rust string.
#[wasm_bindgen]
pub unsafe fn browser_decode_utf8(pointer: u32, length: u32) -> JsString {
    if length == 0 {
        return utf16_string("");
    }
    // SAFETY: The generated String binding supplies its live borrowed memory.
    let bytes = unsafe { std::slice::from_raw_parts(pointer as *const u8, length as usize) };
    utf16_string(&String::from_utf8_lossy(bytes))
}

pub(super) fn to_js(value: &Value) -> Result<JsValue, JsValue> {
    encode(value, 0)
}

fn encode(value: &Value, depth: usize) -> Result<JsValue, JsValue> {
    if depth > MAX_DEPTH {
        return Err(string("Browser value nesting exceeds the limit"));
    }
    Ok(match value {
        Value::Null => JsValue::NULL,
        Value::Bool(value) => JsValue::from_bool(*value),
        Value::Number(value) => JsValue::from_f64(
            value
                .as_f64()
                .ok_or_else(|| string("Browser number is not representable"))?,
        ),
        Value::String(value) => string(value),
        Value::Array(values) => {
            let array = Array::new();
            for value in values {
                array.push(&encode(value, depth + 1)?);
            }
            array.into()
        }
        Value::Object(values) => {
            // A null prototype avoids the __proto__ setter and inherits no
            // application properties. All keys remain plain JSON data.
            let object = Object::create(JsValue::NULL.unchecked_ref::<Object>());
            for (key, value) in values {
                Reflect::set(&object, &string(key), &encode(value, depth + 1)?)?;
            }
            object.into()
        }
    })
}

pub(super) fn from_js(value: &JsValue) -> Result<Value, JsValue> {
    decode(value, &mut Vec::new(), 0)
}

fn omitted(value: &JsValue) -> bool {
    value.is_undefined() || value.is_function() || value.is_symbol()
}

fn decode(value: &JsValue, path: &mut Vec<JsValue>, depth: usize) -> Result<Value, JsValue> {
    if depth > MAX_DEPTH {
        return Err(string("Browser value nesting exceeds the limit"));
    }
    if value.is_null() {
        return Ok(Value::Null);
    }
    if let Some(value) = value.as_bool() {
        return Ok(Value::Bool(value));
    }
    if let Some(value) = value.as_f64() {
        // JSON's non-finite numbers become null; preserve the former boundary.
        // Restore integral JSON numbers as integers: controller generations,
        // input indices and dimensions use as_u64 rather than a float cast.
        if value.fract() == 0. {
            if value >= 0. && value < u64::MAX as f64 {
                return Ok(Value::Number(Number::from(value as u64)));
            }
            if value < 0. && value >= i64::MIN as f64 {
                return Ok(Value::Number(Number::from(value as i64)));
            }
        }
        return Ok(Number::from_f64(value).map_or(Value::Null, Value::Number));
    }
    if let Some(value) = rust_string(value) {
        return Ok(Value::String(value));
    }
    if !value.is_object() {
        return Err(string("Unsupported browser value"));
    }
    if path.iter().any(|ancestor| ancestor == value) {
        return Err(string("Cyclic browser value"));
    }
    path.push(value.clone());
    let decoded = if Array::is_array(value) {
        let array = value.unchecked_ref::<Array>();
        let mut values = Vec::with_capacity(array.length() as usize);
        for index in 0..array.length() {
            let item = array.get(index);
            values.push(if omitted(&item) {
                Value::Null
            } else {
                decode(&item, path, depth + 1)?
            });
        }
        Value::Array(values)
    } else {
        let mut values = Map::new();
        // This also preserves enumerable indexed properties of a typed array.
        // Its bytes are handled separately by the Worker transfer boundary.
        for key in Object::keys(value.unchecked_ref::<Object>()).iter() {
            let item = Reflect::get(value, &key)?;
            if !omitted(&item) {
                let key = rust_string(&key)
                    .ok_or_else(|| string("Browser object key is not a string"))?;
                values.insert(key, decode(&item, path, depth + 1)?);
            }
        }
        Value::Object(values)
    };
    path.pop();
    Ok(decoded)
}

pub(super) fn error_message(value: &JsValue) -> String {
    if let Some(message) = rust_string(value) {
        return message;
    }
    if value.is_object() {
        let property = |key| {
            Reflect::get(value, &string(key))
                .ok()
                .and_then(|value| rust_string(&value))
                .filter(|text| !text.is_empty())
        };
        if let Some(message) = property("message") {
            return property("name")
                .map_or_else(|| message.clone(), |name| format!("{name}: {message}"));
        }
    }
    if let Some(number) = value.as_f64() {
        return number.to_string();
    }
    if let Some(boolean) = value.as_bool() {
        return boolean.to_string();
    }
    "Browser API failed".to_string()
}
