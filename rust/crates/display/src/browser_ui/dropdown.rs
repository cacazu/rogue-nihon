//! Canvas dropdowns dispatch the existing language/display selection actions.
use super::*;

impl BrowserUi {
    fn dropdown_options(&self, id: &str) -> Vec<(&'static str, String)> {
        match id {
            "language" => ["ja", "en"]
                .into_iter()
                .map(|value| (value, self.t(&format!("language.{value}"))))
                .collect(),
            "display-mode" => ["ascii", "tiles", "pixels"]
                .into_iter()
                .map(|value| (value, self.t(&format!("view.{value}"))))
                .collect(),
            _ => Vec::new(),
        }
    }

    fn dropdown_label(&self, id: &str) -> String {
        let value = s(&self.model[if id == "language" {
            "language"
        } else {
            "displayMode"
        }]);
        let label = self
            .dropdown_options(id)
            .into_iter()
            .find(|(key, _)| *key == value)
            .map(|(_, label)| label)
            .unwrap_or_default();
        format!("{label}  ▾")
    }

    pub(super) fn top_language_control(&mut self, fullscreen: Rect) {
        let label = self.dropdown_label("language");
        let width = ((self.measure)(&label, 17., false, false).width + 20.).max(48.);
        self.dropdown_control(
            "language",
            Rect::new(fullscreen.x - 8. - width, fullscreen.y, width, 48.),
            b(&self.model["starting"]) || b(&self.model["savePending"]),
        );
    }

    pub(super) fn dropdown_control(&mut self, id: &str, rect: Rect, disabled: bool) {
        let label = self.dropdown_label(id);
        self.control(
            &format!("select-{id}"),
            &label,
            rect,
            json!({"kind":"dropdown","id":id}),
            ControlStyle {
                size: 17.,
                left: true,
                disabled,
                kind: Some("select"),
                ..Default::default()
            },
        );
    }

    pub(super) fn draw_dropdown(&mut self) {
        if self.dropdown.is_empty() {
            return;
        }
        let id = self.dropdown.clone();
        let Some(anchor) = self
            .widgets
            .controls
            .iter()
            .find(|c| c.id == format!("select-{id}") && !c.disabled)
            .cloned()
        else {
            self.dropdown.clear();
            return;
        };
        let options = self.dropdown_options(&id);
        let height = options.len() as f64 * 52. + 8.;
        let y = if anchor.rect.y + anchor.rect.h + height + 8. <= self.height {
            anchor.rect.y + anchor.rect.h + 4.
        } else {
            (anchor.rect.y - height - 4.).max(8.)
        };
        let rect = Rect::new(anchor.full_rect.x, y, anchor.full_rect.w, height);
        self.widgets.controls.clear();
        self.regions.clear();
        self.map_rect = None;
        self.widgets.hit_target(
            "dropdown-dismiss",
            "",
            Rect::new(0., 0., self.width, self.height),
            json!({"kind":"dropdown-close"}),
        );
        self.widgets.box_rect(rect, PANEL, Some(LINE), 8.);
        let selected = s(&self.model[if id == "language" {
            "language"
        } else {
            "displayMode"
        }])
        .to_string();
        for (index, (value, label)) in options.into_iter().enumerate() {
            self.control(
                &format!("select-{id}-{value}"),
                &label,
                Rect::new(
                    rect.x + 4.,
                    rect.y + 4. + index as f64 * 52.,
                    rect.w - 8.,
                    48.,
                ),
                json!({"kind":"dropdown-choice","id":id,"value":value}),
                ControlStyle {
                    size: 17.,
                    left: true,
                    primary: value == selected,
                    ..Default::default()
                },
            );
        }
    }

    pub(super) fn dropdown_key(&mut self, key: &str, effects: &mut Vec<Value>) {
        match key {
            "Escape" => self.dropdown.clear(),
            "ArrowUp" | "ArrowDown" | "Tab" => {
                let options: Vec<_> = self
                    .widgets
                    .controls
                    .iter()
                    .filter(|c| s(&c.action["kind"]) == "dropdown-choice")
                    .collect();
                if !options.is_empty() {
                    let current = options
                        .iter()
                        .position(|c| c.id == self.widgets.focus)
                        .unwrap_or(0);
                    let step = if key == "ArrowUp" {
                        options.len() - 1
                    } else {
                        1
                    };
                    self.widgets.focus = options[(current + step) % options.len()].id.clone();
                }
            }
            "Enter" | " " => {
                if let Some(control) = self
                    .widgets
                    .controls
                    .iter()
                    .find(|c| {
                        c.id == self.widgets.focus && s(&c.action["kind"]) == "dropdown-choice"
                    })
                    .cloned()
                {
                    self.dropdown.clear();
                    effects.push(json!({"kind":"select","id":control.action["id"],"value":control.action["value"]}));
                }
            }
            _ => {}
        }
    }
}
