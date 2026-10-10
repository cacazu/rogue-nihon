use serde_json::{Value, json};

/// Resolve identity at render time so C's fixed-width alias is never displayed.
pub fn replace_player_names(value: &mut Value, name: &str) {
    match value {
        Value::Object(object)
            if object.get("type").and_then(Value::as_str) == Some("player_name") =>
        {
            *value = json!({"type":"literal","text":name});
        }
        Value::Object(object) => {
            for value in object.values_mut() {
                replace_player_names(value, name);
            }
        }
        Value::Array(array) => {
            for value in array {
                replace_player_names(value, name);
            }
        }
        _ => {}
    }
}
