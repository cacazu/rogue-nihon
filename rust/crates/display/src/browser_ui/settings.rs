//! Shared settings rows for phone and desktop, using existing controller actions.
use super::*;

impl BrowserUi {
    pub(super) fn draw_settings(&mut self, game: Rect) {
        self.widgets.controls.clear();
        self.regions.clear();
        self.map_rect = None;
        self.widgets.rect(game, "#0009");
        let w = (self.width - 16.).min(540.);
        let x = (self.width - w) / 2.;
        let panel = Rect::new(x, 8., w, self.height - 16.);
        self.widgets.box_rect(panel, PANEL, Some(LINE), 12.);
        self.text(
            &self.t("settings.title"),
            x + 16.,
            24.,
            w - 88.,
            22.,
            TEXT,
            true,
        );
        self.button(
            "settings-close",
            &self.t("action.close_settings"),
            Rect::new(x + w - 56., 16., 48., 48.),
            ControlStyle {
                icon: Some("close"),
                icon_size: 24.,
                ..Default::default()
            },
        );
        let viewport = Rect::new(x + 16., 76., w - 32., self.height - 104.);
        let mut row = viewport.y - self.scrolls["settings"];
        let busy = b(&self.model["starting"])
            || b(&self.model["savePending"])
            || b(&self.model["returnAfterEnd"]);
        let stopped = busy || !b(&self.model["running"]);
        let half = (viewport.w - 8.) / 2.;
        self.widgets.begin_clip(viewport);
        let fullscreen = b(&self.view["fullscreen"]);
        self.button(
            "fullscreen",
            &self.t(if fullscreen {
                "action.exit_fullscreen"
            } else {
                "action.fullscreen"
            }),
            Rect::new(viewport.x, row, 48., 48.),
            ControlStyle {
                icon: Some(if fullscreen { "collapse" } else { "expand" }),
                icon_size: 26.,
                ..Default::default()
            },
        );
        self.button(
            "mobile-controls",
            &self.t(if self.mobile_controls {
                "mobile.hide_controls"
            } else {
                "mobile.show_controls"
            }),
            Rect::new(viewport.x + 56., row, 48., 48.),
            ControlStyle {
                icon: Some(if self.mobile_controls {
                    "controls-hide"
                } else {
                    "controls-show"
                }),
                icon_size: 26.,
                disabled: stopped,
                ..Default::default()
            },
        );
        self.dropdown_control(
            "display-mode",
            Rect::new(viewport.x + 112., row, viewport.w - 112., 48.),
            busy,
        );
        row += 88.;
        let style = |disabled| ControlStyle {
            size: 17.,
            disabled,
            ..Default::default()
        };
        self.button(
            "save",
            &self.t("action.save"),
            Rect::new(viewport.x, row, half, 48.),
            style(stopped),
        );
        self.button(
            "download-save",
            &self.t("action.download"),
            Rect::new(viewport.x + half + 8., row, half, 48.),
            style(busy || !b(&self.model["saved"])),
        );
        row += 60.;
        self.button(
            "import-save",
            &self.t("action.import"),
            Rect::new(viewport.x, row, viewport.w, 48.),
            style(busy),
        );
        row += 88.;
        self.button(
            "settings-top",
            &self.t("action.top"),
            Rect::new(viewport.x, row, half, 56.),
            style(busy),
        );
        self.control(
            "mobile-system-81",
            &self.t("mobile.quit_score"),
            Rect::new(viewport.x + half + 8., row, half, 56.),
            json!({"kind":"send","key":81}),
            style(stopped),
        );
        row += 96.;
        self.control(
            "mobile-system-111",
            &self.mobile_help("help.options"),
            Rect::new(viewport.x, row, viewport.w, 48.),
            json!({"kind":"send","key":111}),
            style(stopped),
        );
        row += 60.;
        let mobile = self.width < 700. || b(&self.view["coarse"]);
        // Phone settings show errors only; desktop keeps save notices too.
        if let Some(entry) = array(&self.model["entries"])
            .iter()
            .rfind(|e| e["source"] == "system")
            .filter(|e| {
                b(&e["error"])
                    || (!mobile
                        && (s(&e["id"]).starts_with("notice.saved")
                            || e["message"]["id"] == "save.browser"))
            })
        {
            let notice = s(&entry["text"]).to_string();
            row += self.text(&notice, viewport.x, row, viewport.w, 17., ACCENT, false) + 12.;
        }
        self.widgets.end_clip();
        let total = row - viewport.y + self.scrolls["settings"];
        let max = (total - viewport.h).max(0.);
        self.regions.insert(
            "settings".into(),
            Region {
                rect: viewport,
                max,
            },
        );
        self.scrolls
            .insert("settings".into(), clamp(self.scrolls["settings"], 0., max));
        self.widgets
            .scrollbar(viewport, total, self.scrolls["settings"]);
    }
}
