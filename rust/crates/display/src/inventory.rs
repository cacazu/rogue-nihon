//! Render inventory state and choices from public item descriptors.
use crate::display;
use serde_json::{Value, json};

#[derive(Default)]
pub struct InventoryView {
    pub selected: Option<Value>,
    pub details: bool,
}

fn text(id: &str, language: &str) -> String {
    display::message_language(id, &json!([]), "", language).text
}
fn descriptor(row: &Value) -> &Value {
    &row["args"][1]["value"]
}
/// Hide choices that public equipment/identification information already rules out.
/// Typed keys still reach the original C checks, including unknown curses.
pub fn choice_visible(row: &Value, action: Option<&str>, rows: &[Value]) -> bool {
    let item = descriptor(row);
    let equipped = item["equipped"].as_str().unwrap_or("none");
    let has = |slot: &str| rows.iter().any(|row| descriptor(row)["equipped"] == slot);
    match action {
        Some("action.wield") => equipped != "weapon",
        Some("action.wear") => !has("armor"),
        Some("action.put_ring") => {
            !equipped.ends_with("_ring") && !(has("left_ring") && has("right_ring"))
        }
        Some("action.call") => {
            matches!(item["category"].as_str(), Some("weapon" | "armor")) || item["known"] != true
        }
        _ => true,
    }
}
pub fn actions(row: &Value, ui: &Value) -> Vec<(i32, &'static str)> {
    let item = descriptor(row);
    let equipped = item["equipped"].as_str().unwrap_or("none");
    let has_equipped = |slot: &str| {
        ui["lines"]
            .as_array()
            .is_some_and(|rows| rows.iter().any(|row| descriptor(row)["equipped"] == slot))
    };
    let mut actions = match item["category"].as_str().unwrap_or("") {
        "potion" => vec![(113, "action.quaff")],
        "scroll" => vec![(114, "action.read")],
        "food" => vec![(101, "action.eat")],
        "weapon" if equipped != "weapon" => vec![(119, "inventory.wield")],
        "armor" if equipped == "armor" => vec![(84, "inventory.take_off")],
        "armor" => vec![(87, "action.wear")],
        "ring" if equipped.ends_with("_ring") => vec![(82, "inventory.remove_ring")],
        "ring" => vec![(80, "action.put_ring")],
        "stick" => vec![(122, "inventory.zap")],
        _ => vec![],
    };
    // Equipment slots are public knowledge. Never use hidden curse/bonus fields.
    if has_equipped("armor") {
        actions.retain(|(key, _)| *key != 87);
    }
    if has_equipped("left_ring") && has_equipped("right_ring") {
        actions.retain(|(key, _)| *key != 80);
    }
    actions.extend([(116, "action.throw"), (100, "inventory.drop")]);
    if ui["can_drop"] == false {
        actions.retain(|(key, _)| *key != 100);
    }
    if matches!(item["category"].as_str(), Some("weapon" | "armor"))
        || (matches!(
            item["category"].as_str(),
            Some("potion" | "scroll" | "ring" | "stick")
        ) && item["known"] == false)
    {
        actions.push((99, "action.call"));
    }
    actions.extend([(118, "inventory.details"), (27, "inventory.back")]);
    actions
}
pub fn decorate(view: &InventoryView, ui: &mut Value, language: &str) {
    if ui["inventory"] != true {
        return;
    }
    ui["window"]["title"] = json!(text("inventory.title", language));
    ui["window"]["message"] = Value::Null;
    ui["window"]["prompt"] = json!(text("inventory.choose", language));
    let Some(selected) = &view.selected else {
        return;
    };
    let available_actions = actions(selected, ui);
    let mut row = selected.clone();
    row["selectable"] = json!(false);
    row["row"] = json!(0);
    let mut rows = vec![row];
    if view.details {
        let item = descriptor(selected);
        let mut add = |label: &str, value: String| {
            rows.push(json!({"text":format!("{}：{}", text(label, language), value)}));
        };
        let category = item["category"].as_str().unwrap_or("");
        add(
            "inventory.category",
            text(&format!("identify.{category}"), language),
        );
        add("inventory.count", item["count"].to_string());
        add(
            "inventory.equipment",
            text(
                &format!(
                    "inventory.equipped.{}",
                    item["equipped"].as_str().unwrap_or("none")
                ),
                language,
            ),
        );
        if matches!(category, "potion" | "scroll" | "ring" | "stick") {
            add(
                "inventory.knowledge",
                text(
                    if item["known"] == true {
                        "inventory.known"
                    } else {
                        "inventory.unknown"
                    },
                    language,
                ),
            );
        }
        for field in [
            "hplus",
            "dplus",
            "protection",
            "enchantment",
            "charges",
            "bonus",
        ] {
            let visibility = match field {
                "protection" | "enchantment" => "ac",
                "bonus" => "ring_bonus",
                other => other,
            };
            if item["visible_fields"][visibility] == true
                && let Some(value) = item[field].as_i64()
            {
                add(&format!("inventory.{field}"), value.to_string());
            }
        }
    }
    ui["lines"] = json!(rows);
    ui["input"] = json!({"kind":"inventory", "text":""});
    ui["window"]["kind"] = json!(if view.details {
        "inventory_details"
    } else {
        "inventory_actions"
    });
    ui["window"]["title"] = json!(text(
        if view.details {
            "inventory.details"
        } else {
            "inventory.actions"
        },
        language
    ));
    ui["window"]["prompt"] = json!(text("inventory.back_hint", language));
    let actions = if view.details {
        vec![(27, "inventory.back")]
    } else {
        available_actions
    };
    ui["window"]["actions"] = json!(
        actions
            .into_iter()
            .map(|(key, id)| json!({"key":key,"text":text(id, language)}))
            .collect::<Vec<_>>()
    );
}
