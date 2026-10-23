//! Desktop controls use the same public context and original C keys as the phone.
use super::*;

fn action_columns(width: f64) -> usize {
    if width >= 780. { 5 } else if width >= 500. { 4 } else { 3 }
}
fn action_width(width: f64) -> f64 { (width - 200.).min(880.) }

pub(super) fn dock_height(width: f64) -> f64 {
    let rows = 14_usize.div_ceil(action_columns(action_width(width)));
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
        let cell = |index:usize,span:usize| {
            let column = if right { columns - span - index % columns } else { index % columns };
            Rect::new(left + column as f64*(width+8.), top + (index/columns) as f64*54.,width*span as f64+8.*(span-1) as f64,48.)
        };
        let rect = |index| cell(index,1);
        // Reserve two columns for the repeat count and its keyboard shortcut.
        let repeat_index = if 7 % columns == columns-1 { 8 } else { 7 };
        let disabled = !self.command_ready();
        self.mobile_movement_control(rect(0));
        self.desktop_command("pc-inventory",105,&self.t("action.inventory"),rect(1),disabled);
        self.desktop_command("pc-search",115,&self.t("mobile.search"),rect(2),disabled);
        self.desktop_command("pc-wield",119,&self.t("mobile.weapon"),rect(3),disabled);
        self.desktop_command("pc-throw",116,&self.t("mobile.throw"),rect(4),disabled);
        self.desktop_command("pc-zap",122,&self.mobile_help("inventory.zap"),rect(5),disabled);
        self.web_control(WebAction::FullMap,"mobile-full-map",&self.t("mobile.full_map"),rect(6),ControlStyle {size:17.,disabled,..Default::default()});
        self.draw_repeat_button(cell(repeat_index,2));
        self.desktop_command("pc-armor",87,&self.t("inventory.tab.armor"),rect(repeat_index+2),disabled);
        self.desktop_command("pc-quaff",113,&self.mobile_help("action.quaff"),rect(repeat_index+3),disabled);
        self.desktop_command("pc-ring",80,&self.t("inventory.tab.ring"),rect(repeat_index+4),disabled);
        self.desktop_command("pc-read",114,&self.t("mobile.read"),rect(repeat_index+5),disabled);
        self.desktop_command("pc-eat",101,&self.mobile_help("action.eat"),rect(repeat_index+6),disabled);

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
