//! Touch button labels replace keyboard hints; original rows and actions stay intact.
use super::*;

impl BrowserUi {
    pub(super) fn mobile_dialog_action(
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
}
