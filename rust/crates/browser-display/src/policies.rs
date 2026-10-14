//! Browser-independent input, preferences, localization and history policies.
use serde_json::{Value, json};

pub fn text(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
pub fn flag(v: &Value) -> bool {
    v.as_bool().unwrap_or(false)
}
pub fn number(v: &Value) -> u64 {
    v.as_u64().unwrap_or(0)
}
pub fn valid_text(value: &str, limit: usize, empty: bool) -> bool {
    (empty || !value.is_empty())
        && value.len() <= limit
        && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
pub fn seed(value: &str) -> Option<u32> {
    let n: f64 = value.trim().parse().ok()?;
    (n.is_finite() && n >= 0. && n <= u32::MAX as f64 && n.fract() == 0.).then_some(n as u32)
}
pub fn valid_zoom(value: &Value) -> bool {
    value.as_f64().is_some_and(|size| {
        size.is_finite()
            && (rogue_display::browser_ui::MIN_MAP_SIZE..=rogue_display::browser_ui::MAX_MAP_SIZE)
                .contains(&size)
    })
}
pub fn mode(value: &str) -> bool {
    matches!(value, "ascii" | "tiles" | "pixels")
}
pub fn preference(raw: &str) -> Value {
    let v = serde_json::from_str::<Value>(raw).unwrap_or(Value::Null);
    if v["version"] == 1 && mode(text(&v["mode"])) && valid_zoom(&v["zoom"]) {
        json!({"version":1,"mode":v["mode"],"zoom":v["zoom"]})
    } else {
        json!({"version":1,"mode":"tiles","zoom":32})
    }
}
pub struct Catalog {
    catalogs: [Value; 2],
    pub missing: Vec<Value>,
}
impl Default for Catalog {
    fn default() -> Self {
        Self {
            catalogs: [
                serde_json::from_str(include_str!("../../../../locales/ui-web-ja.json"))
                    .expect("JA catalog"),
                serde_json::from_str(include_str!("../../../../locales/ui-web-en.json"))
                    .expect("EN catalog"),
            ],
            missing: Vec::new(),
        }
    }
}
impl Catalog {
    pub fn label(&mut self, locale: &str, id: &str, args: &Value) -> String {
        let Some(value) = self.catalogs[usize::from(locale == "en")]["messages"][id].as_str()
        else {
            self.missing.push(json!({"locale":locale,"id":id}));
            return format!("Missing UI catalog entry: {locale}:{id}");
        };
        let mut out = value.to_string();
        if let Some(args) = args.as_object() {
            for (key, value) in args {
                out = out.replace(
                    &format!("{{{key}}}"),
                    &if value.is_string() {
                        text(value).into()
                    } else {
                        value.to_string()
                    },
                );
            }
        }
        out
    }
}
#[derive(Default)]
pub struct History {
    pub entries: Vec<Value>,
}
impl History {
    pub fn append(&mut self, value: Value) {
        self.entries.push(value);
        if self.entries.len() > 500 {
            self.entries.remove(0);
        }
    }
    pub fn message(&mut self, value: Value) {
        if !value.is_object() || value["id"] == "message.clear" || text(&value["text"]).is_empty() {
            return;
        }
        let error = text(&value["id"]).starts_with("platform.");
        self.append(json!({"source":if error || value["id"]=="save.browser" {"system"} else {"game"},"error":error,"message":value}));
    }
    pub fn notice(&mut self, id: &str, args: Value, error: bool) {
        self.append(json!({"source":"system","id":id,"args":args,"error":error}));
    }
}


#[cfg(test)]
mod all_catalog {
    use super::*;
    #[test]
    fn all_catalog_ui_labels_and_missing_entries() {
        let mut catalog=Catalog::default();
        for language in ["ja","en"] {
            let entries=catalog.catalogs[usize::from(language=="en")]["messages"].as_object().unwrap().clone();
            for (id,entry) in entries {
                let template=entry.as_str().unwrap();let mut args=serde_json::Map::new();
                let mut rest=template;
                while let Some(open)=rest.find('{') {
                    rest=&rest[open+1..];let close=rest.find('}').unwrap();
                    args.insert(rest[..close].into(),json!(7));rest=&rest[close+1..];
                }
                let rendered=catalog.label(language,&id,&Value::Object(args));
                assert!(!rendered.contains('{')&&!rendered.contains('}'),"{language}:{id}: {rendered}");
                assert!(!rendered.contains('\u{fffd}'),"{language}:{id}");
                assert!(catalog.missing.is_empty(),"{language}:{id}");
            }
        }
        catalog.catalogs[0]["messages"].as_object_mut().unwrap().remove("action.inventory");
        let rendered=catalog.label("ja","action.inventory",&json!({}));
        assert!(rendered.starts_with("Missing UI catalog entry"));
        assert_eq!(catalog.missing.len(),1);
    }
}
