//! Phone title screen. Screen ownership and all actions remain in the controller.
use super::*;

impl BrowserUi {
    pub(super) fn draw_mobile_top(&mut self) {
        let width = (self.width - 48.).min(480.);
        let x = (self.width - width) / 2.;
        let viewport = Rect::new(0., 76., self.width, (self.height - 88.).max(1.));
        let busy = b(&self.model["starting"]) || b(&self.model["savePending"]);
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
            self.wrap(&notice_text, width - 24., 17.).len() as f64 * 26. + 24.
        } else {
            0.
        };
        let content_height = 482.
            + if notice.is_object() {
                notice_height + 12.
            } else {
                0.
            };
        let offset = ((viewport.h - content_height) / 2.).clamp(0., 48.);
        let max = (content_height + offset - viewport.h).max(0.);
        self.regions.insert(
            "top".into(),
            Region {
                rect: viewport,
                max,
            },
        );
        self.scrolls
            .insert("top".into(), clamp(self.scrolls["top"], 0., max));
        let mut y = viewport.y + offset - self.scrolls["top"];
        self.widgets.begin_clip(viewport);
        self.widgets.single_line(
            "ROGUE",
            Rect::new(x, y, width, 60.),
            LineStyle {
                text: TextStyle::new(46., TEXT, true),
                center: true,
                ellipsis: false,
            },
            self.measure,
        );
        y += 60.;
        y += 8.;
        self.text(&self.t("top.title"), x, y, width, 24., TEXT, true);
        y += 38.;
        for id in ["name", "seed"] {
            self.text(
                &self.t(&format!("form.{id}")),
                x,
                y,
                width,
                17.,
                MUTED,
                false,
            );
            y += 28.;
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
            y += 60.;
        }
        y += 8.;
        self.button(
            "new-game",
            &self.t("action.new"),
            Rect::new(x, y, width, 56.),
            ControlStyle {
                primary: true,
                size: 19.,
                disabled: busy || !b(&self.model["ready"]),
                ..Default::default()
            },
        );
        y += 68.;
        self.button(
            "load",
            &self.t("action.load"),
            Rect::new(x, y, width, 52.),
            ControlStyle {
                size: 17.,
                disabled: busy || !b(&self.model["saved"]),
                ..Default::default()
            },
        );
        y += 64.;
        self.button(
            "credits-repository",
            &self.t("credits.repository"),
            Rect::new(x, y, width, 48.),
            ControlStyle {
                size: 17.,
                ..Default::default()
            },
        );
        y += 60.;
        if notice.is_object() {
            self.widgets
                .box_rect(Rect::new(x, y, width, notice_height), PANEL, Some(LINE), 9.);
            self.text(
                &notice_text,
                x + 12.,
                y + 12.,
                width - 24.,
                17.,
                if b(&notice["error"]) { ERROR } else { MUTED },
                false,
            );
        }
        self.widgets.end_clip();
        self.widgets
            .scrollbar(viewport, content_height + offset, self.scrolls["top"]);
    }
}
