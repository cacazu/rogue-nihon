//! Responsive ASCII tombstone built only from the original ending's public lines.
use super::*;

const FIELDS: [&str; 8] = [
    "ui.ending.rest", "ui.ending.in", "ui.ending.peace", "ui.ending.name",
    "ui.ending.gold", "ui.ending.killed_by", "ui.ending.cause", "ui.ending.year",
];
const COLUMNS: usize = 35;

struct Row {
    frame: String,
    text: String,
    bold: bool,
}

pub(super) struct Tombstone {
    rows: Vec<Row>,
    width: f64,
    line_height: f64,
    frame_size: f64,
    text_size: f64,
}

impl Tombstone {
    pub(super) fn contains(line: &Value) -> bool {
        line["scope"] == "tombstone" && FIELDS.contains(&s(&line["id"]))
    }

    pub(super) fn from_ui(ui: &Value, available: f64, measure: MeasureText) -> Option<Self> {
        // The score acknowledgement may already set mode=score while the tomb
        // is on screen. Identify its semantic lines, not the current mode/title.
        let values: Option<Vec<&str>> = FIELDS.iter().map(|id| {
            array(&ui["lines"]).iter().find(|l| Self::contains(l) && l["id"] == *id)
                .map(|l| s(&l["text"]))
        }).collect();
        let values = values?;
        let width = (available - 8.).min(420.).max(1.);
        let text_size = 18.;
        let mut tomb = Self {
            rows: vec![Row { frame: format!("{}{}", " ".repeat(8), "_".repeat(19)), text: String::new(), bold: false }],
            width, line_height: text_size + 8.,
            frame_size: width / COLUMNS as f64 / 0.6, text_size,
        };
        tomb.row(7, 27, '/', '\\', "", false, measure);
        for (i, text) in values[..3].iter().enumerate() {
            tomb.row(6 - i, 28 + i, '/', '\\', text, false, measure);
        }
        tomb.row(3, 31, '/', '\\', "", false, measure);
        for (i, text) in values[3..].iter().enumerate() {
            tomb.row(3, 31, '|', '|', text, i == 0, measure);
        }
        tomb.rows.push(Row { frame: "  *|    *  *  *  *             |*".into(), text: String::new(), bold: false });
        tomb.rows.push(Row { frame: r"___)/\_//(\/(/\)/\//\/\_//\_|_)___".into(), text: String::new(), bold: false });
        Some(tomb)
    }

    fn row(&mut self, left: usize, right: usize, a: char, z: char, text: &str, bold: bool, measure: MeasureText) {
        let cell = self.width / COLUMNS as f64;
        // Japanese and player names use actual font metrics; only the frame is
        // monospaced. Reserve two cells of padding on each side of the text.
        let inner = (right - left - 4) as f64 * cell;
        for line in Widgets::wrap(text, inner, self.text_size, measure) {
            // Bold player names can be wider than the regular wrapping metric.
            let mut part = String::new();
            for ch in line.chars() {
                let next = format!("{part}{ch}");
                if !part.is_empty() && measure(&next, self.text_size, bold, false).width > inner {
                    self.push_row(left, right, a, z, part, bold);
                    part = ch.to_string();
                } else { part = next; }
            }
            self.push_row(left, right, a, z, part, bold);
        }
    }

    fn push_row(&mut self, left: usize, right: usize, a: char, z: char, text: String, bold: bool) {
        self.rows.push(Row {
            frame: format!("{}{a}{}{z}", " ".repeat(left), " ".repeat(right - left - 1)),
            text, bold,
        });
    }

    pub(super) fn height(&self) -> f64 { self.rows.len() as f64 * self.line_height }

    pub(super) fn draw(&self, widgets: &mut Widgets, rect: Rect, measure: MeasureText) {
        let x = rect.x + (rect.w - self.width) / 2.;
        for (i, row) in self.rows.iter().enumerate() {
            let line = Rect::new(x, rect.y + i as f64 * self.line_height, self.width, self.line_height);
            widgets.text_line(&row.frame, line,
                TextStyle { size: self.frame_size, color: TEXT, bold: false, mono: true }, false, measure);
            if !row.text.is_empty() {
                widgets.text_line(&row.text, line, TextStyle::new(self.text_size, TEXT, row.bold), true, measure);
            }
        }
    }
}
