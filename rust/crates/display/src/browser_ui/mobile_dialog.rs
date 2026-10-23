//! Shared dialog choices own button labels and their keyboard shortcuts.
use super::*;

pub(super) struct DialogChoice {
    pub key: u32,
    pub label: String,
    pub shortcut: Option<String>,
}

impl BrowserUi {
    fn dialog_action_label(
        &self,
        ui: &Value,
        window: &Value,
        action: &Value,
    ) -> String {
        let kind = s(&ui["input"]["kind"]);
        let option = matches!(kind, "option_bool" | "option_inventory");
        let id = match n(&action["key"]) as u32 {
            27 if matches!(
                s(&window["kind"]),
                "inventory_actions" | "inventory_details"
            ) =>
            {
                "mobile.dialog.back"
            }
            27 if option => "mobile.dialog.finish",
            27 if matches!(kind, "space" | "space_cancel") => "mobile.dialog.close",
            27 => "action.cancel_short",
            13 if option => "mobile.dialog.keep",
            45 if option => "mobile.dialog.back",
            42 => "mobile.dialog.all_button",
            121 if kind == "confirm" => "mobile.dialog.yes",
            110 if kind == "confirm" => "mobile.dialog.no",
            108 if kind == "hand" => "mobile.dialog.left_hand",
            114 if kind == "hand" => "mobile.dialog.right_hand",
            _ => return s(&action["text"]).to_string(),
        };
        self.t(id)
    }
    pub(super) fn dialog_choices(&self, ui: &Value, window: &Value) -> Vec<DialogChoice> {
        let back = matches!(s(&window["kind"]), "inventory_actions" | "inventory_details");
        let ending = matches!(s(&ui["mode"]), "death" | "tombstone" | "score" | "victory");
        array(&window["actions"]).iter().filter(|action| {
            let key = n(&action["key"]) as u32;
            !(key == 27 && !back || key == 32 && (ui["input"]["id"] == "input.close" || b(&ui["inventory"])))
        }).enumerate().map(|(index, action)| {
            let key = n(&action["key"]) as u32;
            let label = if ending && ui["input"]["id"] == "input.finish_game" {
                self.t("action.return_top")
            } else { self.dialog_action_label(ui, window, action) };
            let shortcut = if back || matches!(s(&ui["input"]["kind"]), "confirm" | "hand" | "option_bool" | "option_inventory") {
                self.choice_shortcut(index)
            } else {
                self.pc_shortcut(&match key {
                    13 => "Enter".into(), 27 => "Escape".into(),
                    _ => char::from_u32(key).map(|key| key.to_string()).unwrap_or_default(),
                })
            };
            DialogChoice { key, label, shortcut }
        }).collect()
    }

    pub(super) fn dialog_close_label(&self, ui: &Value, window: &Value) -> String {
        self.t(if matches!(s(&ui["mode"]), "death" | "tombstone" | "score" | "victory") {
            "action.return_top"
        } else if matches!(s(&window["kind"]), "inventory_actions" | "inventory_details") {
            "mobile.dialog.back"
        } else if matches!(s(&ui["input"]["kind"]), "option_bool" | "option_inventory") {
            "mobile.dialog.finish"
        } else if matches!(s(&ui["input"]["kind"]), "space" | "space_cancel") {
            "mobile.dialog.close"
        } else { "action.cancel_short" })
    }

    // Semantic prompt IDs are projected for the Web UI; literal item/player
    // names are data and are never searched for or rewritten as keyboard hints.
    pub(super) fn rewrite_dialog_message(&self, message: &mut Value, depth: usize) -> bool {
        if depth > 16 { return false; }
        if matches!(s(&message["id"]), "pack.get_item.for_list" | "things.discovered.for_all") {
            message["id"] = json!("ui.text");
            message["args"] = json!([{"kind":"string","value":if self.model["language"] == "ja" { "？" } else { "?" }}]);
            message["fallback"] = json!("");
            return true;
        }
        let id = match s(&message["id"]) {
            "command.help.character_you_want_help_for_for_all" => Some("dialog.question.help"),
            "main.quit.really_quit" => Some("dialog.question.quit"),
            "rings.gethand.left_hand_or_right_hand" => Some("dialog.question.hand"),
            "rings.gethand.left_or_right_ring" => Some("dialog.question.ring"),
            "save.save_game.file_exists_do_you_wish_to_overwrite_it" => Some("dialog.question.overwrite"),
            "save.save_game.save_file" => Some("dialog.question.save_file"),
            _ => None,
        };
        if let Some(id) = id {
            let text = if id == "dialog.question.save_file" {
                let file = crate::display::message_language("message.entity", &json!([message["args"][0]]), "", s(&self.model["language"])).text;
                self.label(id, &json!({"file":file}))
            } else { self.t(id) };
            message["id"] = json!("ui.text");
            message["args"] = json!([{"kind":"string","value":text}]);
            message["fallback"] = json!("");
            return true;
        }
        let mut changed = false;
        if let Some(args) = message["args"].as_array_mut() {
            for arg in args {
                if matches!(s(&arg["kind"]), "message_part" | "part")
                    || arg["kind"] == "entity" && arg["value"]["type"] == "message" {
                    changed |= self.rewrite_dialog_message(&mut arg["value"], depth + 1);
                }
            }
        }
        changed
    }

    pub(super) fn dialog_message_text(&self, message: &Value) -> String {
        let mut projected = message.clone();
        if self.rewrite_dialog_message(&mut projected, 0) {
            crate::display::message_language(s(&projected["id"]), &projected["args"], "", s(&self.model["language"])).text
        } else { s(&message["text"]).to_string() }
    }

}
