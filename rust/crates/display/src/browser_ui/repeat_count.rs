//! Repeat preferences are browser state. Only a tap sends the original count+a.
use super::*;

impl BrowserUi {
    pub fn repeat_count_open(&self) -> bool {
        self.mobile_repeat_open
    }

    pub fn confirm_repeat_count(&mut self, value: &str) -> bool {
        if !self.mobile_repeat_open { return false; }
        let count = value.trim().parse::<u32>().ok().filter(|n| (1..=255).contains(n));
        let Some(count) = count else {
            self.mobile_repeat_error = true;
            return false;
        };
        self.mobile_repeat_count = count;
        self.mobile_repeat_configured = true;
        self.mobile_repeat_open = false;
        self.mobile_repeat_error = false;
        true
    }

    pub(super) fn open_repeat_count(&mut self, effects: &mut Vec<Value>) {
        self.mobile_repeat_open = true;
        self.mobile_repeat_error = false;
        effects.push(json!({"kind":"field","id":"repeat-count","properties":{
            "value":self.mobile_repeat_count.to_string(),"disabled":false}}));
        effects.push(json!({"kind":"native-focus","id":"repeat-count"}));
    }

    pub(super) fn draw_repeat_button(&mut self, rect: Rect) {
        let coarse = b(&self.view["coarse"]);
        let title = if coarse { self.t("mobile.repeat_title") } else {
            Widgets::shortcut_label(&self.t("mobile.repeat"),self.pc_shortcut(web_command(WebAction::Repeat).key).as_deref())
        };
        let subtitle = if coarse {
            if self.mobile_repeat_configured {
                self.t("mobile.repeat_count_short").replace("{count}", &self.mobile_repeat_count.to_string())
            } else {
                self.t("mobile.long_press")
            }
        } else {
            format!("{}{}", Widgets::shortcut_label(&self.t("mobile.repeat_count"),
                self.pc_shortcut(web_command(WebAction::RepeatCount).key).as_deref()), self.mobile_repeat_count)
        };
        self.web_control(WebAction::Repeat,"touch-again", &format!("{title}\n{subtitle}"), rect,
            ControlStyle { custom:true, key:Some(json!(97)), ..Default::default() });
        self.widgets.begin_control_content(!self.web_available(WebAction::Repeat));
        for (index, text) in [&title, &subtitle].into_iter().enumerate() {
            self.widgets.control_line(text, Rect::new(rect.x + 1., rect.y + index as f64 * rect.h / 2., rect.w - 2., rect.h / 2.),
                LineStyle { text:TextStyle::new(17., TEXT, false), center:true, ellipsis:false }, self.measure);
        }
        self.widgets.end_control_content();
    }

    pub(super) fn draw_repeat_count(&mut self) {
        self.begin_choices("repeat-count");
        self.regions.clear();
        self.map_rect = None;
        self.widgets.rect(Rect::new(0.,0.,self.width,self.height), "@overlay.strong");
        let w = 360_f64.min(self.width - 28.);
        let x = (self.width - w) / 2.;
        let inner = w - 32.;
        let error = self.mobile_repeat_error.then(|| self.t("mobile.repeat_invalid"));
        let h = error.as_ref().map_or(196., |text|
            190. + self.wrap(text, inner, 17.).len() as f64 * 17. * 1.6 + 16.)
            .min(self.height - 16.);
        let y = (self.height - h) / 2.;
        self.widgets.box_rect(Rect::new(x,y,w,h), PANEL, Some(LINE), 0.);
        self.text(&self.t("mobile.repeat_count"), x + 16., y + 16., inner - 56., 20., TEXT, true);
        self.button("repeat-count-close", &self.t("mobile.dialog.close"),
            Rect::new(x+w-56.,y+8.,48.,48.),
            ControlStyle { icon:Some("close"), icon_size:24., shortcut:self.pc_shortcut("Escape"), ..Default::default() });
        self.field("repeat-count", Rect::new(x+16.,y+72.,inner,48.), false);
        self.button("repeat-count-submit", &self.t("mobile.repeat_set"),
            Rect::new(x+16.,y+132.,inner,48.),
            ControlStyle { size:17., shortcut:self.pc_shortcut("Enter"), ..Default::default() });
        if let Some(error) = error {
            self.text(&error, x+16.,y+190.,inner,17.,ERROR,false);
        }
    }
}
