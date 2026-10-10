//! Event decoding and UTF-8 editing state, independent of C and storage.
use crate::{Input, decode, decode_in_window, decode_movement_direction, inventory::Inventory};
use rogue_contract::*;
use serde_json::Value;
use std::collections::VecDeque;

#[derive(bevy::prelude::Resource, Default)]
pub struct State {
    pub inventory: Inventory,
    pub text_mode: bool,
    pub text_is_name: bool,
    pub name_edit_changed: bool,
    pub text_limit: usize,
    pub text_bytes: Vec<u8>,
    pub text_pending: VecDeque<i32>,
}
impl State {
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
    pub fn accepted(&mut self, key: i32) -> Option<String> {
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
                return Some(text);
            }
        }
        None
    }
}
