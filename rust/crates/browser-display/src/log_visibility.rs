//! Transient questions belong to the active input UI, not persistent history.
//! Phone-only keyboard instructions are filtered separately at display time.
use serde_json::Value;

fn prompt_id(id: &str) -> bool {
    id.starts_with("input.") || matches!(id,
        "command.call.call_it" | "command.call.what_do_you_want_to_call_it"
        | "misc.call_it.call_it" | "misc.call_it.what_do_you_want_to_call_it"
        | "command.help.character_you_want_help_for_for_all"
        | "command.identify.what_do_you_want_identified"
        | "main.quit.really_quit"
        | "misc.get_dir.which_direction" | "prompt.direction" | "prompt.direction.short"
        | "pack.get_item.which_object_do_you_want_to" | "pack.get_item.what"
        | "pack.get_item.for_list"
        | "pack.picky_inven.item" | "pack.picky_inven.which_item_do_you_wish_to_inventory"
        | "rings.gethand.l_or_r" | "rings.gethand.left_hand_or_right_hand"
        | "rings.gethand.left_or_right_ring" | "rings.gethand.please_type_l_or_r"
        | "things.discovered.for" | "things.discovered.of_object_do_you_want_a_list"
        | "things.discovered.what_type" | "things.discovered.for_all"
        | "things.discovered.please_type_one_of_escape_to_quit"
        | "save.restore.file_name" | "save.save_game.file_name"
        | "save.save_game.file_name_plain"
        | "save.save_game.file_exists_do_you_wish_to_overwrite_it"
        | "save.save_game.save_file" | "save.save_game.please_answer_y_or_n"
        | "save.save_game.please_answer_y_or_n_capitalized"
        | "things.pr_list.for" | "things.pr_list.of_object_do_you_want_a_list"
        | "things.pr_list.question_prompt" | "things.pr_list.what_type"
        | "wizard.create_obj.blessing_n" | "wizard.create_obj.how_much"
        | "wizard.create_obj.type_of_item" | "wizard.create_obj.which_do_you_want_f"
        | "wizard.passwd.wizards_password"
    )
}

fn keyboard_id(id: &str) -> bool {
    prompt_id(id) || matches!(id,
        "command.help.string_string" | "command.help.unknown_character"
        | "ui.continue" | "ui.more" | "ui.close" | "ui.level_map"
        | "ui.ending.return" | "ui.ending.space" | "ui.help.entry"
        | "help.run" | "help.run_adjacent" | "help.fight_carefully"
        | "help.throw" | "help.move_without_pickup" | "help.zap"
        | "help.trap" | "help.fight_to_death"
        | "options.hint.bool" | "options.hint.inventory"
        | "inventory.choose" | "inventory.back_hint"
        | "window.cancel" | "window.all" | "window.yes" | "window.no"
        | "window.keep" | "window.back" | "window.finish"
        | "window.left_hand" | "window.right_hand"
    )
}

fn contains_id(message: &Value, matches_id: fn(&str) -> bool, depth: usize) -> bool {
    if depth > 16 { return false; }
    if matches_id(message["id"].as_str().unwrap_or("")) { return true; }
    message["args"].as_array().is_some_and(|args| args.iter().any(|arg| {
        match arg["kind"].as_str().unwrap_or("") {
            "message_part" | "part" => contains_id(&arg["value"], matches_id, depth + 1),
            "entity" if matches!(arg["value"]["type"].as_str(), Some("message" | "term")) => {
                contains_id(&arg["value"], matches_id, depth + 1)
            }
            "term" => matches_id(arg["value"].as_str().unwrap_or("")),
            // Item/player names and other literal strings are gameplay data.
            _ => false,
        }
    }))
}

pub(crate) fn interaction_prompt(message: &Value) -> bool {
    contains_id(message, prompt_id, 0)
}

pub(crate) fn keyboard_hint(message: &Value) -> bool {
    contains_id(message, keyboard_id, 0)
}


/// Removed system guidance also stays hidden in recalled and restored semantic messages.
pub(crate) fn removed_guidance(message: &Value) -> bool {
    contains_id(message, |id| matches!(id, "save.browser" | "help.save"), 0)
}
