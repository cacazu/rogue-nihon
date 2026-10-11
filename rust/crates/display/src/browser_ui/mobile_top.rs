//! Phone title screen. Screen ownership and all actions remain in the controller.
use super::*;

impl BrowserUi {
    pub(super) fn draw_mobile_top(&mut self) {
        let landscape = self.width > self.height;
        let width = if landscape {
            ((self.width - 72.) / 2.).min(480.)
        } else {
            (self.width - 48.).min(480.)
        };
        let gap = 24.;
        let total = if landscape { width * 2. + gap } else { width };
        let x = (self.width - total) / 2.;
        let viewport = Rect::new(0., 64., self.width, (self.height - 72.).max(1.));
        let busy = b(&self.model["starting"]) || b(&self.model["savePending"]);
        let content_height = if landscape { 200. } else { 404. };
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
        let action_x = if landscape { x + width + gap } else { x };
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
        let mut y = y0 + if landscape { 0. } else { 40. };
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
        self.dropdown_control("language", Rect::new(x, y, width, 48.), busy);
        y += 54.;
        if landscape {
            y = y0 + 40.;
        }
        for (id, label) in [
            ("new-game", "action.new"),
            ("load", "action.load"),
            ("credits-repository", "credits.repository"),
        ] {
            self.button(
                id,
                &self.t(label),
                Rect::new(action_x, y, width, 48.),
                ControlStyle {
                    primary: id == "new-game",
                    size: 17.,
                    disabled: if id == "new-game" {
                        busy || !b(&self.model["ready"])
                    } else if id == "load" {
                        busy || !b(&self.model["saved"])
                    } else {
                        false
                    },
                    ..Default::default()
                },
            );
            y += 54.;
        }
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
