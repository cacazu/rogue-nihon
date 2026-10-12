//! The two distinct title-screen restore sources share one row.
use super::*;

impl BrowserUi {
    pub(super) fn resume_buttons(&mut self, row: Rect, busy: bool) {
        let gap = 8.;
        let width = (row.w - gap) / 2.;
        for (index, (id, label)) in [
            ("load", "action.continue"),
            ("import-save", "action.save_file"),
        ]
        .into_iter()
        .enumerate()
        {
            self.button(
                id,
                &self.t(label),
                Rect::new(row.x + index as f64 * (width + gap), row.y, width, row.h),
                ControlStyle {
                    size: 17.,
                    disabled: busy
                        || !b(&self.model["ready"])
                        || (id == "load" && !b(&self.model["saved"])),
                    ..Default::default()
                },
            );
        }
    }
}
