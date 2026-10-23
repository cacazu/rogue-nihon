//! Read-only PC command reference. It never activates a listed game command.
use super::*;

const GROUPS: &[(&str, &[(&str, &str)])] = &[
    (
        "mobile.group.movement",
        &[
            ("← / h / {pad}4", "help.left"),
            ("↓ / j / {pad}2", "help.down"),
            ("↑ / k / {pad}8", "help.up"),
            ("→ / l / {pad}6", "help.right"),
            ("Home / y / {pad}7", "help.up_left"),
            ("PageUp / u / {pad}9", "help.up_right"),
            ("End / b / {pad}1", "help.down_left"),
            ("PageDown / n / {pad}3", "help.down_right"),
            ("commands.shift_direction", "help.run"),
            ("commands.ctrl_direction", "help.run_adjacent"),
            ("m", "help.move_without_pickup"),
            (". / {pad}5", "help.rest"),
            ("s", "help.search"),
            (",", "help.pickup"),
            (">", "help.downstairs"),
            ("<", "help.upstairs"),
            ("^", "help.trap"),
        ],
    ),
    (
        "mobile.group.combat",
        &[
            ("f", "help.fight_carefully"),
            ("F", "help.fight_to_death"),
            ("t", "help.throw"),
            ("z", "help.zap"),
        ],
    ),
    (
        "commands.group.items",
        &[
            ("q", "help.quaff"),
            ("r", "help.read"),
            ("e", "help.eat"),
            ("w", "help.wield"),
            ("W", "help.wear"),
            ("T", "help.take_off"),
            ("P", "help.put_ring"),
            ("R", "help.remove_ring"),
            ("d", "help.drop"),
            ("c", "help.call"),
        ],
    ),
    (
        "mobile.group.info",
        &[
            ("i", "help.inventory"),
            ("I", "help.inventory_one"),
            (")", "help.weapon"),
            ("]", "help.armor"),
            ("=", "help.rings"),
            ("@", "help.stats"),
            ("D", "help.discoveries"),
            ("/", "help.identify"),
            ("?", "help.help"),
            ("Ctrl + P", "help.recall"),
        ],
    ),
    (
        "mobile.group.repeat",
        &[
            ("a", "help.again"),
            ("0 - 9", "commands.repeat"),
            ("Esc", "help.cancel"),
        ],
    ),
    (
        "commands.group.selection",
        &[
            ("a - z", "commands.choose"),
            ("*", "commands.item_list"),
            ("Tab / Shift + Tab", "commands.focus"),
            ("Enter", "commands.activate"),
            ("PageUp / PageDown", "commands.scroll"),
        ],
    ),
    (
        "commands.group.system",
        &[
            ("o", "help.options"),
            ("Q", "help.quit"),
            ("Ctrl + R", "help.redraw"),
            ("v", "help.version"),
        ],
    ),
];

struct ReferenceRow {
    key: Vec<String>,
    description: Vec<String>,
    height: f64,
    heading: bool,
}

impl BrowserUi {
    fn reference_cell(&mut self, lines: &[String], rect: Rect, bold: bool) {
        let line_height = 26.;
        let y = rect.y + (rect.h - lines.len() as f64 * line_height) / 2.;
        for (index, line) in lines.iter().enumerate() {
            self.widgets.text_line(
                line,
                Rect::new(
                    rect.x + 10.,
                    y + index as f64 * line_height,
                    rect.w - 20.,
                    line_height,
                ),
                TextStyle::new(16., TEXT, bold),
                false,
                self.measure,
            );
        }
    }

