//! Read-only PC command reference. It never activates a listed game command.
use super::*;

#[derive(Clone, Copy)]
pub(super) enum GameAction { Key(u32), Direction(u32) }

#[derive(Clone, Copy)]
pub(super) struct ReferenceCommand {
    pub keys: &'static str,
    pub description: &'static str,
    pub phone_action: Option<GameAction>,
}
const fn reference(keys: &'static str, description: &'static str) -> ReferenceCommand {
    ReferenceCommand {keys,description,phone_action:None}
}
const fn game(keys: &'static str, description: &'static str, key: u8) -> ReferenceCommand {
    ReferenceCommand {keys,description,phone_action:Some(GameAction::Key(key as u32))}
}
const fn direction(keys: &'static str, description: &'static str, key: u8) -> ReferenceCommand {
    ReferenceCommand {keys,description,phone_action:Some(GameAction::Direction(key as u32))}
}

pub(super) const GROUPS: &[(&str, &[ReferenceCommand])] = &[
    (
        "mobile.group.movement",
        &[
            direction("← / h / {pad}4", "help.left", b'h'),
            direction("↓ / j / {pad}2", "help.down", b'j'),
            direction("↑ / k / {pad}8", "help.up", b'k'),
            direction("→ / l / {pad}6", "help.right", b'l'),
            direction("Home / y / {pad}7", "help.up_left", b'y'),
            direction("PageUp / u / {pad}9", "help.up_right", b'u'),
            direction("End / b / {pad}1", "help.down_left", b'b'),
            direction("PageDown / n / {pad}3", "help.down_right", b'n'),
            reference("commands.shift_direction", "help.run"),
            reference("commands.ctrl_direction", "help.run_adjacent"),
            game("m", "help.move_without_pickup", b'm'),
            game(". / {pad}5", "help.rest", b'.'),
            game("s", "help.search", b's'),
            game(",", "help.pickup", b','),
            game(">", "help.downstairs", b'>'),
            game("<", "help.upstairs", b'<'),
            game("^", "help.trap", b'^'),
        ],
    ),
    (
        "mobile.group.combat",
        &[
            game("f", "help.fight_carefully", b'f'),
            game("F", "help.fight_to_death", b'F'),
            game("t", "help.throw", b't'),
            game("z", "help.zap", b'z'),
        ],
    ),
    (
        "commands.group.items",
        &[
            game("q", "help.quaff", b'q'),
            game("r", "help.read", b'r'),
            game("e", "help.eat", b'e'),
            game("w", "help.wield", b'w'),
            game("W", "help.wear", b'W'),
            game("T", "help.take_off", b'T'),
            game("P", "help.put_ring", b'P'),
            game("R", "help.remove_ring", b'R'),
            game("d", "help.drop", b'd'),
            game("c", "help.call", b'c'),
        ],
    ),
    (
        "mobile.group.info",
        &[
            game("i", "help.inventory", b'i'),
            game("I", "help.inventory_one", b'I'),
            game(")", "help.weapon", b')'),
            game("]", "help.armor", b']'),
            game("=", "help.rings", b'='),
            game("@", "help.stats", b'@'),
            game("D", "help.discoveries", b'D'),
            game("/", "help.identify", b'/'),
            game("?", "help.help", b'?'),
            reference("Ctrl + P", "help.recall"),
        ],
    ),
    (
        "mobile.group.repeat",
        &[
            game("a", "help.again", b'a'),
            reference("0 - 9", "commands.repeat"),
            reference("Esc", "help.cancel"),
        ],
    ),
    (
        "commands.group.selection",
        &[
            reference("a - z", "commands.choose"),
            reference("*", "commands.item_list"),
            reference("Tab / Shift + Tab", "commands.focus"),
            reference("Enter", "commands.activate"),
            reference("PageUp / PageDown", "commands.scroll"),
        ],
    ),
    (
        "commands.group.system",
        &[
            reference("o", "help.options"),
            game("Q", "help.quit", b'Q'),
            reference("Ctrl + R", "help.redraw"),
            reference("v", "help.version"),
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
        for (group, entries) in GROUPS {
            let heading = self.wrap(&self.t(group), table_width - 20., 16.);
            rows.push(ReferenceRow {
                height: heading.len() as f64 * 26. + 12.,
                key: heading,
                description: vec![],
                heading: true,
            });
            let entries = entries.iter().map(|entry| (entry.keys, entry.description)).chain(WEB_COMMANDS.iter()
                .filter(|command| command.group == *group)
                .map(|command| (command.key, command.label)));
            for (key, id) in entries {
                let mut label = if key.starts_with("commands.") {
                    self.t(key)
                } else {
                    key.replace("{pad}", &self.t("commands.keypad"))
                };
                if matches!(key, "f" | "F" | "t" | "z" | "m" | "^") || key == web_command(WebAction::Fire).key {
                    label.push_str(&format!(" + {}", self.t("commands.direction")));
                }
                let description = if id.starts_with("help.") {
                    self.mobile_help(id)
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
