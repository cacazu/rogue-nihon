//! Shared settings rows for phone and desktop, using existing controller actions.
use super::*;

impl BrowserUi {
    pub(super) fn draw_settings(&mut self, game: Rect) {
        self.begin_choices("settings");
        self.regions.clear();
        self.map_rect = None;
        self.widgets.rect(game, "@overlay.strong");
        let w = (self.width - 16.).min(540.);
        let x = (self.width - w) / 2.;
        let inner = w - 32.;
        let half = (inner - 8.) / 2.;
        let top_label = self.t("action.top");
        let quit_label = self.t("mobile.quit_score");
        let visible_top = Widgets::shortcut_label(&top_label, self.choice_shortcut(6).as_deref());
        let visible_quit = Widgets::shortcut_label(&quit_label, self.choice_shortcut(7).as_deref());
        let top_width = visible_top.split('\n')
            .map(|line| (self.measure)(line, 17., false, false).width + 12.)
            .fold(half, f64::max)
            .min((inner - 8. - (self.measure)(&visible_quit, 17., false, false).width - 12.).max(half));
        let return_height = (self.wrap(&visible_top, top_width - 12., 17.).len() as f64 * 17. * 1.6 + 8.).max(56.);
        let notice = array(&self.model["entries"]).iter()
            .rfind(|e| e["source"] == "system")
            .filter(|e| b(&e["error"]) || matches!(s(&e["id"]), "notice.saved" | "notice.save_pending" | "notice.save_cancelled"))
            .map(|e| s(&e["text"]).to_string());
        let notice_height = notice.as_ref().map_or(0., |text|
            12. + self.wrap(text, inner, 17.).len() as f64 * 17. * 1.6);
        let total = 48. + 12. + 48. + 12. + 48. + 12. + 48. + 12. + 48. + 12. + return_height + notice_height;
        let (panel, viewport) = self.sheet_layout(w, total);
        let max = (total - viewport.h).max(0.);
        let scroll = clamp(self.scrolls["settings"], 0., max);

        self.widgets.box_rect(panel, PANEL, Some(LINE), 0.);
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
                shortcut: self.pc_shortcut("Escape"),
                ..Default::default()
            },
        );
        let mut row = viewport.y - scroll;
        let busy = b(&self.model["starting"])
            || b(&self.model["savePending"])
            || b(&self.model["returnAfterEnd"]);
        let stopped = busy || !b(&self.model["running"]);
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
                shortcut: self.choice_shortcut(0),
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
                shortcut: self.choice_shortcut(1),
                ..Default::default()
            },
        );
        row += 60.;
        let animated = self.model["animationEnabled"].as_bool().unwrap_or(true);
        let label = self.t("settings.animation");
        let state_label = self.t(if animated { "settings.on" } else { "settings.off" });
        self.widgets.switch(
            "animation-toggle",
            &label,
            &state_label,
            Rect::new(viewport.x, row, viewport.w, 48.),
            json!({"kind":"invoke","id":"animation-toggle"}),
            animated,
            busy,
            self.choice_shortcut(2),
            self.measure,
        );
        row += 60.;
        let left_handed = self.model["handedness"] == "left";
        self.widgets.switch(
            "handedness-toggle",
            &self.t("settings.handedness"),
            &self.t(if left_handed { "settings.left" } else { "settings.right" }),
            Rect::new(viewport.x, row, viewport.w, 48.),
            json!({"kind":"invoke","id":"handedness-toggle"}),
            !left_handed,
            busy,
            self.choice_shortcut(3),
            self.measure,
        );
        row += 60.;
        self.settings_dropdown("theme", "settings.theme", Rect::new(viewport.x, row, viewport.w, 48.), busy);
        row += 60.;
        self.settings_dropdown("display-mode", "settings.display_mode", Rect::new(viewport.x, row, viewport.w, 48.), busy);
        row += 60.;
        let shortcuts: Vec<_> = (0..8).map(|index| self.choice_shortcut(index)).collect();
        let style = |disabled, index: usize| ControlStyle {
            size: 17.,
            role: ControlRole::Command,
            disabled,
            shortcut: shortcuts[index].clone(),
            keep_offscreen: true,
            ..Default::default()
        };
        self.button(
            "settings-top",
            &top_label,
            Rect::new(viewport.x, row, top_width, return_height),
            style(busy, 6),
        );
        self.control(
            "mobile-system-81",
            &quit_label,
            Rect::new(viewport.x + top_width + 8., row, viewport.w - top_width - 8., return_height),
            json!({"kind":"send","key":81}),
            style(stopped, 7),
        );
        row += return_height;
        if let Some(notice) = notice {
            row += 12.;
            self.text(&notice, viewport.x, row, viewport.w, 17., ACCENT, false);
        }
        self.widgets.end_clip();

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
    fn settings_dropdown(&mut self, id: &str, label_id: &str, row: Rect, disabled: bool) {
        let label = self.t(label_id);
        let label_width = (self.measure)(&label, 17., false, false).width;
        let width = self.dropdown_width(id).min(row.w - label_width - 8.);
        self.widgets.single_line(&label, Rect::new(row.x, row.y, label_width, row.h),
            LineStyle { text: TextStyle::new(17., TEXT, false), center: false, ellipsis: false }, self.measure);
        self.dropdown_control(id, Rect::new(row.x + row.w - width, row.y, width, row.h), disabled);
    }

}
