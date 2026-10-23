//! Event decoding and UTF-8 editing state, independent of C and storage.
use crate::{Input, decode, decode_in_window, decode_movement_direction, inventory::Inventory};
use rogue_contract::*;
use serde_json::Value;
use std::collections::VecDeque;

#[derive(bevy::prelude::Resource, Default)]
pub struct State {
    pub inventory: Inventory,
    text_mode: bool,
    text_limit: usize,
    text_bytes: Vec<u8>,
    text_pending: VecDeque<i32>,
    current_text: Option<String>,
    target_run_start: bool,
    pub target_run: crate::target_run::Permit,
    deferred_event: Option<u32>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn initial_value_does_not_fill_the_consumed_editor_and_partial_utf8_is_not_published() {
        let mut state = State::default();
        let ui = json!({"input":{"kind":"text"}});
        state.begin_text(3, "旧名");
        assert_eq!(state.current_text(), Some("旧名"));
        let Input::Key(first) = state.decode('勇' as u32, &ui, true) else {
            panic!("initial display must not consume the edit limit");
        };
        state.accepted(first);
        assert_eq!(state.current_text(), Some("旧名"));
        while let Some(key) = state.pending_key() {
            state.accepted(key);
        }
        assert_eq!(state.current_text(), Some("勇"));
        assert_eq!(state.decode('者' as u32, &ui, true), Input::Ignore);
        state.accepted(8);
        assert_eq!(state.current_text(), Some(""));
        state.end_text();
        assert_eq!(state.current_text(), None);
        assert_eq!(state.pending_key(), None);
        assert_eq!(state.decode('勇' as u32, &ui, true), Input::Ignore);
    }
}
impl State {
    /// C starts with an empty edit buffer even when the view shows an existing
    /// value. Keep that initial view separate from bytes C has consumed.
    pub fn begin_text(&mut self, limit: usize, initial: &str) {
        self.text_mode = true;
        self.text_limit = limit.min(50);
        self.text_bytes.clear();
        self.text_pending.clear();
        self.current_text = Some(initial.into());
    }

    pub fn end_text(&mut self) {
        self.text_mode = false;
        self.text_limit = 0;
        self.text_bytes.clear();
        self.text_pending.clear();
        self.current_text = None;
    }

    pub fn pending_key(&mut self) -> Option<i32> {
        self.text_pending.pop_front()
    }

    pub fn mark_target_run_start(&mut self) { self.target_run_start = true; }
    pub fn take_target_run_start(&mut self) -> bool { std::mem::take(&mut self.target_run_start) }
    pub fn defer_event(&mut self, raw: u32) { self.deferred_event = Some(raw); }
    pub fn take_deferred_event(&mut self) -> Option<u32> { self.deferred_event.take() }

    pub fn text_limit(&self) -> usize {
        self.text_limit
    }

    /// An immutable projection for display, including the last complete UTF-8
    /// value while a multibyte character is still being consumed.
    pub fn current_text(&self) -> Option<&str> {
        self.current_text.as_deref()
    }

    pub fn decode(&mut self, raw: u32, ui: &Value, window_open: bool) -> Input {
        let scalar = raw & RG_EVENT_SCALAR_MASK;
        if raw == RG_KEY_SELECT_THROW || raw == RG_KEY_SELECT_ZAP {
            return self.inventory.select_first(if raw == RG_KEY_SELECT_THROW { 116 } else { 122 }, ui);
        }
        if raw == RG_KEY_FIRE {
            return self.inventory.fire(ui);
        }
        if let Input::Key(key) = decode(raw)
            && let Some(decoded) = self.inventory.handle(key, ui)
        {
            return decoded;
        }
        if self.text_mode && scalar == 127 && raw & RG_EVENT_ALT == 0 {
            Input::Key(8)
        } else if self.text_mode
            && scalar > 127
            && scalar <= 0x10ffff
            && raw & (RG_EVENT_CTRL | RG_EVENT_ALT) == 0
        {
            let mut decoded = Input::Ignore;
            if let Some(character) = char::from_u32(scalar).filter(|c| !c.is_control()) {
                let mut buffer = [0_u8; 4];
                let bytes = character.encode_utf8(&mut buffer).as_bytes();
                if self.text_bytes.len() + bytes.len() <= self.text_limit {
                    self.text_pending
                        .extend(bytes.iter().skip(1).map(|b| i32::from(*b)));
                    decoded = Input::Key(i32::from(bytes[0]));
                }
            }
            decoded
        } else if ui["movement_direction"] == true {
            decode_movement_direction(raw)
        } else {
            decode_in_window(
                raw,
                ui["input"]["kind"].as_str().unwrap_or("command"),
                window_open,
            )
        }
    }
    /// Called only after the platform has accepted this C key into the journal.
    pub fn accepted(&mut self, key: i32) {
        self.inventory.accepted(key);
        if self.text_mode {
            match key {
                21 => self.text_bytes.clear(),
                8 | 127 => {
                    if let Some(last) = self.text_bytes.pop()
                        && last & 0xc0 == 0x80
                    {
                        while self.text_bytes.last().is_some_and(|b| b & 0xc0 == 0x80) {
                            self.text_bytes.pop();
                        }
                        self.text_bytes.pop();
                    }
                }
                32..=255 if self.text_bytes.len() < self.text_limit => {
                    self.text_bytes.push(key as u8);
                }
                _ => {}
            }
            if let Ok(text) = String::from_utf8(self.text_bytes.clone()) {
                self.current_text = Some(text);
            }
        }
    }
}
#[cfg(test)]
mod item_first_tests {
    use super::*;
    use rogue_display::{inventory, presentation::Presentation};
    use serde_json::json;

