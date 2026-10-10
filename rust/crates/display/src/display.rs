//! Pure presentation of immutable view data and semantic message templates.
use serde_json::Value;
use std::sync::OnceLock;

fn catalog(language: &str) -> &'static Value {
    static JAPANESE: OnceLock<Value> = OnceLock::new();
    static ENGLISH: OnceLock<Value> = OnceLock::new();
    let (slot, sources) = if language == "ja" {
        (
            &JAPANESE,
            [
                include_str!("../../../../locales/ja.json"),
                include_str!("../../../../locales/ui-game-ja.json"),
                include_str!("../../../../locales/runtime-ja.json"),
                include_str!("../../../../locales/endings-ja.json"),
            ],
        )
    } else {
        (
            &ENGLISH,
            [
                include_str!("../../../../locales/en.json"),
                include_str!("../../../../locales/ui-game-en.json"),
                include_str!("../../../../locales/runtime-en.json"),
                include_str!("../../../../locales/endings-en.json"),
            ],
        )
    };
    slot.get_or_init(|| {
        let mut messages = serde_json::Map::new();
        for source in sources {
            if let Ok(value) = serde_json::from_str::<Value>(source)
                && let Some(entries) = value["messages"].as_object()
            {
                messages.extend(
                    entries
                        .iter()
                        .map(|(id, entry)| (id.clone(), entry.clone())),
                );
            }
        }
        Value::Object(messages)
    })
}

#[derive(Default, Debug)]
pub struct Rendered {
    pub text: String,
    pub missing_ids: Vec<String>,
}

impl Rendered {
    fn fallback(id: &str, text: &str) -> Self {
        Self {
            text: text.into(),
            missing_ids: vec![id.into()],
        }
    }
    fn append(&mut self, other: Self) {
        self.text.push_str(&other.text);
        self.missing_ids.extend(other.missing_ids);
    }
}

#[allow(dead_code)] // English compatibility entry point used by standalone checks.
pub fn message(id: &str, arguments: &Value, fallback: &str) -> String {
    message_language(id, arguments, fallback, "en").text
}

pub fn message_language(id: &str, arguments: &Value, fallback: &str, language: &str) -> Rendered {
    render(id, arguments, fallback, language, 0)
}

fn descriptor(value: &Value, language: &str, depth: usize) -> Rendered {
    match value.get("type").and_then(Value::as_str) {
        Some("term") => render(
            value["id"].as_str().unwrap_or("entity.invalid"),
            &serde_json::json!([]),
            "",
            language,
            depth + 1,
        ),
        Some("message") => render(
            value["id"].as_str().unwrap_or("entity.invalid"),
            &value["args"],
            "",
            language,
            depth + 1,
        ),
        Some("literal") => value["text"]
            .as_str()
            .map(|text| Rendered {
                text: text.into(),
                ..Rendered::default()
            })
            .unwrap_or_else(|| {
                Rendered::fallback("entity.invalid_literal", "名前を表示できません")
            }),
        _ => crate::entities::render(value, language)
            .map(|text| Rendered {
                text,
                ..Rendered::default()
            })
            .unwrap_or_else(|| Rendered::fallback("entity.invalid", "未登録の名称")),
    }
}

