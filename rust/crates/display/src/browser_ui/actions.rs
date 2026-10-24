//! Web-only commands share labels, shortcuts and actions across both layouts.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum WebAction { Explore, Movement, FullMap, Fire, Repeat, RepeatCount, Commands, Settings, Fullscreen, Controls, History }

pub(super) struct WebCommand {
    pub action: WebAction,
    pub id: &'static str,
    pub key: &'static str,
    pub label: &'static str,
    pub group: &'static str,
}

pub(super) const WEB_COMMANDS: &[WebCommand] = &[
    WebCommand { action:WebAction::Explore, id:"explore", key:"v", label:"mobile.explore", group:"mobile.group.movement" },
    WebCommand { action:WebAction::Movement, id:"movement", key:"g", label:"commands.movement_mode", group:"mobile.group.movement" },
    WebCommand { action:WebAction::FullMap, id:"full-map", key:"p", label:"mobile.full_map", group:"mobile.group.info" },
    WebCommand { action:WebAction::Fire, id:"fire", key:"x", label:"mobile.fire", group:"mobile.group.combat" },
    WebCommand { action:WebAction::Repeat, id:"repeat", key:"E", label:"commands.configured_repeat", group:"mobile.group.repeat" },
    WebCommand { action:WebAction::RepeatCount, id:"repeat-count", key:"A", label:"mobile.repeat_count", group:"mobile.group.repeat" },
    WebCommand { action:WebAction::Commands, id:"commands", key:"C", label:"commands.title", group:"mobile.group.info" },
    WebCommand { action:WebAction::Settings, id:"settings", key:"O", label:"action.settings", group:"commands.group.system" },
    WebCommand { action:WebAction::Fullscreen, id:"fullscreen", key:"G", label:"action.fullscreen", group:"commands.group.system" },
    WebCommand { action:WebAction::Controls, id:"controls", key:"V", label:"commands.controls", group:"commands.group.system" },
    WebCommand { action:WebAction::History, id:"history", key:"M", label:"mobile.log", group:"mobile.group.info" },
];

pub(super) fn web_command(action: WebAction) -> &'static WebCommand {
    WEB_COMMANDS.iter().find(|command| command.action == action).expect("web command")
}

impl BrowserUi {
    /// A phone command-list direction and the visible pad use the same mode.
    pub(super) fn movement_key(&self, key: u32) -> u32 {
        if b(&self.model["frame"]["ui"]["movement_direction"]) || key == 46 { return key; }
        rogue_contract::movement_mode_key(key, self.mobile_movement)
    }

    pub(super) fn command_ready(&self) -> bool {
        b(&self.model["running"]) && !b(&self.model["topOpen"])
            && !b(&self.model["starting"]) && !b(&self.model["savePending"])
            && !b(&self.model["returnAfterEnd"])
            && self.model["input"]["kind"] == "command"
            && !self.model["frame"]["ui"]["window"].is_object()
            && !b(&self.model["frame"]["ui"]["movement_direction"])
    }

    pub(super) fn web_available(&self, action: WebAction) -> bool {
        if b(&self.model["frame"]["ui"]["movement_direction"]) && (self.pc_controls() || action == WebAction::FullMap) { return false; }
        if matches!(action, WebAction::Explore | WebAction::Movement | WebAction::Fire | WebAction::Repeat | WebAction::RepeatCount)
            && !self.command_ready() { return false; }
        action != WebAction::Fire || (b(&self.model["frame"]["ui"]["ranged"]["bow"])
            && self.model["frame"]["ui"]["ranged"]["arrow_key"].as_u64().is_some_and(|key| (97..=122).contains(&key)))
    }

    pub(super) fn web_control(&mut self, action: WebAction, id: &str, label: &str, rect: Rect, mut style: ControlStyle<'_>) {
        let command = web_command(action);
        style.shortcut = self.command_shortcut(commands::web_id(action));
        style.disabled |= !self.web_available(action);
        self.control(id, label, rect, json!({"kind":"web","id":command.id}), style);
    }

    pub(super) fn activate_web(&mut self, action: WebAction, effects: &mut Vec<Value>) {
        if !self.web_available(action) { return; }
        self.feedback_command(commands::web_id(action));
        match action {
            WebAction::Explore => {
                self.mobile_operations = false;
                effects.push(json!({"kind":"invoke","id":"auto-explore"}));
            },
            WebAction::Movement => {
                self.mobile_operations = false;
                self.mobile_movement = (self.mobile_movement + 1) % 3;
            },
            WebAction::FullMap => {
                self.mobile_full_map = !self.mobile_full_map;
                self.mobile_overview = self.mobile_full_map;
                self.mobile_operations = false;
                self.center_key.clear();
            }
            WebAction::Fire => {
                self.mobile_operations = false;
                effects.push(json!({"kind":"send","key":rogue_contract::RG_KEY_FIRE}));
            }
            WebAction::Repeat => {
                self.mobile_operations = false;
                let mut keys = if self.mobile_repeat_count > 1 {
                    self.mobile_repeat_count.to_string().bytes().map(u32::from).collect::<Vec<_>>()
                } else { Vec::new() };
                keys.push(97);
                effects.push(json!({"kind":"send","keys":keys}));
            }
            WebAction::RepeatCount => {
                self.mobile_operations = false;
                self.open_repeat_count(effects);
            }
            WebAction::Commands => {
                self.stop_hold();
                if !self.pc_controls() {
                    self.mobile_operations = !self.mobile_operations;
                    self.scrolls.insert("mobile-operations".into(), 0.);
                } else {
                    self.commands_open = !self.commands_open;
                    self.scrolls.insert("commands".into(), 0.);
                }
            }
            WebAction::Settings => {
                self.mobile_operations = false;
                effects.push(json!({"kind":"invoke","id":"settings-toggle"}));
            }
            WebAction::Fullscreen => effects.push(json!({"kind":"invoke","id":"fullscreen"})),
            WebAction::Controls => {
                self.mobile_controls = !self.mobile_controls;
                self.mobile_operations = false;
            }
            WebAction::History => {
                self.mobile_operations = false;
                self.history_open = true;
                self.follow_log = true;
            }
        }
    }

    /// Web bindings are exact-case commands, separate from modal choice aliases.
    pub(super) fn web_key(&mut self, event: &Value, effects: &mut Vec<Value>) -> bool {
        if b(&self.view["coarse"]) || !self.command_ready() || !s(&event["native"]).is_empty()
            || b(&event["ctrlKey"]) || b(&event["altKey"]) || b(&event["metaKey"])
            || b(&event["composing"]) || n(&event["keyCode"]) == 229.
            || self.commands_open || self.mobile_operations || self.history_open || self.status_open
            || self.mobile_repeat_open || !self.dropdown.is_empty() || b(&self.model["settingsOpen"]) {
            return false;
        }
        let Some(command) = WEB_COMMANDS.iter().find(|command| command.key == s(&event["key"])) else { return false; };
        // A held toggle is consumed without repeatedly changing UI state.
        if !b(&event["repeat"]) { self.activate_web(command.action, effects); }
        true
    }

    pub(super) fn web_modal_close_key(&self, event: &Value, action: WebAction) -> bool {
        keybindings::KeyBinding::from_event(event).is_some_and(|key| self.command_bindings(commands::web_id(action)).contains(&key))
            && !b(&event["repeat"]) && s(&event["native"]).is_empty()
    }
}
