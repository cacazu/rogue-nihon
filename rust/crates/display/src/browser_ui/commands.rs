//! Shared command identities and the PC binding reference.
use super::*;
mod table;

#[derive(Clone, Copy)]
pub(super) enum CommandAction { Key(u32), Direction(u32), Web(WebAction), Context }
#[derive(Clone)]
pub(super) struct CommandDefinition {
    pub id: &'static str,
    pub label: &'static str,
    pub group: &'static str,
    pub action: CommandAction,
}
pub(super) fn key_id(key:u32)->Option<&'static str> {
    Some(match key {
        104=>"game.move-left",106=>"game.move-down",107=>"game.move-up",108=>"game.move-right",
        121=>"game.move-up-left",117=>"game.move-up-right",98=>"game.move-down-left",110=>"game.move-down-right",
        109=>"game.move-without-pickup",46=>"game.rest",115=>"game.search",44=>"game.pickup",62=>"game.downstairs",60=>"game.upstairs",94=>"game.trap",
        102=>"game.fight-carefully",70=>"game.fight-to-death",116=>"game.throw",122=>"game.zap",113=>"game.quaff",114=>"game.read",101=>"game.eat",119=>"game.wield",87=>"game.wear",84=>"game.take-off",80=>"game.put-ring",82=>"game.remove-ring",100=>"game.drop",99=>"game.call",105=>"game.inventory",73=>"game.inventory-one",41=>"game.weapon",93=>"game.armor",61=>"game.rings",64=>"game.stats",68=>"game.discoveries",47=>"game.identify",63=>"game.help",97=>"game.again",81=>"game.quit",111=>"game.options",118=>"game.version",16=>"game.recall",18=>"game.redraw",
        _=>return None,
    })
}
pub(super) fn web_id(action:WebAction)->&'static str {
    match action { WebAction::Movement=>"web.movement",WebAction::FullMap=>"web.full-map",WebAction::Fire=>"web.fire",WebAction::Repeat=>"web.repeat",WebAction::RepeatCount=>"web.repeat-count",WebAction::Commands=>"web.commands",WebAction::Settings=>"web.settings",WebAction::Fullscreen=>"web.fullscreen",WebAction::Controls=>"web.controls",WebAction::History=>"web.history" }
}
const RUN_COMMANDS: &[(&str,&str,u8)] = &[
    ("game.run-left","help.left",b'H'),("game.run-down","help.down",b'J'),("game.run-up","help.up",b'K'),("game.run-right","help.right",b'L'),
    ("game.run-up-left","help.up_left",b'Y'),("game.run-up-right","help.up_right",b'U'),("game.run-down-left","help.down_left",b'B'),("game.run-down-right","help.down_right",b'N'),
    ("game.run-adjacent-left","help.left",8),("game.run-adjacent-down","help.down",10),("game.run-adjacent-up","help.up",11),("game.run-adjacent-right","help.right",12),
    ("game.run-adjacent-up-left","help.up_left",25),("game.run-adjacent-up-right","help.up_right",21),("game.run-adjacent-down-left","help.down_left",2),("game.run-adjacent-down-right","help.down_right",14),
];
pub(super) fn all_commands()->Vec<CommandDefinition> {
    let mut out=Vec::new();
    for (group,entries) in GROUPS {
        for entry in *entries {
            if let Some(action)=entry.phone_action {
                let (key,action)=match action {GameAction::Key(key)=>(key,CommandAction::Key(key)),GameAction::Direction(key)=>(key,CommandAction::Direction(key))};
                if let Some(id)=key_id(key) {out.push(CommandDefinition {id,label:entry.description,group,action});}
            }
        }
        if *group=="mobile.group.movement" {
            for &(id,label,key) in RUN_COMMANDS {out.push(CommandDefinition {id,label,group,action:CommandAction::Key(u32::from(key))});}
        }
        for c in WEB_COMMANDS.iter().filter(|c| c.group==*group) {out.push(CommandDefinition {id:web_id(c.action),label:c.label,group,action:CommandAction::Web(c.action)});}
    }
    for (key,label,group) in [(16,"help.recall","mobile.group.info"),(111,"help.options","commands.group.system"),(18,"help.redraw","commands.group.system"),(118,"help.version","commands.group.system")] {
        out.push(CommandDefinition {id:key_id(key).unwrap(),label,group,action:CommandAction::Key(key)});
    }
    out.push(CommandDefinition {id:"web.context",label:"mobile.search",group:"mobile.group.movement",action:CommandAction::Context});
    out
}
pub(super) fn command(id:&str)->Option<CommandDefinition> {all_commands().into_iter().find(|c|c.id==id)}

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


}

