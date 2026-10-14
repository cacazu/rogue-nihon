//! Equipment slots and parameter icons use public descriptors, not translated text.
use super::*;

pub(super) fn parameter_icon(field: &str) -> &'static str {
    match field {
        "hplus" => "item-hit",
        "dplus" => "item-damage",
        "enchantment" => "item-enchantment",
        "protection" => "shield",
        "strength" => "strength",
        "bonus" => "item-modifier",
        "charges" => "item-charges",
        _ => "",
    }
}

pub(super) fn parameter_color(icon: &str) -> &'static str {
    match icon {
        "item-hit" => "#efd18e",
        "item-damage" => "#f5a6aa",
        "item-enchantment" => "#d0bbef",
        "shield" => "#9dcbe9",
        "strength" => "#d0bbef",
        "item-modifier" => "#f1b27a",
        "item-charges" => ACCENT,
        _ => TEXT,
    }
}

struct PaintRun {
    text: String,
    icon: String,
    x: f64,
    y: f64,
    width: f64,
}

impl BrowserUi {
    pub(super) fn draw_parameter_icon(&mut self, icon: &str, rect: Rect) {
        let color = parameter_color(icon);
        if icon == "strength" {
            self.widgets.glyph_icon(icon, "💪", rect, color, self.measure);
        } else {
            self.widgets.icon(icon, rect, color);
        }
    }
    pub(super) fn inventory_item_row(&self, source: &Value, mobile: bool) -> Value {
        let mut row = source.clone();
        let item = array(&self.model["frame"]["ui"]["lines"]).iter()
            .find(|line| line["id"] == "ui.inventory.entry")
            .map(|line| line["args"][1]["value"].clone()).unwrap_or(Value::Null);
        let field = s(&row["parameter"]).to_string();
        let kind = crate::inventory::parameter_kind(&item, &field);
        let icon = parameter_icon(kind);
        if !icon.is_empty() {
            if field == "bonus" && kind != "bonus"
                && let Some((_, value)) = crate::inventory::parameters(&item).into_iter().find(|(field, _)| *field == "bonus") {
                row["text"] = json!(format!("{}：{value}",self.t(&format!("log.parameter.{kind}"))));
            }
            row["item_runs"] = json!([{"icon":icon,"text":s(&row["text"])}]);
            return row;
        }
        if row["id"] != "ui.inventory.entry" { return row; }
        let slot = match s(&row["args"][1]["value"]["equipped"]) {
            "weapon" => self.t("inventory.slot.hand"),
            "right_ring" => self.t("inventory.slot.right_hand"),
            "armor" => self.t("inventory.slot.body"),
            "left_ring" => self.t("inventory.slot.left_hand"),
            _ => String::new(),
        };
        let mut args = row["args"].clone();
        if !slot.is_empty() {
            // Suppress only the naming suffix; the original descriptor remains
            // intact for equipment slots, item actions and both ring hands.
            args[1]["value"]["describe"] = json!(false);
        }
        crate::identity::replace_player_names(&mut args,s(&self.model["frame"]["ui"]["name"]));
        // Render the browser row from its descriptor in both languages. C's
        // original English screen and messages keep their authoritative text.
        row["text"] = json!(crate::display::message_language(
            "ui.inventory.entry",&args,"",s(&self.model["language"])
        ).text);
        row["equipped_slot"] = json!(slot);
        let parameters = crate::inventory::parameters(&args[1]["value"]);
        // Build the name without numeric forms; literal player labels and
        // appearances never undergo label replacement or icon-token parsing.
        let mut name_args = args;
        for field in ["hplus", "dplus", "ac", "ring_bonus", "charges"] {
            name_args[1]["value"]["visible_fields"][field] = json!(false);
        }
        let name = crate::display::message_language(
            "ui.inventory.entry", &name_args, "", s(&self.model["language"])
        ).text;
        let name = if mobile && name.get(1..3) == Some(") ") { &name[3..] } else { &name };
        let mut runs = vec![json!({"text":name})];
        if !parameters.is_empty() {
            runs.push(json!({"text":" ("}));
            for (index, (field, value)) in parameters.into_iter().enumerate() {
                if index > 0 { runs.push(json!({"text":" "})); }
                let value = if matches!(field, "hplus" | "dplus" | "enchantment" | "bonus") {
                    format!("{value:+}")
                } else { value.to_string() };
                let kind = crate::inventory::parameter_kind(&row["args"][1]["value"],field);
                runs.push(json!({"icon":parameter_icon(kind),"text":value}));
            }
            runs.push(json!({"text":")"}));
        }
        row["item_runs"] = json!(runs);
        row
    }

