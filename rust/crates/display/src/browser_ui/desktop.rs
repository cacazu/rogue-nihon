//! Desktop controls share the phone's context, movement and original C keys.
use super::*;

pub(super) const DOCK_HEIGHT: f64 = 172.;

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
        let action_width = (dock.w - 200.).min(880.);
        let x = dock.x + (dock.w - action_width - 184.) / 2.;
        for action in array(&ui["map_controls"]["directions"]) {
            let key = n(&action["key"]) as u32;
            let emitted = self.movement_key(key);
            let label = if key == 46 { self.t("mobile.wait") } else { s(&action["text"]).into() };
            self.control(&format!("touch-{}",char::from_u32(key).unwrap_or(' ')), &label,
                Rect::new(x + n(&action["column"])*54., dock.y + 8. + n(&action["row"])*54., 48., 48.),
                json!({"kind":"send","key":emitted}), ControlStyle {
                    size:if key == 46 {17.} else {26.}, key:Some(json!(emitted)), custom:true,
                    shortcut:Some(if emitted & rogue_contract::RG_EVENT_CTRL != 0 {
                        format!("Ctrl+{}",char::from_u32(key).unwrap())
                    } else {char::from_u32(emitted).unwrap_or('.').to_string()}),
                    throw_direction:direction, ..Default::default()
                });
            let button = Rect::new(x + n(&action["column"])*54., dock.y + 8. + n(&action["row"])*54., 48.,48.);
            let color = if direction { "@background" } else { TEXT };
            self.widgets.single_line(&label,Rect::new(button.x,button.y+2.,48.,27.),
                LineStyle {text:TextStyle::new(if key == 46 {15.} else {24.},color,false),center:true,ellipsis:false},self.measure);
            let hint = self.widgets.controls.last().and_then(|control| control.shortcut.clone()).unwrap_or_default();
            self.widgets.single_line(&hint,Rect::new(button.x,button.y+30.,48.,15.),
                LineStyle {text:TextStyle::new(12.,color,false),center:true,ellipsis:false},self.measure);
        }
        let left = x + 184.;
        if direction {
            self.desktop_command("pc-cancel",27,&self.t("action.cancel_short"),
                Rect::new(left,dock.y + 62.,action_width.min(220.),48.),false);
            return;
        }
        let columns = if action_width >= 660. {4} else {3};
        let rows = 8_usize.div_ceil(columns);
        let width = (action_width - (columns-1) as f64*8.) / columns as f64;
        let top = dock.y + (dock.h - (rows as f64*48. + (rows-1) as f64*6.)) / 2.;
        let rect = |index:usize| Rect::new(left + (index%columns) as f64*(width+8.),
            top + (index/columns) as f64*54.,width,48.);
        let disabled = self.model["input"]["kind"] != "command";
        self.mobile_movement_control(rect(0));
        self.desktop_command("pc-inventory",105,&self.t("action.inventory"),rect(1),disabled);
        let (key,label) = self.mobile_context_command();
        self.desktop_command("pc-context",key,&self.t(label),rect(2),disabled);
        self.desktop_command("pc-wield",119,&self.t("mobile.weapon"),rect(3),disabled);
        if b(&ui["ranged"]["bow"]) {
            let arrow = ui["ranged"]["arrow_key"].as_u64().is_some_and(|key| (97..=122).contains(&key));
            self.web_control(WebAction::Fire,"pc-fire",&self.t("mobile.fire"),rect(4),ControlStyle {size:17.,disabled:disabled || !arrow,..Default::default()});
        } else {
            self.desktop_command("pc-throw",116,&self.t("mobile.throw"),rect(4),disabled);
        }
        self.desktop_command("pc-zap",122,&self.mobile_help("help.zap"),rect(5),disabled);
        self.web_control(WebAction::FullMap,"mobile-full-map",&self.t("mobile.full_map"),rect(6),ControlStyle {size:17.,..Default::default()});
        self.draw_repeat_button(rect(7));
    }
}
