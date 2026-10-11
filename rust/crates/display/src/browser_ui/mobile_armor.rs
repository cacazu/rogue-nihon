//! Consecutive armor commands, forwarding the original take-off and wear keys.
use super::*;

impl BrowserUi {
    pub(super) fn mobile_armor_controls(&mut self, rect: Rect) {
        let enabled =
            b(&self.model["running"]) && self.model["frame"]["ui"]["input"]["kind"] == "command";
        let width = (rect.w - 8.) / 2.;
        for (index, key, label) in [
            (0, 84, "mobile.armor_take_off"),
            (1, 87, "mobile.armor_wear"),
        ] {
            self.control(
                &format!("mobile-op-{key}"),
                &self.t(label),
                Rect::new(rect.x + index as f64 * (width + 8.), rect.y, width, rect.h),
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
}
