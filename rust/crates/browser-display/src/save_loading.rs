//! Uses the game platform's save validator before replacing a browser session.
use rogue_platform::{Envelope, MAX_ENVELOPE};
use serde_json::Value;

pub fn validate(bytes: &Value) -> Result<(), String> {
    let array = bytes.as_array().ok_or("save bytes are missing")?;
    if array.is_empty() || array.len() > MAX_ENVELOPE {
        return Err("invalid save file size".into());
    }
    let bytes: Vec<u8> =
        serde_json::from_value(bytes.clone()).map_err(|_| "invalid save bytes".to_string())?;
    Envelope::parse(&bytes).map(|_| ())
}
