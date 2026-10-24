//! Reusable UI components and a renderer-independent Canvas command buffer.
//! Layout and interaction belong to Rust; a host only measures font ink and paints.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const BG: &str = "@background";
pub const MAP: &str = "@map.background";
pub const PANEL: &str = "@window.background";
pub const LINE: &str = "@window.border";
pub const TEXT: &str = "@text.primary";
pub const MUTED: &str = "@text.muted";
pub const ACCENT: &str = "@accent";
pub const ERROR: &str = "@error";

#[derive(Clone, Copy, Default, Debug, Serialize, Deserialize, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
impl Rect {
    pub fn new(x: f64, y: f64, w: f64, h: f64) -> Self {
        Self { x, y, w, h }
    }
    pub fn contains(self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.w && y < self.y + self.h
    }
    pub fn intersect(self, b: Self) -> Self {
        Self::new(
            self.x.max(b.x),
            self.y.max(b.y),
            (self.x + self.w).min(b.x + b.w) - self.x.max(b.x),
            (self.y + self.h).min(b.y + b.h) - self.y.max(b.y),
        )
    }
    pub fn overlaps(self, b: Self) -> bool {
        self.x < b.x + b.w && b.x < self.x + self.w && self.y < b.y + b.h && b.y < self.y + self.h
    }
}
#[derive(Clone, Copy, Default)]
pub struct TextSize {
    pub width: f64,
    pub ascent: f64,
    pub descent: f64,
}
pub type MeasureText = fn(&str, f64, bool, bool) -> TextSize;
#[derive(Clone, Copy)]
pub struct TextStyle<'a> {
    pub size: f64,
    pub color: &'a str,
    pub bold: bool,
    pub mono: bool,
}
impl<'a> TextStyle<'a> {
    pub fn new(size: f64, color: &'a str, bold: bool) -> Self {
        Self {
            size,
            color,
            bold,
            mono: false,
        }
    }
}
pub struct LineStyle<'a> {
    pub text: TextStyle<'a>,
    pub center: bool,
    pub ellipsis: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Control {
    pub id: String,
    pub label: String,
    pub rect: Rect,
    #[serde(rename = "fullRect")]
    pub full_rect: Rect,
    pub disabled: bool,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    #[serde(skip)]
    pub action: Value,
    #[serde(skip)]
    pub feedback_command: Option<String>,
}
/// Visual roles are independent of the surrounding window and input action.
#[derive(Clone, Copy, Default)]
pub enum ControlRole {
    #[default]
    Command,
    ListItem,
    Select,
    Tab,
    Switch,
    Indicator,
    Field,
}
impl ControlRole {
    fn framed(self) -> bool {
        matches!(self, Self::Command | Self::Field)
    }
}
#[derive(Default)]
pub struct ControlStyle<'a> {
    pub disabled: bool,
    pub primary: bool,
    pub role: ControlRole,
    pub left: bool,
    pub throw_direction: bool,
    pub highlight: bool,
    pub focus_fill: bool,
    pub feedback_command: Option<&'a str>,
    pub size: f64,
    pub icon: Option<&'a str>,
    pub icon_size: f64,
    pub kind: Option<&'a str>,
    pub key: Option<Value>,
    pub field: Option<&'a str>,
    pub shortcut: Option<String>,
    pub custom: bool,
    pub keep_offscreen: bool,
}
#[derive(Default)]
pub struct Widgets {
    pub theme: crate::theme::Theme,
    pub commands: Vec<Value>,
    pub controls: Vec<Control>,
    pub text_runs: Vec<Value>,
    pub icons: Vec<Value>,
    pub focus: String,
    pub hover: String,
    pub pressed: String,
    pub shortcut_context: Value,
    pub fit_control_captions: bool,
    clip: Option<Rect>,
    clips: Vec<Option<Rect>>,
}
impl Widgets {
    fn push(&mut self, mut command: Value) {
        self.theme.paint(&mut command);
        self.commands.push(command);
    }
    pub fn clear(&mut self) {
        self.commands.clear();
        self.controls.clear();
        self.text_runs.clear();
        self.icons.clear();
        self.clip = None;
        self.clips.clear();
        self.shortcut_context = Value::Null;
    }
    pub fn rect(&mut self, r: Rect, color: &str) {
        self.push(json!({"op":"rect","rect":r,"color":color}));
    }
    pub fn box_rect(&mut self, r: Rect, fill: &str, stroke: Option<&str>, radius: f64) {
        self.push(json!({"op":"box","rect":r,"fill":fill,"stroke":stroke,"radius":radius}));
    }
    pub fn circle(&mut self, x: f64, y: f64, r: f64, color: &str) {
        self.push(json!({"op":"circle","x":x,"y":y,"radius":r,"color":color}));
    }
    pub fn begin_clip(&mut self, r: Rect) {
        self.clips.push(self.clip);
        self.clip = Some(self.clip.map_or(r, |a| a.intersect(r)));
        self.push(json!({"op":"clip","rect":r}));
    }
    pub fn end_clip(&mut self) {
        self.clip = self.clips.pop().unwrap_or(None);
        self.push(json!({"op":"restore"}));
    }
    pub fn wrap(text: &str, width: f64, size: f64, measure: MeasureText) -> Vec<String> {
        let mut lines = Vec::new();
        for paragraph in text.split('\n') {
            let mut line = String::new();
            for ch in paragraph.chars() {
                let mut next = line.clone();
                next.push(ch);
                if !line.is_empty() && measure(&next, size, false, false).width > width {
                    let chars: Vec<char> = line.chars().collect();
                    if let Some(index) = chars.iter().rposition(|&c| c == ' ')
                        && index > chars.len() / 3
                    {
                        lines.push(chars[..index].iter().collect());
                        line = chars[index + 1..].iter().collect();
                        line.push(ch);
                    } else {
                        lines.push(line);
                        line = ch.to_string();
                    }
                } else {
                    line = next;
                }
            }
            lines.push(line);
        }
        lines
    }
    pub fn raw_text(&mut self, text: &str, x: f64, y: f64, style: TextStyle<'_>) {
        let TextStyle {
            size,
            color,
            bold,
            mono,
        } = style;
        self.push(json!({"op":"text","text":text,"x":x,"y":y,"size":size,"color":color,"bold":bold,"mono":mono}));
        self.text_runs
            .push(json!({"text":text,"x":x,"y":y,"size":size}));
    }
    pub fn text(
        &mut self,
        text: &str,
        r: Rect,
        size: f64,
        color: &str,
        bold: bool,
        measure: MeasureText,
    ) -> f64 {
        let lines = Self::wrap(text, r.w.max(8.), size, measure);
        let height = (size * 1.65).ceil();
        for (i, line) in lines.iter().enumerate() {
            self.raw_text(
                line,
                r.x,
                r.y + i as f64 * height,
                TextStyle::new(size, color, bold),
            );
        }
        lines.len() as f64 * height
    }
    /// The shared vertical alignment for text inside every UI component.
    pub fn centered_text_y(rect: Rect, ink: TextSize) -> f64 {
        rect.y + (rect.h - ink.ascent - ink.descent) / 2. + ink.ascent
    }
    /// Paint an exact text value in a component, vertically centered by default.
    /// Input values retain their spaces; label cleanup belongs to single_line.
    pub fn text_line(
        &mut self,
        text: &str,
        rect: Rect,
        style: TextStyle<'_>,
        center: bool,
        measure: MeasureText,
    ) -> Rect {
        let ink = measure(if text.is_empty() { "0" } else { text }, style.size, style.bold, style.mono);
        let width = if text.is_empty() { 0. } else { ink.width };
        let x = rect.x + if center { (rect.w - width) / 2. } else { 0. };
        let y = Self::centered_text_y(rect, ink);
        self.raw_text(text, x, y, style);
        Rect::new(x, y - ink.ascent, width, ink.ascent + ink.descent)
    }
    pub fn single_line(
        &mut self,
        text: &str,
        r: Rect,
        style: LineStyle<'_>,
        measure: MeasureText,
    ) -> Rect {
        let LineStyle { text: style, center, ellipsis } = style;
        let mut value = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if ellipsis && measure(&value, style.size, style.bold, style.mono).width > r.w {
            while !value.is_empty()
                && measure(&(value.clone() + "…"), style.size, style.bold, style.mono).width > r.w
            {
                value.pop();
            }
            if !value.is_empty() { value.push('…'); }
        }
        self.text_line(&value, r, style, center, measure)
    }
    /// Fit a complete logical line, keeping its normal font size as the upper bound.
    pub fn fitted_line(
        &mut self,
        text: &str,
        rect: Rect,
        style: LineStyle<'_>,
        measure: MeasureText,
    ) -> Rect {
        let value = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let mut font = style.text;
        let width = measure(&value, font.size, font.bold, font.mono).width;
        if width > rect.w.max(0.) {
            font.size *= rect.w.max(0.) / width;
        }
        self.text_line(&value, rect, font, style.center, measure)
    }
    /// Phone control captions retain each logical line without wrapping or omission.
    pub fn control_line(
        &mut self,
        text: &str,
        rect: Rect,
        style: LineStyle<'_>,
        measure: MeasureText,
    ) -> Rect {
        if self.fit_control_captions {
            self.fitted_line(text, rect, style, measure)
        } else {
            self.single_line(text, rect, style, measure)
        }
    }
    pub fn icon(&mut self, name: &str, r: Rect, color: &str) -> Rect {
        let size = r.w.min(r.h);
        let r = Rect::new(r.x + (r.w - size) / 2., r.y + (r.h - size) / 2., size, size);
        if name == "settings-expand" {
            let gear = size * 0.55;
            self.icon("settings", Rect::new(r.x + (size - gear) / 2., r.y + (size - gear) / 2., gear, gear), color);
            self.icon("expand", r, color);
            return r;
        }
        let path=match name {
            "heart"=>"M12 21 3.5 12.5C-2 7 5 0 12 7C19 0 26 7 20.5 12.5Z".into(),
            // Lucide Lab stairs (ISC); see licenses/lucide-lab/LICENSE.
            "stairs"=>"M2 16H12V20H2ZM4 12H14V16H4ZM6 8H16V12H6ZM8 4H18V8H8ZM12 20H22V4H18".into(),
            "coins"=>"M20 7C20 9.2 16.4 11 12 11S4 9.2 4 7 7.6 3 12 3 20 4.8 20 7ZM4 7V12C4 14.2 7.6 16 12 16S20 14.2 20 12V7M4 12V17C4 19.2 7.6 21 12 21S20 19.2 20 17V12".into(),
            "expand"=>"M3 9V3H9M15 3H21V9M21 15V21H15M9 21H3V15".into(),
            "collapse"=>"M9 3V9H3M15 3V9H21M21 15H15V21M3 15H9V21".into(),
            "shield"=>"M12 3 21 6V12C21 17 16 20 12 22C8 20 3 17 3 12V6ZM12 7V16".into(),
            "experience"=>"M12 2 15 8.5 22 9.5 17 14.5 18 22 12 18.5 6 22 7 14.5 2 9.5 9 8.5Z".into(),
            "food"=>"M3 2V7C3 10 9 10 9 7V2M6 2V22M20 22V2C15 4 14 10 14 13H20".into(),
            "command-list"=>"M3 4H21V20H3ZM9 4V20M3 9H21M3 14H21".into(),
            "close"=>"M6 6 18 18M18 6 6 18".into(),
            "chevron-down"=>"M6 9L12 15L18 9".into(),
            "equipped"=>"M21 12A9 9 0 1 1 3 12A9 9 0 1 1 21 12ZM7 12L10.5 15.5L17 8.5".into(),
            "item-hit"=>"M20 12A8 8 0 1 1 4 12A8 8 0 1 1 20 12M12 1V7M12 17V23M1 12H7M17 12H23M12 10V14M10 12H14".into(),
            "item-damage"=>"M14 3H21V10L10 21L3 14ZM6 17L3 20M2 13L11 22M10 14L18 6".into(),
            "item-enchantment"=>"M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9ZM20 1V7M17 4H23".into(),
            "item-modifier"=>"M3 8H11M7 4V12M14 17H22".into(),
            "item-charges"=>"M2 6H20V18H2ZM20 10H23V14H20M6 9V15M10 9V15M14 9V15".into(),
            "person"=>"M16 7A4 4 0 1 0 8 7A4 4 0 1 0 16 7M4 21V18C4 11 20 11 20 18V21".into(),
            "controls-show"=>"M3 4H21V20H3ZM6 8H8M11 8H13M16 8H18M6 12H8M11 12H13M16 12H18M8 16H16".into(),
            "controls-hide"=>"M3 4H21V20H3ZM6 8H8M11 8H13M16 8H18M6 12H8M11 12H13M16 12H18M8 16H16M2 2L22 22".into(),
            "settings"=>{
                let mut path=String::new();
                for i in 0..32 { let angle=i as f64*std::f64::consts::PI/16.-std::f64::consts::FRAC_PI_2;let radius=if i%4<2{10.}else{7.8};path+=&format!("{}{} {}",if i==0{"M"}else{"L"},12.+angle.cos()*radius,12.+angle.sin()*radius); }
                path+"ZM15.2 12A3.2 3.2 0 1 0 8.8 12A3.2 3.2 0 1 0 15.2 12"
            },
            _=>String::new(),
        };
        self.push(json!({"op":"path","path":path,"rect":r,"color":color,"fill":name=="heart"}));
        self.icons.push(json!({"name":name,"rect":r}));
        r
    }
    pub fn glyph_icon(
        &mut self,
        name: &str,
        glyph: &str,
        r: Rect,
        color: &str,
        measure: MeasureText,
    ) -> Rect {
        self.single_line(
            glyph,
            r,
            LineStyle {
                text: TextStyle::new(r.h, color, true),
                center: true,
                ellipsis: false,
            },
            measure,
        );
        self.icons.push(json!({"name":name,"glyph":glyph,"rect":r}));
        r
    }
    /// Custom control captions share the standard disabled opacity.
    pub fn begin_control_content(&mut self, disabled: bool) {
        self.push(json!({"op":"save","alpha":if disabled {0.45} else {1.}}));
    }
    pub fn end_control_content(&mut self) {
        self.push(json!({"op":"restore"}));
    }
    pub fn control(
        &mut self,
        id: &str,
        label: &str,
        r: Rect,
        action: Value,
        style: ControlStyle<'_>,
        measure: MeasureText,
    ) {
        let mut clipped = self.clip.map_or(r, |clip| r.intersect(clip));
        clipped.w = clipped.w.max(0.);
        clipped.h = clipped.h.max(0.);
        if (clipped.w <= 0. || clipped.h <= 0.) && !style.keep_offscreen {
            return;
        }
        let label = Self::shortcut_label(label, style.shortcut.as_deref());
        let label = label.as_str();
        let hint = style.shortcut.as_deref().map(Self::shortcut_hint);
        self.controls.push(Control {
            id: id.into(),
            label: label.into(),
            rect: clipped,
            full_rect: r,
            disabled: style.disabled,
            kind: style.kind.unwrap_or("button").into(),
            key: style.key,
            field: style.field.map(str::to_owned),
            shortcut: style.shortcut.clone(),
            action,
            feedback_command: style.feedback_command.map(str::to_owned),
        });
        self.begin_control_content(style.disabled);
        let selected = self.focus == id || self.hover == id || self.pressed == id;
        if style.focus_fill && self.focus == id && !style.disabled {
            self.box_rect(r, "@row.selected", Some("@accent"), 0.);
        } else if (style.throw_direction || style.highlight) && !style.disabled {
            self.box_rect(r, "@accent", Some("@button.border"), 0.);
            if selected {
                self.box_rect(Rect::new(r.x + 3., r.y + 3., r.w - 6., r.h - 6.), "transparent", Some("@background"), 0.);
            }
        } else if !style.role.framed() {
            if selected || style.primary {
                self.rect(Rect::new(r.x + 4., r.y + r.h - 2., r.w - 8., 1.), LINE);
            }
        } else {
            self.box_rect(r, "@button.background", Some("@button.border"), 0.);
            if selected {
                self.box_rect(Rect::new(r.x + 3., r.y + 3., r.w - 6., r.h - 6.), "transparent", Some(LINE), 0.);
            }
        }
        let color = if (style.throw_direction || style.highlight) && !style.disabled { "@background" } else { "@button.text" };
        if let Some(icon) = style.icon {
            let size = if style.icon_size > 0. {
                style.icon_size
            } else {
                20.
            };
            // Keep the full icon above the shortcut line without moving small icons.
            let size = size.min(r.w).min((r.h - if hint.is_some() { 16. } else { 0. }).max(0.));
            self.icon(
                icon,
                Rect::new(r.x + (r.w - size) / 2., r.y + (r.h - size - if hint.is_some() { 14. } else { 0. }) / 2., size, size),
                color,
            );
            if let Some(hint) = hint {
                self.single_line(hint, Rect::new(r.x, r.y + r.h - 15., r.w, 12.),
                    LineStyle { text: TextStyle::new(11., color, false), center: true, ellipsis: false }, measure);
            }
        } else if !style.custom {
            let size = if style.size > 0. { style.size } else { 16. };
            let lines = if self.fit_control_captions {
                label.split('\n').map(str::to_owned).collect()
            } else {
                Self::wrap(label, r.w - if style.left { 20. } else { 12. }, size, measure)
            };
            let line_h = size * 1.6;
            for (i, line) in lines.iter().enumerate() {
                self.control_line(
                    line,
                    Rect::new(
                        r.x + if style.left { 10. } else if self.fit_control_captions { 6. } else { 0. },
                        r.y + (r.h - lines.len() as f64 * line_h) / 2. + i as f64 * line_h,
                        r.w - if style.left { 20. } else if self.fit_control_captions { 12. } else { 0. },
                        line_h,
                    ),
                    LineStyle {
                        text: TextStyle::new(size, color, style.primary),
                        center: !style.left,
                        ellipsis: false,
                    },
                    measure,
                );
            }
        }
        self.end_control_content();
    }
    pub fn shortcut_hint(key: &str) -> &str {
        match key { "Escape" => "Esc", "Enter" => "Enter", " " => "Space", _ => key }
    }
    pub fn shortcut_label(label: &str, shortcut: Option<&str>) -> String {
        shortcut.map_or_else(|| label.to_string(), |key| format!("{}) {label}", Self::shortcut_hint(key)))
    }
    /// Shared labeled switch. Labels use measured ink, as buttons and selects do.
    pub fn switch(
        &mut self,
        id: &str,
        label: &str,
        state_label: &str,
        rect: Rect,
        action: Value,
        checked: bool,
        disabled: bool,
        shortcut: Option<String>,
        measure: MeasureText,
    ) {
        self.control(id, label, rect, action, ControlStyle {
            kind: Some("switch"), role: ControlRole::Switch,
            key: Some(json!(checked)), custom: true, disabled, shortcut: shortcut.clone(),
            ..Default::default()
        }, measure);
        self.push(json!({"op":"save","alpha":if disabled {0.45} else {1.}}));
        let track = Rect::new(rect.x + rect.w - 60., rect.y + (rect.h - 32.) / 2., 56., 32.);
        let state_width = (measure(state_label, 17., false, false).width + 8.).max(48.);
        let state = Rect::new(track.x - 12. - state_width, rect.y, state_width, rect.h);
        let label = Self::shortcut_label(label, shortcut.as_deref());
        self.control_line(&label, Rect::new(rect.x + 12., rect.y, (state.x - rect.x - 24.).max(0.), rect.h),
            LineStyle { text: TextStyle::new(17., TEXT, false), center: false, ellipsis: true }, measure);
        self.control_line(state_label, state,
            LineStyle { text: TextStyle::new(17., TEXT, false), center: true, ellipsis: false }, measure);
        self.box_rect(track, PANEL, Some(LINE), 0.);
        self.rect(Rect::new(track.x + if checked {32.} else {4.}, track.y + 4., 20., 24.), TEXT);
        self.push(json!({"op":"restore"}));
    }
    /// Pointer target over already painted content, without button decoration.
    pub fn hit_target(&mut self, id: &str, label: &str, rect: Rect, action: Value) {
        let clipped = self.clip.map_or(rect, |clip| rect.intersect(clip));
        if clipped.w <= 0. || clipped.h <= 0. {
            return;
        }
        self.controls.push(Control {
            id: id.into(),
            label: label.into(),
            rect: clipped,
            full_rect: rect,
            disabled: false,
            kind: "button".into(),
            key: None,
            field: None,
            shortcut: None,
            action,
            feedback_command: None,
        });
    }
    pub fn field(
        &mut self,
        id: &str,
        r: Rect,
        input: &Value,
        disabled: bool,
        blink: bool,
        measure: MeasureText,
    ) {
        self.control(
            id,
            "",
            r,
            json!({"kind":"focus","id":id,"rect":r}),
            ControlStyle {
                disabled,
                kind: Some("field"),
                role: ControlRole::Field,
                field: Some(id),
                ..Default::default()
            },
            measure,
        );
        self.begin_clip(Rect::new(r.x + 9., r.y + 4., r.w - 18., r.h - 8.));
        let value = input["value"].as_str().unwrap_or("");
        let active = input["active"].as_bool().unwrap_or(false);
        // Native selection indices are UTF-16 offsets. Do not split surrogate pairs.
        let prefix = |index: u64| -> String {
            let mut units = 0;
            value
                .chars()
                .take_while(|ch| {
                    units += ch.len_utf16() as u64;
                    units <= index
                })
                .collect()
        };
        let end = input["end"]
            .as_u64()
            .unwrap_or(value.encode_utf16().count() as u64);
        let start = input["start"].as_u64().unwrap_or(end);
        let caret = measure(&prefix(end), 18., false, false).width;
        let offset = if active {
            (caret - r.w + 32.).max(0.)
        } else {
            0.
        };
        let x = r.x + 12. - offset;
        let edit_y = r.y + (r.h - 28.) / 2.;
        if active && end > start {
            let start_w = measure(&prefix(start), 18., false, false).width;
            self.rect(Rect::new(x + start_w, edit_y, caret - start_w, 28.), "@input.selection");
        }
        self.text_line(
            if value.is_empty() {
                input["placeholder"].as_str().unwrap_or("")
            } else {
                value
            },
            Rect::new(x, r.y, r.w - 24., r.h),
            TextStyle::new(18., if value.is_empty() { MUTED } else { TEXT }, false),
            false,
            measure,
        );
        if active && blink {
            self.rect(Rect::new(x + caret, edit_y, 1., 28.), ACCENT);
        }
        self.end_clip();
    }
    pub fn scrollbar(&mut self, r: Rect, total: f64, offset: f64) {
        if total <= r.h {
            return;
        }
        self.rect(Rect::new(r.x + r.w - 4., r.y, 3., r.h), "@scrollbar.track");
        let h = (r.h * r.h / total).max(20.);
        self.rect(
            Rect::new(
                r.x + r.w - 4.,
                r.y + (r.h - h) * offset / (total - r.h),
                3.,
                h,
            ),
            "@scrollbar.thumb",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn measure(text: &str, size: f64, _: bool, _: bool) -> TextSize {
        TextSize { width: text.chars().count() as f64 * size / 2., ascent: 0., descent: size }
    }

    fn settings_expand(shortcut: Option<&str>) -> Widgets {
        let mut widgets = Widgets::default();
        widgets.control("settings-toggle", "Settings", Rect::new(334., 8., 48., 48.),
            json!({"kind":"web","id":"settings"}),
            ControlStyle { icon: Some("settings-expand"), icon_size: 40.,
                shortcut: shortcut.map(str::to_owned), ..Default::default() }, measure);
        widgets
    }

    #[test]
    fn settings_expand_preserves_the_phone_icons_and_control() {
        let widgets = settings_expand(None);
        let mut expected = Widgets::default();
        expected.icon("settings", Rect::new(347., 21., 22., 22.), "@button.text");
        expected.icon("expand", Rect::new(338., 12., 40., 40.), "@button.text");
        let paths = |widgets: &Widgets| widgets.commands.iter()
            .filter(|command| command["op"] == "path").cloned().collect::<Vec<_>>();
        assert_eq!(paths(&widgets), paths(&expected), "The shared icon retains both existing phone shapes and coordinates");
        assert_eq!(widgets.icons, expected.icons);
        assert_eq!(widgets.controls.len(), 1);
        assert_eq!(widgets.controls[0].rect, Rect::new(334., 8., 48., 48.));
        assert_eq!(widgets.controls[0].action, json!({"kind":"web","id":"settings"}));
        assert!(widgets.controls[0].shortcut.is_none());
    }

    #[test]
    fn settings_expand_moves_both_icons_with_the_keyboard_shortcut() {
        let phone = settings_expand(None);
        let keyboard = settings_expand(Some("O"));
        assert_eq!(keyboard.icons.len(), 2, "Both parts share the control content rectangle");
        assert_eq!(phone.icons.len(), 2);
        let control = keyboard.controls[0].rect;
        let hint_top = control.y + control.h - 15.;
        for icon in &keyboard.icons {
            let rect: Rect = serde_json::from_value(icon["rect"].clone()).unwrap();
            assert!((rect.x + rect.w / 2. - 358.).abs() < 1e-8);
            assert!((rect.y + rect.h / 2. - 25.).abs() < 1e-8);
            assert!(rect.x >= control.x && rect.y >= control.y);
            assert!(rect.x + rect.w <= control.x + control.w);
            assert!(rect.y + rect.h <= hint_top, "The icon stays above its shortcut line");
        }
        assert_eq!(keyboard.icons[1]["rect"], json!(Rect::new(342., 9., 32., 32.)));
        assert_eq!(keyboard.controls[0].shortcut.as_deref(), Some("O"));
        assert!(keyboard.text_runs.iter().any(|run| run["text"] == "O"));
    }

    #[test]
    fn settings_expand_fitting_preserves_existing_small_icon_geometry() {
        let mut widgets = Widgets::default();
        widgets.control("settings-toggle", "Settings", Rect::new(334., 8., 48., 48.),
            json!({"kind":"web","id":"settings"}),
            ControlStyle { icon: Some("settings"), icon_size: 22.,
                shortcut: Some("O".into()), ..Default::default() }, measure);
        assert_eq!(widgets.icons[0]["rect"], json!(Rect::new(347., 14., 22., 22.)));
    }
}