impl BrowserUi {
    pub(super) fn command_bindings(&self,id:&str)->Vec<keybindings::KeyBinding> {
        self.controls_preferences.bindings.get(id).cloned().unwrap_or_else(||keybindings::default_bindings().remove(id).unwrap_or_default())
    }
    pub(super) fn command_shortcut(&self,id:&str)->Option<String> {
        if !self.pc_controls() {return None;}
        let keys=self.command_bindings(id);
        keys.first().map(keybindings::KeyBinding::label).or_else(|| {
            if id!="web.context" {return None;}
            key_id(self.mobile_context_command().0).and_then(|resolved|self.command_bindings(resolved).first().map(keybindings::KeyBinding::label))
        })
    }
    pub(super) fn command_label(&self,id:&str)->String {
        let Some(c)=command(id) else{return String::new();};
        if matches!(c.action,CommandAction::Context) {return self.t(self.mobile_context_command().1);}
        let label=if c.label.starts_with("help.") {self.mobile_help(c.label)} else {self.t(c.label)};
        if id.starts_with("game.run-") {format!("{} ({label})",self.mobile_help(if id.starts_with("game.run-adjacent-") {"help.run_adjacent"} else {"help.run"}))} else {label}
    }
    pub(super) fn command_available(&self,id:&str)->bool {
        let Some(c)=command(id) else{return false;};
        if let CommandAction::Web(action)=c.action {return self.web_available(action);}
        if !self.command_ready() {return false;}
        let ui=&self.model["frame"]["ui"];
        match c.action {
            CommandAction::Key(60)=>b(&ui["map_controls"]["stairs"]["ascend"]),
            CommandAction::Key(62)=>b(&ui["map_controls"]["stairs"]["descend"]),
            CommandAction::Key(44)=>!b(&ui["player_state"]["levitating"]) && self.model["frame"]["map_player_surface"]["tile"].as_u64().is_some_and(|tile|(14..=22).contains(&tile)),
            _=>true,
        }
    }
    pub(super) fn command_input_key(&self,key:u32)->u32 {
        if !b(&self.view["coarse"]) && self.command_ready() {
            match key {116=>rogue_contract::RG_KEY_SELECT_THROW,122=>rogue_contract::RG_KEY_SELECT_ZAP,_=>key}
        } else {key}
    }
    pub(super) fn activate_command(&mut self,id:&str,effects:&mut Vec<Value>) {
        if !self.command_available(id) {return;}
        let Some(c)=command(id) else{return;};
        self.mobile_operations=false;
        match c.action {
            CommandAction::Web(action)=>self.activate_web(action,effects),
            CommandAction::Direction(key)=>effects.push(json!({"kind":"send","key":self.movement_key(key)})),
            CommandAction::Context=>effects.push(json!({"kind":"send","key":self.command_input_key(self.mobile_context_command().0)})),
            CommandAction::Key(key)=>{
                if key==64 {self.open_status();}
                effects.push(json!({"kind":"send","key":self.command_input_key(key)}));
            }
        }
    }
    pub(super) fn command_control(&mut self,command_id:&str,id:&str,rect:Rect,mut style:ControlStyle<'_>) {
        style.shortcut=self.command_shortcut(command_id);style.disabled|=!self.command_available(command_id);style.role=ControlRole::Command;
        if let Some(c)=command(command_id) {style.key=match c.action {CommandAction::Key(key)|CommandAction::Direction(key)=>Some(json!(self.command_input_key(key))),CommandAction::Context=>Some(json!(self.command_input_key(self.mobile_context_command().0))),_=>style.key};}
        self.control(id,&self.command_label(command_id),rect,json!({"kind":"command","id":command_id}),style);
    }
}