    fn ready() -> Value {
        json!({"input":{"kind":"command"},"mode":"game","lines":[],"window":null,
            "command_items":[
                {"scope":"command_items","key":"a","selectable":true,"id":"ui.inventory.entry","args":[{"value":97},{"value":{"type":"item","category":"weapon","equipped":"none"}}]},
                {"scope":"command_items","key":"b","selectable":true,"id":"ui.inventory.entry","args":[{"value":98},{"value":{"type":"item","category":"stick","equipped":"none"}}]}
            ]})
    }
    fn wait(kind: &str) -> Presentation {
        Presentation { input: json!({"kind":kind}), lines: vec![
            json!({"scope":"choices","args":[{"value":97}]}),
            json!({"scope":"choices","args":[{"value":98}]})
        ], ..Default::default() }
    }
    #[test]
    fn pc_item_first_selects_before_c_then_reserves_exactly_one_original_item_key() {
        for (event,command,item) in [(RG_KEY_SELECT_THROW,116,97),(RG_KEY_SELECT_ZAP,122,98)] {
            let mut state=State::default();let ui=ready();
            assert_eq!(state.decode(event,&ui,false),Input::View);
            let mut shown=ui.clone();inventory::decorate(&state.inventory.view(),&mut shown,"ja");
            assert_eq!(shown["input"]["kind"],"item");
            assert_eq!(state.decode(item as u32,&ui,true),Input::Key(command));
            state.accepted(command);
            assert_eq!(state.inventory.next_key(&wait("direction")),None);
            assert_eq!(state.inventory.next_key(&wait("item")),Some(item));
            assert_eq!(state.inventory.next_key(&wait("item")),None);
        }
    }
    #[test]
    fn cancelling_pc_preselection_never_sends_a_c_command_or_item() {
        let mut state=State::default();let ui=ready();
        assert_eq!(state.decode(RG_KEY_SELECT_THROW,&ui,false),Input::View);
        assert_eq!(state.decode(27,&ui,true),Input::View);
        assert_eq!(state.inventory.next_key(&wait("command")),None);
        assert_eq!(state.decode(46,&ui,false),Input::Key(46));
    }
    #[test]
    fn phone_raw_commands_and_non_command_contexts_keep_existing_meaning() {
        for command in [116,122] {
            assert_eq!(State::default().decode(command,&ready(),false),Input::Key(command as i32));
        }
        for kind in ["item","text","direction","confirm","space","enter"] {
            let mut ui=ready();ui["input"]["kind"]=json!(kind);
            for event in [RG_KEY_SELECT_THROW,RG_KEY_SELECT_ZAP] {
                assert_eq!(State::default().decode(event,&ui,true),Input::Ignore);
            }
        }
    }
    #[test]
    fn preselection_filters_zap_and_rejects_a_removed_candidate() {
        let mut state=State::default();let mut ui=ready();
        assert_eq!(state.decode(RG_KEY_SELECT_ZAP,&ui,false),Input::View);
        assert_eq!(state.decode(97,&ui,true),Input::Ignore);
        ui["command_items"]=json!([]);
        assert_eq!(state.decode(98,&ui,true),Input::Ignore);
        assert_eq!(state.decode(27,&ui,true),Input::View);
        assert_eq!(state.inventory.next_key(&wait("command")),None);
    }
    #[test]
    fn selected_direction_intent_restores_but_unsubmitted_item_selection_does_not() {
        let mut state=State::default();let ui=ready();
        assert_eq!(state.decode(RG_KEY_SELECT_THROW,&ui,false),Input::View);
        let mut saved=serde_json::to_value(wait("command")).unwrap();
        state.inventory.mark(&mut saved);
        assert!(saved["input"]["inventory_intent"].is_null());
        assert_eq!(state.decode(97,&ui,true),Input::Key(116));state.accepted(116);
        let mut saved=serde_json::to_value(wait("direction")).unwrap();state.inventory.mark(&mut saved);
        let mut restored=crate::inventory::Inventory::restore(&mut saved,7);
        assert_eq!(restored.next_key(&wait("direction")),None);
        assert_eq!(restored.next_key(&wait("item")),Some(97));
    }
}
