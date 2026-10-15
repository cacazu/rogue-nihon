//! Presentation of C's public observations. No C imports, storage or input reads.
pub mod animation;
pub mod browser_ui;
pub mod display;
pub mod entities;
pub mod game_window;
pub mod identity;
pub mod inventory;
pub mod map;
pub mod map_tiles;
pub mod player_state;
pub mod presentation;
pub mod widgets;

mod bevy_plugin;
pub use bevy_plugin::{
    DisplayState, FramePort, GameWindowView, InputView, RogueDisplayPlugin, ViewPort,
};
