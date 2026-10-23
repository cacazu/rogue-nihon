//! UI color roles are data in web/themes.json; map colors are shared by all themes.
use serde::Deserialize;
use serde_json::Value;
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalog {
    version: u32,
    default: String,
    map_colors: BTreeMap<String, String>,
    themes: Vec<Definition>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Definition {
    id: String,
    label: String,
    monochrome_icons: bool,
    colors: BTreeMap<String, String>,
}
fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let c: Catalog =
            serde_json::from_str(include_str!("../../../../web/themes.json")).expect("Theme JSON");
        assert_eq!(c.version, 1);
        let default = c
            .themes
            .iter()
            .find(|t| t.id == c.default)
            .expect("Default theme");
        let keys: Vec<_> = default.colors.keys().collect();
        for (index, theme) in c.themes.iter().enumerate() {
            assert!(
                !theme.id.is_empty() && !c.themes[..index].iter().any(|t| t.id == theme.id),
                "Unique theme ID"
            );
            assert_eq!(
                theme.colors.keys().collect::<Vec<_>>(),
                keys,
                "Every theme defines the same roles"
            );
            for color in theme.colors.values().chain(c.map_colors.values()) {
                let hex = color.strip_prefix('#').expect("Hex theme color");
                assert!(
                    matches!(hex.len(), 3 | 4 | 6 | 8)
                        && hex.bytes().all(|b| b.is_ascii_hexdigit()),
                    "Valid theme color"
                );
            }
        }
        c
    })
}
#[derive(Clone, Copy)]
pub struct Theme(&'static Definition);
impl Default for Theme {
    fn default() -> Self {
        Self::named(&catalog().default)
    }
}
impl Theme {
    pub fn named(id: &str) -> Self {
        let c = catalog();
        Self(
            c.themes
                .iter()
                .find(|t| t.id == id)
                .unwrap_or_else(|| c.themes.iter().find(|t| t.id == c.default).unwrap()),
        )
    }
    pub fn known(id: &str) -> bool {
        catalog().themes.iter().any(|t| t.id == id)
    }
    pub fn options() -> Vec<(&'static str, &'static str)> {
        catalog()
            .themes
            .iter()
            .map(|t| (t.id.as_str(), t.label.as_str()))
            .collect()
    }
    pub fn id(self) -> &'static str {
        &self.0.id
    }
    pub fn color<'a>(self, role: &'a str) -> &'a str {
        if let Some(key) = role.strip_prefix("@map.") {
            catalog()
                .map_colors
                .get(key)
                .expect("Map color role")
                .as_str()
        } else if let Some(key) = role.strip_prefix('@') {
            self.0.colors.get(key).expect("UI color role").as_str()
        } else {
            role
        }
    }
    /// Resolve only paint fields. User text and data beginning with @ stay intact.
    pub fn paint(self, command: &mut Value) {
        let ui_text = command["op"] == "text"
            && command["color"]
                .as_str()
                .is_some_and(|c| c.starts_with('@') && !c.starts_with("@map."));
        for key in ["color", "fill", "stroke"] {
            if let Some(value) = command
                .get(key)
                .and_then(Value::as_str)
                .filter(|v| v.starts_with('@'))
                .map(str::to_owned)
            {
                command[key] = self.color(&value).into();
            }
        }
        if let Some(value) = command["outline"]["color"]
            .as_str()
            .filter(|v| v.starts_with('@'))
            .map(str::to_owned)
        {
            command["outline"]["color"] = self.color(&value).into();
        }
        if ui_text && self.0.monochrome_icons {
            command["monochrome"] = true.into();
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_preserves_default_and_resolves_independent_roles() {
        assert_eq!(Theme::default().id(), "default");
        assert_eq!(Theme::named("unknown").id(), "default");
        assert_eq!(Theme::default().color("@window.border"), "#ffffff");
        assert_eq!(Theme::default().color("@hud.hp"), "#f5a6aa");
        let green = Theme::named("green-black");
        assert_eq!(green.color("@text.primary"), "#00ff66");
        for key in catalog().map_colors.keys() {
            let role = format!("@map.{key}");
            assert_eq!(green.color(&role), Theme::default().color(&role));
        }
        let mut command =
            serde_json::json!({"op":"text","text":"@window.border","color":"@text.primary"});
        green.paint(&mut command);
        assert_eq!(command["text"], "@window.border");
        assert_eq!(command["monochrome"], true);
    }
    #[test]
    fn widget_and_screen_color_roles_are_all_defined_in_json() {
        let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = vec![source.join("widgets.rs")];
        files.extend(
            std::fs::read_dir(source.join("browser_ui"))
                .unwrap()
                .map(|e| e.unwrap().path())
                .filter(|p| {
                    p.extension().is_some_and(|s| s == "rs") && p.file_name().unwrap() != "tests.rs"
                }),
        );
        for file in files {
            let source = std::fs::read_to_string(&file).unwrap();
            for value in source.split('"') {
                if value.len() > 1 && value.starts_with('@') && !value.contains(char::is_whitespace)
                {
                    for (id, _) in Theme::options() {
                        Theme::named(id).color(value);
                    }
                }
                if let Some(hex) = value.strip_prefix('#') {
                    assert!(
                        !(matches!(hex.len(), 3 | 4 | 6 | 8)
                            && hex.bytes().all(|b| b.is_ascii_hexdigit())),
                        "Move paint color {value} in {} to themes.json",
                        file.display()
                    );
                }
            }
        }
    }
}
