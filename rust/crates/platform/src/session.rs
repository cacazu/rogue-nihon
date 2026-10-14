//! Checkpoint, replay cursor and accepted C input journal. No display or C imports.
use crate::{Envelope, MAX_CHECKPOINT, MAX_INPUTS, MessagePaging};
use serde_json::Value;
use std::collections::VecDeque;

#[derive(bevy::prelude::Resource, Default)]
pub struct Session {
    seed: u32,
    message_paging: MessagePaging,
    name: String,
    checkpoint: Vec<u8>,
    journal: Vec<i32>,
    replay: VecDeque<i32>,
    restore_checkpoint: Vec<u8>,
    input_index: u32,
    checkpoint_error: Option<String>,
    trace_enabled: bool,
    checkpoint_presentation: Value,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn restored_cursor_and_borrowed_data_survive_new_checkpoints() {
        let saved = Envelope::new(7, "旅人".into(), &[1, 2, 3], vec![32, 107], 5)
            .expect("legacy save");
        let (mut session, presentation) =
            Session::restore(saved, MessagePaging::Log).expect("restored session");
        assert!(presentation.is_null());
        assert_eq!(session.input_index(), 3);
        assert!(session.message_paging().requires_acknowledgement(3));
        let borrowed = session.restore_data().as_ptr();
        for expected in [32, 107] {
            assert_eq!(session.next_replay_key(), Some(expected));
            assert!(session.accept_key(expected));
        }
        assert_eq!(session.next_replay_key(), None);
        assert_eq!(session.input_index(), 5);
        assert!(!session.accept_key(-1));
        assert!(!session.accept_key(256));
        assert_eq!(session.input_index(), 5);
        assert_eq!(session.journal(), &[32, 107]);

        let view = json!({"lines":[],"input":null,"history":[],"last_message":null});
        session.capture_checkpoint(vec![9], view.clone());
        assert_eq!(session.restore_data(), &[1, 2, 3]);
        assert_eq!(session.restore_data().as_ptr(), borrowed);
        assert!(session.journal().is_empty());
        assert!(session.message_paging() == MessagePaging::Log);
        let saved = Envelope::parse(&session.save_bytes(view).expect("new save"))
            .expect("valid save");
        assert_eq!(saved.checkpoint().expect("checkpoint"), &[9]);
        assert_eq!(saved.input_index, 5);
        assert!(MessagePaging::from_saved(&saved.presentation) == MessagePaging::Log);
    }
}
impl Session {
    pub fn new(seed: u32, name: String) -> Self {
        Self {
            seed,
            name,
            ..Self::default()
        }
    }

    /// Validate and construct the checkpoint/replay cursor together. The
    /// returned presentation belongs to display; input removes its own markers.
    pub fn restore(
        saved: Envelope,
        requested_paging: MessagePaging,
    ) -> Result<(Self, Value), String> {
        saved.validate()?;
        let checkpoint = saved.checkpoint()?;
        let mut message_paging = MessagePaging::from_saved(&saved.presentation);
        if requested_paging == MessagePaging::Log && message_paging == MessagePaging::Legacy {
            message_paging = MessagePaging::ReplayLegacyUntil(saved.input_index);
        }
        let input_index = saved.input_index - saved.inputs.len() as u32;
        let mut presentation = saved.presentation;
        MessagePaging::remove_marker(&mut presentation);
        Ok((
            Self {
                seed: saved.seed,
                name: saved.name,
                message_paging,
                restore_checkpoint: checkpoint,
                replay: saved.inputs.into(),
                input_index,
                ..Self::default()
            },
            presentation,
        ))
    }

    pub fn capture_checkpoint(&mut self, bytes: Vec<u8>, presentation: Value) {
        if bytes.is_empty() || bytes.len() > MAX_CHECKPOINT {
            self.reject_checkpoint("invalid checkpoint size".into());
            return;
        }
        self.message_paging = self.message_paging.at_checkpoint(self.input_index);
        self.checkpoint = bytes;
        self.journal.clear();
        self.checkpoint_error = None;
        self.checkpoint_presentation = presentation;
    }

    pub fn reject_checkpoint(&mut self, error: String) {
        self.checkpoint_error = Some(error);
    }

    pub fn next_replay_key(&mut self) -> Option<i32> {
        self.replay.pop_front()
    }

    /// This distinct allocation is immutable for the whole C run, including
    /// when a newer checkpoint replaces the active save data.
    pub fn restore_data(&self) -> &[u8] {
        &self.restore_checkpoint
    }

    pub fn seed(&self) -> u32 {
        self.seed
    }
    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn input_index(&self) -> u32 {
        self.input_index
    }
    pub fn message_paging(&self) -> MessagePaging {
        self.message_paging
    }
    pub fn trace_enabled(&self) -> bool {
        self.trace_enabled
    }
    pub fn checkpoint_presentation(&self) -> &Value {
        &self.checkpoint_presentation
    }
    pub fn journal(&self) -> &[i32] {
        &self.journal
    }
    pub fn set_player_name(&mut self, name: String) {
        self.name = name;
    }
    pub fn set_trace_enabled(&mut self, enabled: bool) {
        self.trace_enabled = enabled;
    }
    pub fn set_message_paging(&mut self, policy: MessagePaging) {
        self.message_paging = policy;
    }

    pub fn accept_key(&mut self, key: i32) -> bool {
        if !(0..=255).contains(&key)
            || self.journal.len() >= MAX_INPUTS
            || self.input_index == u32::MAX
        {
            return false;
        }
        self.journal.push(key);
        self.input_index += 1;
        true
    }
    pub fn save_bytes(&self, mut presentation: Value) -> Result<Vec<u8>, String> {
        if let Some(error) = &self.checkpoint_error {
            return Err(error.clone());
        }
        self.message_paging.mark(&mut presentation);
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
