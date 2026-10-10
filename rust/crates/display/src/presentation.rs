//! Presentation history belongs to Rust and never enters C rules or RNG.
use crate::display;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Presentation {
    pub lines: Vec<Value>,
    pub input: Value,
    pub history: Vec<Value>,
    pub last_message: Option<Value>,
}

impl Presentation {
    pub fn movement_direction(&self) -> bool {
        self.input["kind"] == "direction"
            && self
                .lines
                .iter()
                .any(|line| line["scope"] == "throw_direction")
    }

    pub fn update(
        &mut self,
        scope: &str,
        row: i32,
        col: i32,
        id: &str,
        args: Value,
        fallback: &str,
    ) {
        if row == -1 {
            self.lines.retain(|line| line["scope"] != scope);
            if scope == "input" {
                self.input = json!({"kind":"command"});
            }
            return;
        }
        if row == -2 {
            let kind = match id {
                "input.wait_space" | "input.close" | "input.next_page" | "input.next_message"
                | "input.results" => "space",
                "input.next_item" => "space_cancel",
                "input.wait_enter"
                | "input.finish_game"
                | "input.results_enter"
                | "input.show_score" => "enter",
                "input.choose_item" => "item",
                "input.choose_direction" | "input.throw_direction" => "direction",
                "input.option_bool" => "option_bool",
                "input.option_inventory" => "option_inventory",
                "input.help" => "help",
                "input.symbol" => "symbol",
                "input.discovery" => "discovery",
                "input.confirm" => "confirm",
                "input.hand" => "hand",
                "input.inventory_one" => "item",
                _ => "command",
            };
            self.input = json!({"kind":kind,"id":id,"args":args,"fallback":fallback,"row":col});
            return;
        }
        if !(0..128).contains(&row) || !(0..256).contains(&col) {
            return;
        }
        self.lines
            .retain(|line| !(line["scope"] == scope && line["row"] == row && line["col"] == col));
        if self.lines.len() >= 256 {
            self.lines.remove(0);
        }
        self.lines.push(
            json!({"scope":scope,"row":row,"col":col,"id":id,"args":args,"fallback":fallback}),
        );
    }

    pub fn remember(&mut self, event: Value) {
        if event["id"] == "message.clear" {
            self.last_message = None;
            return;
        }
        if !event["fallback"].as_str().unwrap_or("").is_empty() {
            self.history.push(event.clone());
            if self.history.len() > 32 {
                self.history.remove(0);
            }
        }
        self.last_message = Some(event);
    }

    pub fn resolve_recall(&self, id: &str, args: &mut Value, fallback: &str) {
        // Ctrl+P refers to a previously emitted semantic event. This lookup is
        // provenance from that event, not a dictionary of English sentences.
        if id != "command.command.string" {
            return;
        }
        let Some(array) = args.as_array_mut() else {
            return;
        };
        for arg in array {
            let text = if arg["kind"] == "string" {
                arg["value"].as_str()
            } else if arg["kind"] == "entity"
                && arg["value"]["type"] == "message"
                && arg["value"]["id"] == "message.legacy"
            {
                Some(fallback)
            } else {
                None
            };
            let Some(text) = text else {
                continue;
            };
            if let Some(event) = self.history.iter().rev().find(|event| {
                event["fallback"]
                    .as_str()
                    .is_some_and(|previous| previous.eq_ignore_ascii_case(text))
            }) {
                *arg = json!({"kind":"entity","value":{"type":"message","id":event["id"],"args":event["args"]}});
            }
        }
    }

    fn translated(line: &Value, language: &str, name: &str) -> Value {
        let mut args = line["args"].clone();
        crate::identity::replace_player_names(&mut args, name);
        let result = display::message_language(
            line["id"].as_str().unwrap_or("ui.invalid"),
            &args,
            line["fallback"].as_str().unwrap_or(""),
            language,
        );
        let mut value = line.clone();
        value["text"] = Value::String(result.text);
        value["fallback_used"] = Value::Bool(!result.missing_ids.is_empty());
        value["missing_ids"] = json!(result.missing_ids);
        value
    }

    pub fn render(&self, language: &str, name: &str) -> Value {
        let mut lines = Vec::new();
        let mut status = Value::Null;
        let mut more = Value::Null;
        let mut missing = Vec::new();
        let mut mode = "game";
        let inventory = self.lines.iter().any(|line| line["scope"] == "browse");
        let item_action = self
            .lines
            .iter()
            .find(|line| line["scope"] == "item_action")
            .and_then(|line| line["id"].as_str());
        for line in &self.lines {
            if matches!(
                line["scope"].as_str(),
                Some("browse" | "status_message" | "throw_direction" | "item_action")
            ) {
                continue;
            }
            if line["scope"] == "choices" && self.input["kind"] != "item" {
                continue;
            }
            if line["scope"] == "choices"
                && !crate::inventory::choice_visible(line, item_action, &self.lines)
            {
                continue;
            }
            let mut value = Self::translated(line, language, name);
            if (line["scope"] == "choices" || line["scope"] == "inventory")
                && line["id"] == "ui.inventory.entry"
                && let Some(key) = line["args"][0]["value"]
                    .as_u64()
                    .filter(|key| (32..127).contains(key))
            {
                value["key"] = Value::String(char::from(key as u8).to_string());
                value["selectable"] = Value::Bool(true);
            }
            if let Some(ids) = value["missing_ids"].as_array() {
                missing.extend(ids.iter().cloned());
            }
            match line["scope"].as_str().unwrap_or("") {
                "game"
                    if matches!(
                        line["id"].as_str(),
                        Some("ui.detect_magic" | "ui.detect_food" | "ui.level_map")
                    ) =>
                {
                    mode = "detection";
                    lines.push(value);
                }
                "status" => status = value,
                "more" => more = value,
                "inventory" => {
                    mode = "menu";
                    lines.push(value);
                }
                "menu" | "help" | "options" | "death" | "tombstone" | "score" | "victory" => {
                    mode = line["scope"].as_str().unwrap_or("game");
                    lines.push(value);
                }
                _ => lines.push(value),
            }
        }
        lines.sort_by_key(|line| {
            (
                line["row"].as_i64().unwrap_or(0),
                line["col"].as_i64().unwrap_or(0),
            )
        });
        let mut input = self.input.clone();
        let movement_direction = self.movement_direction();
        if movement_direction {
            input["id"] = json!("input.throw_direction");
        }
        if let Some(id) = input["id"].as_str() {
            let result = display::message_language(
                id,
                &input["args"],
                input["fallback"].as_str().unwrap_or(""),
                language,
            );
            missing.extend(
                result
                    .missing_ids
                    .iter()
                    .map(|id| Value::String(id.clone())),
            );
            input["text"] = Value::String(result.text);
        }
        if input.is_null() {
            input = json!({"kind":"command"});
        }
        let message = self
            .last_message
            .as_ref()
            .map(|event| Self::translated(event, language, name));
        if let Some(event) = &message
            && let Some(ids) = event["missing_ids"].as_array()
        {
            missing.extend(ids.iter().cloned());
        }
        if inventory {
            mode = "menu";
        }
        let mut ui = json!({"mode":mode,"inventory":inventory,"movement_direction":movement_direction,"lines":lines,"status":status,"more":more,"name":name,"input":input,"message":message,
            "fallback_used":!missing.is_empty(),"missing_ids":missing});
        ui["window"] = crate::game_window::render(&ui, language);
        ui
    }
}
