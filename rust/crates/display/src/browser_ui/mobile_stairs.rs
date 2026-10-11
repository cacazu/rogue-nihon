//! One primary stair command selected from the original player's flag projection.
use super::*;

impl BrowserUi {
    pub(super) fn mobile_stair_controls(&mut self, rect: Rect, key: u32) {
        let enabled =
            b(&self.model["running"]) && self.model["frame"]["ui"]["input"]["kind"] == "command";
        let (id, label) = if key == 60 {
            ("touch-ascend", "mobile.ascend")
        } else {
            ("touch-action-action.descend", "action.descend_short")
        };
        self.control(
            id,
            &self.t(label),
            rect,
            json!({"kind":"send","key":key}),
            ControlStyle {
                size: 17.,
                key: Some(json!(key)),
                disabled: !enabled,
                ..Default::default()
            },
        );
    }
}
