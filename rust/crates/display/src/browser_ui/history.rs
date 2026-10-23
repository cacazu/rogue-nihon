//! Message history opens from the game message area without sending game input.
use super::*;

impl BrowserUi {
    pub(super) fn history_target(&mut self, rect: Rect) {
        self.widgets.hit_target(
            "history-open",
            &self.t("mobile.log"),
            rect,
            json!({"kind":"history","open":true}),
        );
    }

    pub(super) fn draw_history(&mut self) {
        self.begin_choices("history");
        self.regions.clear();
        self.map_rect = None;
        self.widgets
            .rect(Rect::new(0., 0., self.width, self.height), "@overlay.strong");
        let width = (self.width - 16.).min(720.);
        let (_, total) = self.log_rows(width - 36.);
        let (panel, viewport) = self.sheet_layout(width, total + 60.);
        let x = panel.x;
        self.widgets.box_rect(
            panel,
            PANEL,
            Some(LINE),
            0.,
        );
        self.text(
            &self.t("mobile.log"),
            x + 16.,
            24.,
            width - 88.,
            22.,
            TEXT,
            true,
        );
        self.control(
            "history-close",
            &self.t("action.cancel_short"),
            Rect::new(x + width - 56., 16., 48., 48.),
            json!({"kind":"history","open":false}),
            ControlStyle {
                icon: Some("close"),
                icon_size: 24.,
                shortcut: self.pc_shortcut("Escape"),
                ..Default::default()
            },
        );
        self.draw_log(Rect::new(x + 8., viewport.y, width - 16., viewport.h));
    }
}
