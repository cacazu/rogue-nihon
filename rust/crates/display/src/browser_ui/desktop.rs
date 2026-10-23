//! Desktop controls use the same public context and original C keys as the phone.
use super::*;

fn action_columns(width: f64) -> usize {
    if width >= 780. { 5 } else if width >= 500. { 4 } else { 3 }
}
fn action_width(width: f64) -> f64 { (width - 200.).min(880.) }

// Keep the phone's fixed operations first, then its combat/item list order.
const ACTION_PRIORITY: [usize; 13] = [0,1,2,6,7,4,5,9,11,12,3,8,10];
fn visible_actions(columns: usize) -> Vec<usize> {
    let mut actions: Vec<_> = ACTION_PRIORITY.into_iter().take(columns * 3).collect();
    actions.sort_unstable();
    actions
}

pub(super) fn dock_height(width: f64) -> f64 {
    let columns = action_columns(action_width(width));
    let rows = visible_actions(columns).len().div_ceil(columns);
    16. + rows as f64 * 48. + (rows - 1) as f64 * 6. + 58.
}

impl BrowserUi {
    fn desktop_command(&mut self, id: &str, key: u32, label: &str, rect: Rect, disabled: bool) {
        let shortcut = if key == 27 { Some("Escape".into()) }
            else { char::from_u32(key).map(|key| key.to_string()) };
        self.control(id, label, rect, json!({"kind":"send","key":key}), ControlStyle {
            size:17., role:ControlRole::Command, shortcut,
            key:Some(json!(key)), disabled, ..Default::default()
        });
    }

    pub(super) fn draw_desktop_dock(&mut self, dock: Rect) {
        self.widgets.rect(dock, BG);
        let ui = self.model["frame"]["ui"].clone();
        let direction = b(&ui["movement_direction"]);
        let action_width = action_width(dock.w);
        let x = dock.x + (dock.w - action_width - 184.) / 2.;
        let right = !self.left_handed();
        let pad_x = if right { x + action_width + 28. } else { x };
        let left = if right { x } else { x + 184. };
        let pad_y = dock.y + dock.h - 164.;
        for action in array(&ui["map_controls"]["directions"]) {
            let key = n(&action["key"]) as u32;
            let emitted = self.movement_key(key);
            let label = if key == 46 { self.t("mobile.wait") } else { s(&action["text"]).into() };
            let button = Rect::new(pad_x + n(&action["column"])*54., pad_y + n(&action["row"])*54., 48.,48.);
            self.control(&format!("touch-{}",char::from_u32(key).unwrap_or(' ')), &label,
                button, json!({"kind":"send","key":emitted}), ControlStyle {
                    size:if key == 46 {17.} else {26.}, key:Some(json!(emitted)), custom:true,
                    shortcut:Some(if emitted & rogue_contract::RG_EVENT_CTRL != 0 {
                        format!("Ctrl+{}",char::from_u32(key).unwrap())
                    } else {char::from_u32(emitted).unwrap_or('.').to_string()}),
                    throw_direction:direction, ..Default::default()
                });
            let color = if direction { "@background" } else { TEXT };
            self.widgets.single_line(&label,Rect::new(button.x,button.y+2.,48.,27.),
                LineStyle {text:TextStyle::new(if key == 46 {15.} else {24.},color,false),center:true,ellipsis:false},self.measure);
            let hint = self.widgets.controls.last().and_then(|control| control.shortcut.clone()).unwrap_or_default();
            self.widgets.single_line(&hint,Rect::new(button.x,button.y+30.,48.,15.),
                LineStyle {text:TextStyle::new(12.,color,false),center:true,ellipsis:false},self.measure);
        }
        let columns = action_columns(action_width);
        let width = (action_width - (columns-1) as f64*8.) / columns as f64;
        let top = dock.y + 66.;
        let rect = |index:usize| {
            let column = if right { columns - 1 - index % columns } else { index % columns };
            Rect::new(left + column as f64*(width+8.), top + (index/columns) as f64*54.,width,48.)
        };
        let disabled = !self.command_ready();
        for (slot, action) in visible_actions(columns).into_iter().enumerate() {
            let rect = rect(slot);
            match action {
                0 => self.mobile_movement_control(rect),
                1 => self.desktop_command("pc-inventory",105,&self.t("action.inventory"),rect,disabled),
                2 => self.desktop_command("pc-search",115,&self.t("mobile.search"),rect,disabled),
                3 => self.desktop_command("pc-wield",119,&self.t("mobile.weapon"),rect,disabled),
                4 => self.desktop_command("pc-throw",116,&self.t("mobile.throw"),rect,disabled),
                5 => self.desktop_command("pc-zap",122,&self.mobile_help("inventory.zap"),rect,disabled),
                6 => self.web_control(WebAction::FullMap,"mobile-full-map",&self.t("mobile.full_map"),rect,ControlStyle {size:17.,disabled,..Default::default()}),
                7 => self.draw_repeat_button(rect),
                8 => self.desktop_command("pc-armor",87,&self.t("inventory.tab.armor"),rect,disabled),
                9 => self.desktop_command("pc-quaff",113,&self.mobile_help("action.quaff"),rect,disabled),
                10 => self.desktop_command("pc-ring",80,&self.t("inventory.tab.ring"),rect,disabled),
                11 => self.desktop_command("pc-read",114,&self.t("mobile.read"),rect,disabled),
                12 => self.desktop_command("pc-eat",101,&self.mobile_help("action.eat"),rect,disabled),
                _ => unreachable!(),
            }
        }

        if direction {
            self.desktop_command("pc-cancel",27,&self.t("action.cancel_short"),
                Rect::new(left + (action_width - action_width.min(220.))/2.,dock.y + 8.,action_width.min(220.),48.),false);
            return;
        }

        let context = self.map_context_commands();
        let fire = b(&ui["ranged"]["bow"]);
        let count = context.len() + usize::from(fire);
        if count == 0 { return; }
        let context_width = ((action_width - (count-1) as f64*8.) / count as f64).min(180.);
        let context_left = left + (action_width - (count as f64*context_width + (count-1) as f64*8.))/2.;
        let context_rect = |index:usize| {
            let column = if right { count - 1 - index } else { index };
            Rect::new(context_left + column as f64*(context_width+8.),dock.y + 8.,context_width,48.)
        };
        for (index,(key,label)) in context.iter().enumerate() {
            let id = match key {60=>"pc-ascend",62=>"pc-descend",94=>"pc-trap",44=>"pc-pickup",_=>unreachable!()};
            self.desktop_command(id,*key,&self.t(label),context_rect(index),disabled);
        }
        if fire {
            self.web_control(WebAction::Fire,"pc-fire",&self.t("mobile.fire"),context_rect(context.len()),
                ControlStyle {size:17.,disabled,..Default::default()});
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn three_rows_keep_phone_operations_then_list_priority_in_display_order() {
        assert_eq!(visible_actions(3),vec![0,1,2,4,5,6,7,9,11]);
        assert_eq!(visible_actions(4),vec![0,1,2,3,4,5,6,7,8,9,11,12]);
        assert_eq!(visible_actions(5),(0..13).collect::<Vec<_>>());
        for width in [699.,700.,979.,980.,1400.] {assert_eq!(dock_height(width),230.);}
    }
}
