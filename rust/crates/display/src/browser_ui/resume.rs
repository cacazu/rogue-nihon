//! Resume the browser's automatic save.
use super::*;

impl BrowserUi {
    pub(super) fn resume_buttons(&mut self, row: Rect, busy: bool) {
        self.button(
            "load",
            &self.t("action.continue"),
            row,
            ControlStyle {
                size: 17.,
                disabled: busy || !b(&self.model["ready"]) || !b(&self.model["saved"]),
                ..Default::default()
            },
        );
    }
}