fn render(id: &str, arguments: &Value, fallback: &str, language: &str, depth: usize) -> Rendered {
    if depth > 16 {
        return Rendered::fallback("message.recursion_limit", fallback);
    }
    if id == "message.clear" {
        return Rendered::default();
    }
    if id == "ui.untranslated" && language == "ja" {
        return Rendered::fallback(id, "未翻訳の表示が見つかりました");
    }
    // Original English and its exact paging remain authoritative in C. The
    // English view is also the independent logical-screen comparison output.
    if language != "ja" && !fallback.is_empty() {
        return Rendered {
            text: fallback.into(),
            ..Rendered::default()
        };
    }
    if id == "message.legacy" {
        return if fallback.is_empty() {
            Rendered::default()
        } else {
            Rendered::fallback(id, fallback)
        };
    }
    if id == "message.sequence" {
        let Some(parts) = arguments.as_array() else {
            return Rendered::fallback(id, fallback);
        };
        let mut actor = None;
        let mut target = None;
        let mut verb = None;
        let mut consumed = Vec::new();
        for (index, part) in parts.iter().enumerate() {
            if let Some(args) = part["value"]["args"].as_array() {
                for arg in args {
                    let value = &arg["value"];
                    match value["type"].as_str() {
                        Some("combat_verb") => {
                            verb = Some(value.clone());
                            consumed.push(index);
                        }
                        Some("monster") if value["role"] == "subject" => {
                            actor = Some(value.clone());
                            consumed.push(index);
                        }
                        Some("monster") if value["role"] == "object" => {
                            target = Some(value.clone());
                            consumed.push(index);
                        }
                        _ => {}
                    }
                }
            }
        }
        let mut output = Rendered::default();
        let combat = actor.zip(verb);
        if let Some((actor, verb)) = combat {
            let value = serde_json::json!({"type":"combat","actor":actor,"target":target,
                "hit":verb["hit"],"index":verb["index"],"terse":target.is_none()});
            output.append(descriptor(&value, language, depth));
        } else {
            consumed.clear();
        }
        for (index, part) in parts.iter().enumerate() {
            if consumed.contains(&index) {
                continue;
            }
            let value = &part["value"];
            output.append(render(
                value["id"].as_str().unwrap_or("message.invalid_part"),
                &value["args"],
                value["fallback"].as_str().unwrap_or(""),
                language,
                depth + 1,
            ));
        }
        return output;
    }
    let entry = &catalog(language)[id];
    let Some(template) = entry.as_str().or_else(|| entry["template"].as_str()) else {
        return Rendered::fallback(id, fallback);
    };
    let Some(args) = arguments.as_array() else {
        return Rendered::fallback(id, fallback);
    };
    let mut prepared = args.clone();
    let mut missing_ids = Vec::new();
    for (index, arg) in prepared.iter_mut().enumerate() {
        let kind = arg["kind"].as_str().unwrap_or("");
        let converted = if kind == "entity" {
            Some(descriptor(&arg["value"], language, depth))
        } else if kind == "term" {
            Some(render(
                arg["value"].as_str().unwrap_or("term.invalid"),
                &serde_json::json!([]),
                "",
                language,
                depth + 1,
            ))
        } else {
            None
        };
        if let Some(value) = converted {
            missing_ids.extend(value.missing_ids);
            *arg = serde_json::json!({"kind":"string","value":value.text});
        } else if entry["conversions"][index].as_str() == Some("c") {
            let scalar = arg["value"]
                .as_u64()
                .and_then(|v| u32::try_from(v).ok())
                .and_then(char::from_u32);
            if let Some(scalar) = scalar {
                arg["value"] = Value::String(scalar.to_string());
            } else {
                missing_ids.push(format!("{id}.argument.{index}.char"));
            }
        } else if let Some(text) = arg["value"].as_str()
            && let Some(values) = entry["argument_values"][index.to_string()].as_object()
        {
            if let Some(translation) = values.get(text).and_then(|v| v["text"].as_str()) {
                arg["value"] = Value::String(translation.into());
            } else {
                missing_ids.push(format!("{id}.argument.{index}.token"));
            }
        }
    }
    match format_template(template, &prepared) {
        Ok(text) => Rendered {
            text: preserve_capitalization(text, fallback),
            missing_ids,
        },
        Err(_) => Rendered::fallback(&format!("{id}.arguments"), fallback),
    }
}

fn preserve_capitalization(mut text: String, fallback: &str) -> String {
    if fallback
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_uppercase)
        && text.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
    {
        text.replace_range(..1, &text[..1].to_ascii_uppercase());
    }
    text
}