    fn inventory_item_layout(&self, row: &Value, width: f64, font: f64) -> (Vec<PaintRun>, f64) {
        let height = (font * 1.65).ceil();
        let mut layout: Vec<PaintRun> = Vec::new();
        let (mut x, mut y) = (0., 0.);
        for run in array(&row["item_runs"]) {
            let icon = s(&run["icon"]);
            if !icon.is_empty() {
                // Keep a parameter icon and its value together on wrapping.
                let w = 22. + (self.measure)(s(&run["text"]), font, false, false).width;
                if x > 0. && x + w > width { x = 0.; y += height; }
                layout.push(PaintRun { text:s(&run["text"]).into(), icon:icon.into(), x, y, width:w });
                x += w;
                continue;
            }
            for ch in s(&run["text"]).chars() {
                let append = layout.last().is_some_and(|last| last.icon.is_empty() && last.y == y);
                let mut next = if append { layout.last().unwrap().text.clone() } else { String::new() };
                next.push(ch);
                let w = (self.measure)(&next, font, false, false).width;
                let delta = w - if append { layout.last().unwrap().width } else { 0. };
                if x > 0. && x + delta > width {
                    x = 0.; y += height;
                    if ch == ' ' { continue; }
                } else if append {
                    let last = layout.last_mut().unwrap();
                    last.text = next; last.width = w; x += delta;
                    continue;
                }
                let text = ch.to_string();
                let w = (self.measure)(&text, font, false, false).width;
                layout.push(PaintRun { text, icon:String::new(), x, y, width:w });
                x += w;
            }
        }
        (layout, y + height)
    }

    pub(super) fn inventory_item_height(&self, row: &Value, width: f64, font: f64) -> f64 {
        self.inventory_item_layout(row, width - self.inventory_slot_width(row, font), font).1
    }

    fn inventory_slot_width(&self, row: &Value, font: f64) -> f64 {
        let slot = s(&row["equipped_slot"]);
        if slot.is_empty() { 0. } else { (self.measure)(slot, font, true, false).width + 12. }
    }

    pub(super) fn draw_inventory_item(&mut self, row: &Value, rect: Rect, selectable: bool, font: f64) {
        let left = if selectable { 10. } else { 4. };
        let right = if selectable { 10. } else { 8. };
        let slot_width = self.inventory_slot_width(row, font);
        let text_width = rect.w - left - right - slot_width;
        let icon_top = (font-20.)/2.;
        let (layout, height) = self.inventory_item_layout(row, text_width, font);
        let top = if selectable { ((rect.h-height)/2.).max(4.) } else { 4. };
        if slot_width > 0. {
            self.widgets.raw_text(s(&row["equipped_slot"]),rect.x+rect.w-right-slot_width+12.,rect.y+top,TextStyle::new(font,ACCENT,true));
        }
        for run in layout {
            let x = rect.x + left + run.x;
            let y = rect.y + top + run.y;
            let inset = if run.icon.is_empty() { 0. } else {
                self.draw_parameter_icon(&run.icon, Rect::new(x, y+icon_top,20.,20.));
                22.
            };
            self.widgets.raw_text(&run.text,x+inset,y,TextStyle::new(font,TEXT,false));
        }
    }
}
