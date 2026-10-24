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
        let errors: Vec<_> = ["name", "seed"].iter().map(|id| self.field_error_text(id)).collect();
        let error_heights: Vec<_> = errors.iter().map(|text| if text.is_empty() { 0. } else {
            self.wrap(text, total, 17.).len() as f64 * 26. + 6.
        }).collect();
        let content_height = 404. + section_gap + error_heights.iter().sum::<f64>();
        let notice = if b(&self.model["topNotice"]["error"]) {
            self.model["topNotice"].clone()
        } else {
            Value::Null
        };
        let notice_text = if b(&self.model["loading"]) {
            self.t("notice.loading")
        } else if notice.is_object() {
            self.label(s(&notice["id"]), &notice["args"])
        } else {
            String::new()
        };
        let notice_height = if !notice_text.is_empty() {
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
        for (index, id) in ["name", "seed"].iter().enumerate() {
            let label = self.t(&format!("mobile.form.{id}"));
            self.widgets.single_line(&label, Rect::new(x, y, width, 22.),
                LineStyle { text:TextStyle::new(17., MUTED, false), center:false, ellipsis:true }, self.measure);
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
            if error_heights[index] > 0. {
                self.text(&errors[index], x, y, total, 17., ERROR, false);
                y += error_heights[index];
            }
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
        self.rankings_button(Rect::new(action_x, y, width, 48.), busy);
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
        if !notice_text.is_empty() {
            self.text(
                &notice_text,
                x,
                y0 + content_height,
                total,
                17.,
                if notice.is_object() { ERROR } else { MUTED },
                false,
            );
        }
        self.widgets.end_clip();
        self.widgets
            .scrollbar(viewport, height, self.scrolls["top"]);
    }
}
