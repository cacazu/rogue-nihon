//! Reusable UI components and a renderer-independent Canvas command buffer.
//! Layout and interaction belong to Rust; a host only measures font ink and paints.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub const BG: &str = "#101518";
pub const MAP: &str = "#080d0f";
pub const PANEL: &str = "#152126";
pub const LINE: &str = "#3b4d53";
pub const TEXT: &str = "#e8ebed";
pub const MUTED: &str = "#a5b8bf";
pub const ACCENT: &str = "#a6d0be";
pub const ERROR: &str = "#ffb4a5";

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
    #[serde(skip)]
    pub action: Value,
}
#[derive(Default)]
pub struct ControlStyle<'a> {
    pub disabled: bool,
    pub primary: bool,
    pub flat: bool,
    pub left: bool,
    pub throw_direction: bool,
    pub size: f64,
    pub icon: Option<&'a str>,
    pub icon_size: f64,
    pub kind: Option<&'a str>,
    pub key: Option<Value>,
    pub field: Option<&'a str>,
    pub custom: bool,
    pub keep_offscreen: bool,
}
#[derive(Default)]
pub struct Widgets {
    pub commands: Vec<Value>,
    pub controls: Vec<Control>,
    pub text_runs: Vec<Value>,
    pub icons: Vec<Value>,
    pub focus: String,
    pub hover: String,
    pub pressed: String,
    clip: Option<Rect>,
    clips: Vec<Option<Rect>>,
}
impl Widgets {
    pub fn clear(&mut self) {
        self.commands.clear();
        self.controls.clear();
        self.text_runs.clear();
        self.icons.clear();
        self.clip = None;
        self.clips.clear();
    }
    pub fn rect(&mut self, r: Rect, color: &str) {
        self.commands
            .push(json!({"op":"rect","rect":r,"color":color}));
    }
    pub fn box_rect(&mut self, r: Rect, fill: &str, stroke: Option<&str>, radius: f64) {
        self.commands
            .push(json!({"op":"box","rect":r,"fill":fill,"stroke":stroke,"radius":radius}));
    }
    pub fn circle(&mut self, x: f64, y: f64, r: f64, color: &str) {
        self.commands
            .push(json!({"op":"circle","x":x,"y":y,"radius":r,"color":color}));
    }
    pub fn begin_clip(&mut self, r: Rect) {
        self.clips.push(self.clip);
        self.clip = Some(self.clip.map_or(r, |a| a.intersect(r)));
        self.commands.push(json!({"op":"clip","rect":r}));
    }
    pub fn end_clip(&mut self) {
        self.clip = self.clips.pop().unwrap_or(None);
        self.commands.push(json!({"op":"restore"}));
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
        self.commands.push(json!({"op":"text","text":text,"x":x,"y":y,"size":size,"color":color,"bold":bold,"mono":mono}));
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
    pub fn single_line(
        &mut self,
        text: &str,
        r: Rect,
        style: LineStyle<'_>,
        measure: MeasureText,
    ) -> Rect {
        let LineStyle {
            text: TextStyle {
                size, color, bold, ..
            },
            center,
            ellipsis,
        } = style;
        let mut value = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if ellipsis && measure(&value, size, bold, false).width > r.w {
            while !value.is_empty()
                && measure(&(value.clone() + "…"), size, bold, false).width > r.w
            {
                value.pop();
            }
            if !value.is_empty() {
                value.push('…');
            }
        }
        let width = measure(&value, size, bold, false).width;
        let ink = measure(
            if value.is_empty() { "0" } else { &value },
            size,
            bold,
            false,
        );
        let x = if center {
            r.x + (r.w - width) / 2.
        } else {
            r.x
        };
        let y = r.y + (r.h - ink.ascent - ink.descent) / 2. + ink.ascent;
        self.raw_text(&value, x, y, TextStyle::new(size, color, bold));
        Rect::new(x, y - ink.ascent, width, ink.ascent + ink.descent)
    }
    pub fn icon(&mut self, name: &str, r: Rect, color: &str) -> Rect {
        let size = r.w.min(r.h);
        let r = Rect::new(r.x + (r.w - size) / 2., r.y + (r.h - size) / 2., size, size);
        let path=match name {
            "heart"=>"M12 21 3.5 12.5C-2 7 5 0 12 7C19 0 26 7 20.5 12.5Z".into(),
            "stairs"=>"M3 21H9V15H15V9H21V3M3 3H10M3 3V10M3 3 12 12".into(),
            "coins"=>"M20 7C20 9.2 16.4 11 12 11S4 9.2 4 7 7.6 3 12 3 20 4.8 20 7ZM4 7V12C4 14.2 7.6 16 12 16S20 14.2 20 12V7M4 12V17C4 19.2 7.6 21 12 21S20 19.2 20 17V12".into(),
            "expand"=>"M3 9V3H9M15 3H21V9M21 15V21H15M9 21H3V15".into(),
            "shield"=>"M12 3 21 6V12C21 17 16 20 12 22C8 20 3 17 3 12V6ZM12 7V16".into(),
            "experience"=>"M12 2 15 8.5 22 9.5 17 14.5 18 22 12 18.5 6 22 7 14.5 2 9.5 9 8.5Z".into(),
            "food"=>"M3 2V7C3 10 9 10 9 7V2M6 2V22M20 22V2C15 4 14 10 14 13H20".into(),
            "close"=>"M6 6 18 18M18 6 6 18".into(),
            "settings"=>{
                let mut path=String::new();
                for i in 0..32 { let angle=i as f64*std::f64::consts::PI/16.-std::f64::consts::FRAC_PI_2;let radius=if i%4<2{10.}else{7.8};path+=&format!("{}{} {}",if i==0{"M"}else{"L"},12.+angle.cos()*radius,12.+angle.sin()*radius); }
                path+"ZM15.2 12A3.2 3.2 0 1 0 8.8 12A3.2 3.2 0 1 0 15.2 12"
            },
            _=>String::new(),
        };
        self.commands
            .push(json!({"op":"path","path":path,"rect":r,"color":color,"fill":name=="heart"}));
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
        self.controls.push(Control {
            id: id.into(),
            label: label.into(),
            rect: clipped,
            full_rect: r,
            disabled: style.disabled,
            kind: style.kind.unwrap_or("button").into(),
            key: style.key,
            field: style.field.map(str::to_owned),
            action,
        });
        self.commands
            .push(json!({"op":"save","alpha":if style.disabled{0.45}else{1.}}));
        let selected = self.focus == id || self.hover == id || self.pressed == id;
        let fill = if style.throw_direction {
            if selected { "#8c5122" } else { "#6b3d1b" }
        } else if style.primary {
            ACCENT
        } else if selected {
            "#23352d"
        } else {
            "#1b262b"
        };
        let stroke = if style.throw_direction {
            if selected { "#ffd59b" } else { "#e6a457" }
        } else if selected {
            "#94d8b7"
        } else {
            LINE
        };
        if !style.flat || selected {
            self.box_rect(r, fill, Some(stroke), 7.);
        }
        let color = if style.throw_direction {
            "#fff0d6"
        } else if style.primary {
            "#15231c"
        } else {
            TEXT
        };
        if let Some(icon) = style.icon {
            let size = if style.icon_size > 0. {
                style.icon_size
            } else {
                20.
            };
            self.icon(
                icon,
                Rect::new(r.x + (r.w - size) / 2., r.y + (r.h - size) / 2., size, size),
                color,
            );
        } else if !style.custom {
            let size = if style.size > 0. { style.size } else { 16. };
            let lines = Self::wrap(
                label,
                r.w - if style.left { 20. } else { 12. },
                size,
                measure,
            );
            let line_h = size * 1.6;
            for (i, line) in lines.iter().enumerate() {
                self.single_line(
                    line,
                    Rect::new(
                        r.x + if style.left { 10. } else { 0. },
                        r.y + (r.h - lines.len() as f64 * line_h) / 2. + i as f64 * line_h,
                        r.w - if style.left { 20. } else { 0. },
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
        self.commands.push(json!({"op":"restore"}));
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
        let y = r.y + (r.h - 29.) / 2.;
        if active && end > start {
            let start_w = measure(&prefix(start), 18., false, false).width;
            self.rect(Rect::new(x + start_w, y, caret - start_w, 29.), "#375e73");
        }
        self.raw_text(
            if value.is_empty() {
                input["placeholder"].as_str().unwrap_or("")
            } else {
                value
            },
            x,
            y,
            TextStyle::new(18., if value.is_empty() { MUTED } else { TEXT }, false),
        );
        if active && blink {
            self.rect(Rect::new(x + caret, y, 1., 28.), ACCENT);
        }
        self.end_clip();
    }
    pub fn scrollbar(&mut self, r: Rect, total: f64, offset: f64) {
        if total <= r.h {
            return;
        }
        self.rect(Rect::new(r.x + r.w - 4., r.y, 3., r.h), "#26383e");
        let h = (r.h * r.h / total).max(20.);
        self.rect(
            Rect::new(
                r.x + r.w - 4.,
                r.y + (r.h - h) * offset / (total - r.h),
                3.,
                h,
            ),
            "#66877b",
        );
    }
}
