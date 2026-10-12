//! Equipment badges derive from public item descriptors, not translated text.
use super::*;

impl BrowserUi {
    pub(super) fn inventory_item_row(&self, source: &Value) -> Value {
        let mut row = source.clone();
        if row["id"] != "ui.inventory.entry" { return row; }
        let equipped = matches!(s(&row["args"][1]["value"]["equipped"]), "weapon" | "armor" | "left_ring" | "right_ring");
        let mut args = row["args"].clone();
        if equipped {
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
        row["equipped_icon"] = json!(equipped);
        row
    }

    pub(super) fn draw_equipped_item(&mut self, text: &str, rect: Rect, selectable: bool, font: f64) {
        let left = if selectable { 10. } else { 4. };
        let text_width = rect.w - left - if selectable { 10. } else { 8. } - 26.;
        let line_height = (font*1.65).ceil();
        let lines = self.wrap(text,text_width,font).len() as f64;
        let top = if selectable { ((rect.h-lines*line_height)/2.).max(4.) } else { 4. };
        self.widgets.icon("equipped",Rect::new(rect.x+left,rect.y+top+(line_height-20.)/2.,20.,20.),ACCENT);
        self.text(text,rect.x+left+26.,rect.y+top,text_width,font,TEXT,false);
    }
}
