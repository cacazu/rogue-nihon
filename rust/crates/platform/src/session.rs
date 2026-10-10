//! Checkpoint, replay cursor and accepted C input journal. No display or C imports.
use crate::{Envelope, MAX_INPUTS, MessagePaging};
use serde_json::Value;
use std::collections::VecDeque;

#[derive(bevy::prelude::Resource, Default)]
pub struct Session {
    pub seed: u32,
    pub message_paging: MessagePaging,
    pub name: String,
    pub checkpoint: Vec<u8>,
    pub journal: Vec<i32>,
    pub replay: VecDeque<i32>,
    pub restore_checkpoint: Vec<u8>,
    pub input_index: u32,
    pub checkpoint_error: Option<String>,
    pub trace_enabled: bool,
    pub checkpoint_presentation: Value,
}
impl Session {
    pub fn accept_key(&mut self, key: i32) -> bool {
        if self.journal.len() >= MAX_INPUTS || self.input_index == u32::MAX {
            return false;
        }
        self.journal.push(key);
        self.input_index += 1;
        true
    }
    pub fn save_bytes(&self, presentation: Value) -> Result<Vec<u8>, String> {
        if let Some(error) = &self.checkpoint_error {
            return Err(error.clone());
        }
        Envelope::new_with_presentation(
            self.seed,
            self.name.clone(),
            &self.checkpoint,
            self.journal.clone(),
            self.input_index,
            presentation,
        )
        .and_then(|value| value.bytes())
    }
}
