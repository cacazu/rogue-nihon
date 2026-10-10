//! Inventory interaction is a Rust view over C's public item descriptors.
//! Only confirmed actions produce original C keys; browsing never enters the journal.
use crate::Input;
use rogue_display::{
    inventory::{InventoryView, actions},
    presentation::Presentation,
};
use serde_json::{Value, json};

#[derive(Default)]
pub struct Inventory {
    selected: Option<Value>,
    details: bool,
    pending: Option<Pending>,
    legacy_until: Option<u32>,
    restored_pending: Option<Pending>,
}
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Pending {
    command: i32,
    item: i32,
    hand: Option<i32>,
    started: bool,
}
fn descriptor(row: &Value) -> &Value {
    &row["args"][1]["value"]
}

impl Inventory {
    pub fn restore(presentation: &mut Value, index: u32) -> Self {
        let legacy_until = if presentation["input"]["inventory_browser"] == "actions" {
            presentation["input"]["inventory_browser_legacy_until"]
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
        } else {
            Some(index)
        };
        let restored_pending =
            serde_json::from_value::<Pending>(presentation["input"]["inventory_intent"].clone())
                .ok()
                .filter(|pending| {
                    pending.started
                        && matches!(pending.command, 116 | 122)
                        && (97..=122).contains(&pending.item)
                        && pending.hand.is_none()
                });
        if let Some(input) = presentation["input"].as_object_mut() {
            input.remove("inventory_intent");
            let marked = input.remove("inventory_browser").is_some();
            input.remove("inventory_browser_legacy_until");
            if marked && input.is_empty() {
                presentation["input"] = Value::Null;
            }
        }
        Self {
            legacy_until,
            restored_pending,
            ..Self::default()
        }
    }
    pub fn enabled(&self, index: u32) -> bool {
        self.legacy_until.is_none_or(|last| index > last)
    }
    pub fn mark(&self, presentation: &mut Value) {
        if presentation.is_null() {
            *presentation =
                serde_json::to_value(Presentation::default()).expect("presentation serializes");
        }
        if presentation["input"].is_null() {
            presentation["input"] = json!({});
        }
        presentation["input"]["inventory_browser"] = json!("actions");
        if let Some(pending) = self.pending.as_ref().or(self.restored_pending.as_ref())
            && pending.started
            && matches!(pending.command, 116 | 122)
        {
            presentation["input"]["inventory_intent"] =
                serde_json::to_value(pending).expect("intent serializes");
        }

        // Preserve a mixed legacy/new journal even when another save is made
        // inside the old C inventory wait, before any new command is accepted.
        if let Some(last) = self.legacy_until {
            presentation["input"]["inventory_browser_legacy_until"] = json!(last);
        }
    }
    pub fn view(&self) -> InventoryView {
        InventoryView {
            selected: self.selected.clone(),
            details: self.details,
        }
    }

    /// Handle keys before the C acknowledgement adapter, so Escape navigates
    /// back inside Rust instead of inadvertently dismissing the C inventory wait.
    pub fn handle(&mut self, key: i32, ui: &Value) -> Option<Input> {
        if ui["inventory"] != true {
            return None;
        }
        if let Some(selected) = &self.selected {
            if matches!(key, 27 | 13 | 32) {
                if self.details {
                    self.details = false;
                } else {
                    self.selected = None;
                }
                return Some(Input::View);
            }
            if self.details {
                return Some(Input::Ignore);
            }
            if key == 118 {
                self.details = true;
                return Some(Input::View);
            }
            if !actions(selected, ui)
                .iter()
                .any(|(candidate, _)| *candidate == key)
            {
                return Some(Input::Ignore);
            }
            self.pending = Some(Pending {
                command: key,
                item: selected["key"].as_str()?.bytes().next()?.into(),
                hand: match descriptor(selected)["equipped"].as_str() {
                    Some("left_ring") => Some(108),
                    Some("right_ring") => Some(114),
                    _ => None,
                },
                started: false,
            });
            self.selected = None;
            return Some(Input::Key(32)); // Acknowledge i, then dispatch at C's next command read.
        }
        if let Some(row) = ui["lines"].as_array()?.iter().find(|row| {
            row["selectable"] == true
                && row["key"]
                    .as_str()
                    .is_some_and(|value| value.as_bytes() == [key as u8])
        }) {
            self.selected = Some(row.clone());
            self.details = false;
            return Some(Input::View);
        }
        if matches!(key, 32 | 13 | 27) {
            None
        } else {
            Some(Input::Ignore)
        }
    }

    /// Advance only at a matching C prompt. A failed drop, cancelled direction,
    /// death, or any unexpected prompt must never leave an item letter queued.
    pub fn next_key(&mut self, presentation: &Presentation) -> Option<i32> {
        if self.pending.is_none() {
            self.pending = self.restored_pending.take();
        }
        let pending = self.pending.as_mut()?;
        let kind = presentation.input["kind"].as_str().unwrap_or("command");
        if !pending.started {
            if kind != "command" {
                self.pending = None;
                return None;
            }
            pending.started = true;
            let command = pending.command;
            if command == 84 {
                self.pending = None;
            }
            return Some(command);
        }
        if kind == "direction" && matches!(pending.command, 116 | 122) {
            return None;
        }
        let key = if kind == "item" && pending.command != 82 {
            presentation
                .lines
                .iter()
                .any(|row| {
                    row["scope"] == "choices"
                        && row["args"][0]["value"].as_i64() == Some(i64::from(pending.item))
                })
                .then_some(pending.item)
        } else if kind == "hand" && pending.command == 82 {
            pending.hand
        } else {
            None
        };
        self.pending = None;
        key
    }
    pub fn accepted(&mut self, key: i32) {
        if key == 27 {
            self.pending = None;
        }
    }
}
