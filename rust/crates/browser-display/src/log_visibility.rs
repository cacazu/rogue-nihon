//! Keyboard instructions are filtered at display time; original history is kept.
use serde_json::Value;

fn keyboard_id(id: &str) -> bool {
    matches!(id,
        // Prompts assembled by C with msg/addmsg, including terse variants.
        "command.help.character_you_want_help_for_for_all"
        | "command.help.string_string"
        | "command.help.unknown_character"
        | "command.identify.what_do_you_want_identified"
        | "main.quit.really_quit"
        | "misc.get_dir.which_direction"
        | "prompt.direction" | "prompt.direction.short"
        | "pack.get_item.for_list"
        | "pack.picky_inven.item"
        | "pack.picky_inven.which_item_do_you_wish_to_inventory"
        | "rings.gethand.l_or_r"
        | "rings.gethand.left_hand_or_right_hand"
        | "rings.gethand.left_or_right_ring"
        | "rings.gethand.please_type_l_or_r"
        | "things.discovered.for_all"
        | "things.discovered.please_type_one_of_escape_to_quit"
        // Original terminal save/debug prompts have no phone input controls.
        | "save.restore.file_name"
        | "save.save_game.file_name"
        | "save.save_game.file_name_plain"
        | "save.save_game.file_exists_do_you_wish_to_overwrite_it"
        | "save.save_game.save_file"
        | "save.save_game.please_answer_y_or_n"
        | "save.save_game.please_answer_y_or_n_capitalized"
        | "things.pr_list.for"
        | "things.pr_list.of_object_do_you_want_a_list"
        | "things.pr_list.question_prompt"
        | "things.pr_list.what_type"
        | "wizard.create_obj.blessing_n"
        | "wizard.create_obj.how_much"
        | "wizard.create_obj.type_of_item"
        | "wizard.create_obj.which_do_you_want_f"
        | "wizard.passwd.wizards_password"
        // These usually belong to windows, but can also arrive as messages.
        | "input.wait_space" | "input.wait_enter"
        | "input.option_bool" | "input.option_inventory"
        | "input.choose_item" | "input.choose_direction" | "input.throw_direction"
        | "input.help" | "input.symbol" | "input.discovery" | "input.confirm"
        | "input.inventory_one" | "input.show_score" | "input.close"
        | "input.next_page" | "input.next_item" | "input.next_message"
        | "input.results" | "input.finish_game" | "input.results_enter" | "input.hand"
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

pub(crate) fn keyboard_hint(message: &Value) -> bool {
    fn visit(message: &Value, depth: usize) -> bool {
        if depth > 16 { return false; }
        if keyboard_id(message["id"].as_str().unwrap_or("")) { return true; }
        message["args"].as_array().is_some_and(|args| args.iter().any(|arg| {
            match arg["kind"].as_str().unwrap_or("") {
                "message_part" | "part" => visit(&arg["value"], depth + 1),
                "entity" if matches!(arg["value"]["type"].as_str(), Some("message" | "term")) => {
                    visit(&arg["value"], depth + 1)
                }
                "term" => keyboard_id(arg["value"].as_str().unwrap_or("")),
                // A literal name containing keys or instruction-like words is
                // still gameplay content, not a keyboard instruction.
                _ => false,
            }
        }))
    }
    visit(message, 0)
}
