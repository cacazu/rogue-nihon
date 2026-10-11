//! Rust owns game dialogs and their semantic actions. Canvas paints this view and dispatches its actions.
use crate::display;
use serde_json::{Value, json};

fn text(id: &str, language: &str) -> String {
    display::message_language(id, &json!([]), "", language).text
}

/// Controls for the observed map and current prompt, with no hidden-world queries.
pub fn map_controls(ui: &Value, on_stairs: bool) -> Value {
    let throwing = ui["movement_direction"] == true;
    let command = ui["input"]["kind"] == "command";
    if !ui["window"].is_null() || ui["mode"] != "game" || (!command && !throwing) {
        return json!({"directions":[],"actions":[],"stairs":{"ascend":false,"descend":false}});
    }
    let mut directions = Vec::new();
    for (index, (key, label)) in [
        (121, "↖"),
        (107, "↑"),
        (117, "↗"),
        (104, "←"),
        (46, "·"),
        (108, "→"),
        (98, "↙"),
        (106, "↓"),
        (110, "↘"),
    ]
    .into_iter()
    .enumerate()
    {
        if throwing && key == 46 {
            continue;
        }
        directions.push(json!({"key":key,"text":label,"row":index/3,"column":index%3}));
    }
    let mut actions = if throwing {
        vec![(27, "action.cancel")]
    } else {
        vec![(105, "action.inventory"), (63, "action.help")]
    };
    let descend = command && on_stairs && ui["player_state"]["levitating"] != true;
    let ascend = descend && ui["player_state"]["amulet"] == true;
    if ascend {
        actions.push((60, "mobile.ascend"));
    } else if descend {
        actions.push((62, "action.descend"));
    }
    json!({"directions":directions,"stairs":{"ascend":ascend,"descend":descend},"actions":actions.into_iter().map(|(key,id)|
        json!({"key":key,"id":id})).collect::<Vec<_>>()})
}

#[cfg(test)]
mod stair_tests {
    use super::*;
    use crate::player_state::PlayerState;
    use rogue_contract::{RG_FLAG_AMULET, RG_FLAG_LEVITATING};

    #[test]
    fn stair_choices_follow_original_flags_and_observed_footing() {
        for (flags, on_stairs, primary, ascend, descend) in [
            (0, true, Some(62), false, true),
            (RG_FLAG_AMULET, true, Some(60), true, true),
            (0, false, None, false, false),
            (RG_FLAG_AMULET, false, None, false, false),
            (RG_FLAG_LEVITATING, true, None, false, false),
            (
                RG_FLAG_AMULET | RG_FLAG_LEVITATING,
                true,
                None,
                false,
                false,
            ),
        ] {
            let mut ui = json!({"mode":"game","input":{"kind":"command"},
                "player_state":PlayerState::from_snapshot(flags)});
            let controls = map_controls(&ui, on_stairs);
            let stair_keys: Vec<_> = controls["actions"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|action| action["key"].as_u64().filter(|key| matches!(key, 60 | 62)))
                .collect();
            assert_eq!(stair_keys, primary.into_iter().collect::<Vec<_>>());
            assert_eq!(
                controls["stairs"],
                json!({"ascend":ascend,"descend":descend})
            );
            ui["input"]["kind"] = json!("item");
            assert!(
                map_controls(&ui, on_stairs)["actions"]
                    .as_array()
                    .unwrap()
                    .is_empty()
            );
            ui["input"]["kind"] = json!("command");
            ui["window"] = json!({"title":"inventory"});
            assert!(
                map_controls(&ui, on_stairs)["actions"]
                    .as_array()
                    .unwrap()
                    .is_empty()
            );
        }
    }
}

pub fn render(ui: &Value, language: &str) -> Value {
    let mode = ui["mode"].as_str().unwrap_or("game");
    let kind = ui["input"]["kind"].as_str().unwrap_or("command");
    if kind == "direction" && ui["movement_direction"] == true {
        return Value::Null;
    }
    if mode == "game"
        && matches!(kind, "command" | "ended")
        && ui["lines"].as_array().is_none_or(Vec::is_empty)
    {
        return Value::Null;
    }
    let title = match mode {
        "menu" => "window.menu",
        "detection" => "window.detection",
        "help" => "window.help",
        "options" => "window.options",
        "score" | "death" | "tombstone" | "victory" => "window.result",
        _ => match kind {
            "item" => "window.item",
            "direction" => "window.direction",
            "text" => "window.text",
            "help" => "window.help",
            "discovery" => "window.discovery",
            "confirm" => "window.confirm",
            "hand" => "window.hand",
            "symbol" => "window.symbol",
            _ => "window.game",
        },
    };
    let input_id = ui["input"]["id"].as_str().unwrap_or("");
    let (ack_action, prompt_id) = match input_id {
        "input.next_page" => ("window.next_page", "input.next_page"),
        "input.next_message" => ("window.next_message", "input.next_message"),
        "input.results" => ("window.results", "input.results"),
        _ => ("window.close", "input.close"),
    };
    let (enter_action, enter_prompt) = match input_id {
        "input.show_score" => ("window.score", "input.show_score"),
        "input.results_enter" => ("window.results", "input.results_enter"),
        _ => ("window.finish_game", "input.finish_game"),
    };
    let prompt = match kind {
        "space" => json!(text(prompt_id, language)),
        "space_cancel" => json!(text("input.next_item", language)),
        "enter" => json!(text(enter_prompt, language)),
        _ => ui["input"]["text"].clone(),
    };
    let mut actions = Vec::new();
    let mut action = |key: i32, id: &str| {
        actions.push(json!({"key":key,"text":text(id, language)}));
    };
    match kind {
        "space" => action(32, ack_action),
        "space_cancel" => {
            action(32, "window.next_item");
            action(27, "window.close");
        }
        "enter" => action(13, enter_action),
        "item" => action(27, "window.cancel"),
        "direction" => {
            for (key, arrow) in [
                (121, "↖"),
                (107, "↑"),
                (117, "↗"),
                (104, "←"),
                (108, "→"),
                (98, "↙"),
                (106, "↓"),
                (110, "↘"),
            ] {
                actions.push(json!({"key":key,"text":arrow}));
            }
            actions.push(json!({"key":27,"text":text("window.cancel", language)}));
        }
        "text" | "symbol" => action(27, "window.cancel"),
        "help" | "discovery" => {
            action(42, "window.all");
            action(27, "window.cancel");
        }
        "hand" => {
            action(108, "window.left_hand");
            action(114, "window.right_hand");
            action(27, "window.cancel");
        }
        "confirm" => {
            action(121, "window.yes");
            action(110, "window.no");
        }
        "option_bool" => {
            action(116, "options.value.true");
            action(102, "options.value.false");
            action(13, "window.keep");
            action(45, "window.back");
            action(27, "window.finish");
        }
        "option_inventory" => {
            action(111, "options.value.overlay");
            action(115, "options.value.slow");
            action(99, "options.value.clear");
            action(13, "window.keep");
            action(45, "window.back");
            action(27, "window.finish");
        }
        _ => {}
    }
    json!({"kind":mode,"title":text(title, language),"modal":kind != "ended",
        "prompt":prompt,"message":ui["message"],"actions":actions,
        "map_view":mode == "detection", "active_row":ui["input"]["row"],"key_entry":matches!(kind, "help" | "symbol" | "discovery")})
}
