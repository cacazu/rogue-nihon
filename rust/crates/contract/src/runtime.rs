//! Shared Bevy scheduling and accepted-key transport between independent plugins.
use bevy::prelude::*;

pub const BEVY_VERSION: &str = "0.19.1";

#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RogueSystems {
    Presentation,
    Input,
    Journal,
    AcceptedInput,
    Frame,
    Save,
}

/// Only the platform plugin commits a key; input state observes that commit.
#[derive(Resource, Default)]
pub struct JournalPort {
    pub key: Option<i32>,
    pub accepted: bool,
    pub committed: Option<i32>,
}
