//! A bounded rest shortcut composed from the original command keys.
use super::*;

impl BrowserUi {
    fn mobile_rest_enabled(&self) -> bool {
        b(&self.model["running"])
            && self.model["frame"]["ui"]["input"]["kind"] == "command"
            && !s(&self.model["frame"]["map_cells"])
                .bytes()
                .any(|glyph| glyph.is_ascii_uppercase())
    }

    pub(super) fn mobile_rest_control(&mut self, rect: Rect) {
        self.control(
            "mobile-rest",
            &self.t("mobile.rest"),
            rect,
            Value::Null,
            ControlStyle {
                size: 17.,
                disabled: !self.mobile_rest_enabled(),
                ..Default::default()
            },
        );
    }

    pub(super) fn mobile_rest_activate(&mut self, effects: &mut Vec<Value>) {
        if self.mobile_rest_enabled() {
            self.mobile_operations = false;
            // Escape cancels an unfinished numeric prefix without spending a turn.
            // The existing decoder then handles "50." and its interruption rules.
            effects.push(json!({"kind":"send","keys":[27,53,48,46]}));
        }
    }
}