pub fn format_template(template: &str, arguments: &[Value]) -> Result<String, String> {
    // Translation packs may use {0}, {1}, ... to reorder typed arguments.
    // Original-language catalogs retain their printf syntax.
    if template.contains('{') {
        return format_indexed(template, arguments);
    }
    let mut output = String::new();
    let mut chars = template.chars().peekable();
    let mut index = 0_usize;
    while let Some(character) = chars.next() {
        if character != '%' {
            output.push(character);
            continue;
        }
        if chars.peek() == Some(&'%') {
            chars.next();
            output.push('%');
            continue;
        }
        let mut left = false;
        let mut zero = false;
        let mut plus = false;
        while let Some(&flag) = chars.peek() {
            match flag {
                '-' => left = true,
                '0' => zero = true,
                '+' => plus = true,
                ' ' | '#' => {}
                _ => break,
            };
            chars.next();
        }
        let mut width = 0_usize;
        if chars.peek() == Some(&'*') {
            chars.next();
            let value = next_value(arguments, &mut index)?
                .as_i64()
                .ok_or("invalid width argument")?;
            if value < 0 {
                left = true;
            }
            width = usize::try_from(value.unsigned_abs()).map_err(|_| "width overflow")?;
        } else {
            while chars.peek().is_some_and(char::is_ascii_digit) {
                width = width
                    .checked_mul(10)
                    .and_then(|w| w.checked_add(chars.next()?.to_digit(10)? as usize))
                    .ok_or("width overflow")?;
            }
        }
        let mut precision = None;
        if chars.peek() == Some(&'.') {
            chars.next();
            let mut p = 0_usize;
            if chars.peek() == Some(&'*') {
                chars.next();
                p = usize::try_from(
                    next_value(arguments, &mut index)?
                        .as_i64()
                        .ok_or("invalid precision")?,
                )
                .map_err(|_| "invalid precision")?;
            } else {
                while chars.peek().is_some_and(char::is_ascii_digit) {
                    p = p
                        .checked_mul(10)
                        .and_then(|w| w.checked_add(chars.next()?.to_digit(10)? as usize))
                        .ok_or("precision overflow")?;
                }
            }
            precision = Some(p);
        }
        while chars
            .peek()
            .is_some_and(|c| matches!(c, 'l' | 'h' | 'z' | 't' | 'j' | 'L'))
        {
            chars.next();
        }
        let conversion = chars.next().ok_or("incomplete conversion")?;
        let value = next_value(arguments, &mut index)?;
        let mut piece = match conversion {
            's' => {
                let mut s = value.as_str().ok_or("invalid string argument")?.to_owned();
                if let Some(p) = precision {
                    s = s.chars().take(p).collect();
                }
                s
            }
            'c' => {
                if let Some(s) = value.as_str() {
                    s.chars().next().ok_or("empty char")?.to_string()
                } else {
                    char::from_u32(
                        u32::try_from(value.as_u64().ok_or("invalid char")?)
                            .map_err(|_| "char overflow")?,
                    )
                    .ok_or("invalid scalar")?
                    .to_string()
                }
            }
            'd' | 'i' => {
                let number = value.as_i64().ok_or("invalid signed argument")?;
                if plus && number >= 0 {
                    format!("+{number}")
                } else {
                    number.to_string()
                }
            }
            'u' => value
                .as_u64()
                .ok_or("invalid unsigned argument")?
                .to_string(),
            'x' => format!("{:x}", value.as_u64().ok_or("invalid hex argument")?),
            'X' => format!("{:X}", value.as_u64().ok_or("invalid hex argument")?),
            'f' | 'F' => {
                let number = value.as_f64().ok_or("invalid float argument")?;
                let p = precision.unwrap_or(6);
                if p > 64 {
                    return Err("precision exceeds limit".into());
                }
                format!("{number:.p$}")
            }
            _ => return Err("unsupported conversion".into()),
        };
        if width > 4096 {
            return Err("width exceeds limit".into());
        }
        let padding = width.saturating_sub(piece.chars().count());
        if left {
            piece.extend(std::iter::repeat_n(' ', padding));
        } else if padding > 0 {
            let fill = if zero { '0' } else { ' ' };
            if zero && piece.starts_with(['-', '+']) {
                piece.insert_str(1, &fill.to_string().repeat(padding));
            } else {
                piece = fill.to_string().repeat(padding) + &piece;
            }
        }
        output.push_str(&piece);
    }
    if index != arguments.len() {
        return Err("unused format arguments".into());
    }
    Ok(output)
}

fn format_indexed(template: &str, arguments: &[Value]) -> Result<String, String> {
    let mut chars = template.chars().peekable();
    let mut output = String::new();
    while let Some(character) = chars.next() {
        if character == '{' {
            if chars.peek() == Some(&'{') {
                chars.next();
                output.push('{');
                continue;
            }
            let mut digits = String::new();
            while chars.peek().is_some_and(char::is_ascii_digit) {
                if let Some(c) = chars.next() {
                    digits.push(c);
                }
            }
            if chars.next() != Some('}') || digits.is_empty() {
                return Err("invalid indexed template".into());
            }
            let index: usize = digits.parse().map_err(|_| "argument index overflow")?;
            let value = arguments
                .get(index)
                .and_then(|a| a.get("value"))
                .ok_or("missing indexed argument")?;
            match value {
                Value::String(s) => output.push_str(s),
                Value::Number(n) => output.push_str(&n.to_string()),
                _ => return Err("unsupported indexed argument".into()),
            }
        } else if character == '}' {
            if chars.next() != Some('}') {
                return Err("unescaped closing brace".into());
            }
            output.push('}');
        } else {
            output.push(character);
        }
    }
    Ok(output)
}

fn next_value<'a>(arguments: &'a [Value], index: &mut usize) -> Result<&'a Value, String> {
    let value = arguments
        .get(*index)
        .ok_or("missing format argument")?
        .get("value")
        .ok_or("untyped argument")?;
    *index += 1;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn original_formats_are_typed_and_can_change_word_order() {
        let args = serde_json::json!([{"kind":"string","value":"orc"},{"kind":"signed","value":7}]);
        assert_eq!(
            format_template("the %s hits for %2d", args.as_array().expect("fixture"))
                .expect("format"),
            "the orc hits for  7"
        );
        assert_eq!(
            format_template(
                "{1}ダメージを{0}から受けた",
                args.as_array().expect("fixture")
            )
            .expect("indexed format"),
            "7ダメージをorcから受けた"
        );
        let args = serde_json::json!([{"kind":"signed","value":4},{"kind":"signed","value":9}]);
        assert_eq!(
            format_template("%*d%%", args.as_array().expect("fixture")).expect("format"),
            "   9%"
        );
        assert!(format_template("%s", &[]).is_err());
    }
}