    pub(super) fn draw_commands(&mut self) {
        self.begin_choices("commands");
        self.regions.clear();
        self.map_rect = None;
        self.widgets.rect(
            Rect::new(0., 0., self.width, self.height),
            "@overlay.strong",
        );
        let width = (self.width - 16.).min(860.);
        let table_width = width - 40.;
        let key_width = (table_width * 0.38).min(280.);
        let description_width = table_width - key_width;
        let mut rows = Vec::new();
        for (heading, entries) in GROUPS {
            let heading = self.wrap(&self.t(heading), table_width - 20., 16.);
            rows.push(ReferenceRow {
                height: heading.len() as f64 * 26. + 12.,
                key: heading,
                description: vec![],
                heading: true,
            });
            for (key, id) in *entries {
                let mut label = if key.starts_with("commands.") {
                    self.t(key)
                } else {
                    key.replace("{pad}", &self.t("commands.keypad"))
                };
                if matches!(*key, "f" | "F" | "t" | "z" | "m" | "^") {
                    label.push_str(&format!(" + {}", self.t("commands.direction")));
                }
                let description = if id.starts_with("help.") {
                    // The semantic help describes direction prefixes before its tab/colon.
                    let text = crate::display::message_language(
                        id,
                        &json!([]),
                        "",
                        s(&self.model["language"]),
                    )
                    .text;
                    let text = text
                        .split_once('\t')
                        .map_or(text.as_str(), |(_, value)| value);
                    text.rsplit_once(['：', ':'])
                        .map_or(text, |(_, value)| value)
                        .trim()
                        .to_string()
                } else {
                    self.t(id)
                };
                let key = self.wrap(&label, key_width - 20., 16.);
                let description = self.wrap(&description, description_width - 20., 16.);
                let height = key.len().max(description.len()) as f64 * 26. + 12.;
                rows.push(ReferenceRow {
                    key,
                    description,
                    height,
                    heading: false,
                });
            }
        }
        let total: f64 = rows.iter().map(|row| row.height).sum();
        let (panel, body) = self.sheet_layout(width, total + 40.);
        let table = Rect::new(body.x, body.y, table_width, body.h);
        let viewport = Rect::new(table.x, table.y + 40., table.w, (table.h - 40.).max(1.));
        self.widgets.box_rect(panel, PANEL, Some(LINE), 0.);
        self.widgets.text_line(
            &self.t("commands.title"),
            Rect::new(panel.x + 16., 16., width - 88., 48.),
            TextStyle::new(22., TEXT, true),
            false,
            self.measure,
        );
        self.control(
            "commands-close",
            &self.t("action.cancel_short"),
            Rect::new(panel.x + width - 56., 16., 48., 48.),
            json!({"kind":"commands","open":false}),
            ControlStyle {
                icon: Some("close"),
                icon_size: 24.,
                shortcut: self.pc_shortcut("Escape"),
                ..Default::default()
            },
        );
        let header = Rect::new(table.x, table.y, table.w, 40.);
        self.reference_cell(
            &[self.t("commands.key")],
            Rect::new(header.x, header.y, key_width, header.h),
            true,
        );
        self.reference_cell(
            &[self.t("commands.action")],
            Rect::new(header.x + key_width, header.y, description_width, header.h),
            true,
        );
        self.widgets.rect(
            Rect::new(header.x, header.y + header.h - 1., header.w, 1.),
            LINE,
        );
        self.widgets.rect(
            Rect::new(header.x + key_width, header.y, 1., header.h),
            LINE,
        );
        let max = (total - viewport.h).max(0.);
        let offset = clamp(*self.scrolls.get("commands").unwrap_or(&0.), 0., max);
        let mut y = viewport.y - offset;
        self.widgets.begin_clip(viewport);
        for row in rows {
            if y + row.height > viewport.y && y < viewport.y + viewport.h {
                if row.heading {
                    self.reference_cell(&row.key, Rect::new(table.x, y, table.w, row.height), true);
                } else {
                    self.reference_cell(
                        &row.key,
                        Rect::new(table.x, y, key_width, row.height),
                        false,
                    );
                    self.reference_cell(
                        &row.description,
                        Rect::new(table.x + key_width, y, description_width, row.height),
                        false,
                    );
                    self.widgets
                        .rect(Rect::new(table.x + key_width, y, 1., row.height), LINE);
                }
                self.widgets
                    .rect(Rect::new(table.x, y + row.height - 1., table.w, 1.), LINE);
            }
            y += row.height;
        }
        self.widgets.end_clip();
        self.regions.insert(
            "commands".into(),
            Region {
                rect: viewport,
                max,
            },
        );
        self.scrolls.insert("commands".into(), offset);
        self.widgets.scrollbar(viewport, total, offset);
    }
}
