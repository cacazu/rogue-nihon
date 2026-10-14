//! Shared PC and phone title screen. Screen ownership and all actions remain in the controller.
use super::*;

impl BrowserUi {
    pub(super) fn draw_mobile_top(&mut self) {
        let width = (self.width - 48.).min(480.);
        let total = width;
        let x = (self.width - total) / 2.;
        let viewport = Rect::new(0., 64., self.width, (self.height - 72.).max(1.));
        let busy = b(&self.model["starting"]) || b(&self.model["savePending"]);
        let section_gap = 24.;
        let content_height = 350. + section_gap;
        let notice = if b(&self.model["topNotice"]["error"]) {
            self.model["topNotice"].clone()
        } else {
            Value::Null
        };
        let notice_text = if notice.is_object() {
            self.label(s(&notice["id"]), &notice["args"])
        } else {
            String::new()
        };
        let notice_height = if notice.is_object() {
            self.wrap(&notice_text, total, 17.).len() as f64 * 26. + 12.
        } else {
            0.
        };
        let height = content_height + notice_height;
        let max = (height - viewport.h).max(0.);
        self.regions.insert(
            "top".into(),
            Region {
                rect: viewport,
                max,
            },
        );
        self.scrolls
            .insert("top".into(), clamp(self.scrolls["top"], 0., max));
        let y0 = viewport.y + ((viewport.h - height) / 2.).clamp(0., 48.) - self.scrolls["top"];
        self.widgets.begin_clip(viewport);
        let action_x = x;
        self.widgets.single_line(
            "ROGUE",
            Rect::new(action_x, y0, width, 36.),
            LineStyle {
                text: TextStyle::new(30., TEXT, true),
                center: true,
                ellipsis: false,
            },
            self.measure,
        );
        let mut y = y0 + 40.;
        for id in ["name", "seed"] {
            self.text(
                &self.t(&format!("mobile.form.{id}")),
                x,
                y,
                width,
                17.,
                MUTED,
                false,
            );
            y += 22.;
            self.field(id, Rect::new(x, y, width - 104., 48.), busy);
            self.button(
                &format!("random-{id}"),
                &self.t("action.random"),
                Rect::new(x + width - 96., y, 96., 48.),
                ControlStyle {
                    size: 17.,
                    disabled: busy,
                    ..Default::default()
                },
            );
            y += 54.;
        }
        self.button(
            "new-game",
            &self.t("action.new"),
            Rect::new(x, y, width, 48.),
            ControlStyle {
                primary: true,
                size: 17.,
                disabled: busy || !b(&self.model["ready"]),
                ..Default::default()
            },
        );
        y += 54. + section_gap;
        self.resume_buttons(Rect::new(action_x, y, width, 48.), busy);
        y += 54.;
        self.button(
            "credits-repository",
            &self.t("credits.repository"),
            Rect::new(action_x, y, width, 48.),
            ControlStyle {
                size: 17.,
                ..Default::default()
            },
        );
        if notice.is_object() {
            self.text(
                &notice_text,
                x,
                y0 + content_height,
                total,
                17.,
                ERROR,
                false,
            );
        }
        self.widgets.end_clip();
        self.widgets
            .scrollbar(viewport, height, self.scrolls["top"]);
    }
}
