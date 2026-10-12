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
        let title = self.t("mobile.repeat");
        let subtitle = if self.mobile_repeat_configured {
            self.mobile_repeat_count.to_string()
        } else { self.t("mobile.long_press") };
        self.control("touch-again", &format!("{title}\n{subtitle}"), rect,
            json!({"kind":"send","key":97}),
            ControlStyle { custom:true, key:Some(json!(97)), ..Default::default() });
        for (text, y) in [(&title, rect.y + 2.), (&subtitle, rect.y + 27.)] {
            self.widgets.single_line(text, Rect::new(rect.x + 1., y, rect.w - 2., 22.),
                LineStyle { text:TextStyle::new(17., TEXT, false), center:true, ellipsis:false }, self.measure);
        }
    }

    pub(super) fn draw_repeat_count(&mut self) {
        self.widgets.controls.clear();
        self.regions.clear();
        self.map_rect = None;
        self.widgets.rect(Rect::new(0.,0.,self.width,self.height), "#0009");
        let w = 360_f64.min(self.width - 28.);
        let x = (self.width - w) / 2.;
        let h = 232_f64.min(self.height - 16.);
        let y = (self.height - h) / 2.;
        let inner = w - 32.;
        self.widgets.box_rect(Rect::new(x,y,w,h), PANEL, Some(LINE), 12.);
        self.text(&self.t("mobile.repeat_count"), x + 16., y + 16., inner - 56., 20., TEXT, true);
        self.button("repeat-count-close", &self.t("mobile.dialog.close"),
            Rect::new(x+w-56.,y+8.,48.,48.),
            ControlStyle { icon:Some("close"), icon_size:24., ..Default::default() });
        self.field("repeat-count", Rect::new(x+16.,y+72.,inner,48.), false);
        self.button("repeat-count-submit", &self.t("mobile.repeat_set"),
            Rect::new(x+16.,y+132.,inner,48.),
            ControlStyle { size:17., ..Default::default() });
        if self.mobile_repeat_error {
            self.text(&self.t("mobile.repeat_invalid"), x+16.,y+190.,inner,17.,ERROR,false);
        }
    }
}
