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
