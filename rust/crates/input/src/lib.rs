//! Browser events become the original game's semantic keys here.
use rogue_contract::*;
pub mod inventory;
mod state;
pub use state::State;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Input {
    Key(i32),
    Save,
    End,
    Ignore,
    View,
}

pub fn decode(raw: u32) -> Input {
    let scalar = raw & RG_EVENT_SCALAR_MASK;
    if scalar == RG_KEY_SAVE {
        return Input::Save;
    }
    if scalar == RG_KEY_END_INPUT {
        return Input::End;
    }
    // Alt shortcuts belong to the browser. IME events never reach this API.
    if raw & RG_EVENT_ALT != 0 {
        return Input::Ignore;
    }
    let mut key = match scalar {
        RG_KEY_UP => b'k',
        RG_KEY_DOWN => b'j',
        RG_KEY_LEFT => b'h',
        RG_KEY_RIGHT => b'l',
        RG_KEY_HOME => b'y',
        RG_KEY_END => b'b',
        RG_KEY_PAGE_UP => b'u',
        RG_KEY_PAGE_DOWN => b'n',
        0..=127 => scalar as u8,
        _ => return Input::Ignore,
    };
    if raw & RG_EVENT_SHIFT != 0 && scalar > 127 {
        key = key.to_ascii_uppercase();
    }
    if raw & RG_EVENT_CTRL != 0 && key.is_ascii_alphabetic() {
        key &= 0x1f;
    }
    Input::Key(i32::from(key))
}

/// Dialog acknowledgements are adapted before C reads and journals the key.
/// All other keys and platform controls retain the ordinary input contract.
pub fn decode_in_window(raw: u32, kind: &str, window_open: bool) -> Input {
    match decode(raw) {
        Input::Key(13 | 27) if window_open && kind == "space" => Input::Key(32),
        Input::Key(13) if window_open && kind == "space_cancel" => Input::Key(32),
        Input::Key(27) if window_open && kind == "enter" => Input::Key(13),
        other => other,
    }
}

/// Movement modifiers choose the same single direction while aiming a throw.
/// C still owns the direction, cancellation, confusion and missile rules.
pub fn decode_movement_direction(raw: u32) -> Input {
    match decode(raw) {
        Input::Key(key) => {
            let character = key as u8;
            let letter = if (1..=26).contains(&character) {
                character + b'a' - 1
            } else {
                character.to_ascii_lowercase()
            };
            if b"hjklyubn".contains(&letter) {
                Input::Key(i32::from(letter))
            } else {
                Input::Key(key)
            }
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn window_acknowledgements_preserve_commands_text_and_platform_controls() {
        for key in [13, 27] {
            assert_eq!(decode_in_window(key, "command", false), decode(key));
            assert_eq!(decode_in_window(key, "text", true), decode(key));
            assert_eq!(decode_in_window(key, "space", true), Input::Key(32));
        }
        for key in [
            RG_KEY_SAVE,
            RG_KEY_END_INPUT,
            RG_KEY_UP,
            u32::from(b'i'),
            RG_EVENT_ALT | 27,
        ] {
            assert_eq!(decode_in_window(key, "space", true), decode(key));
        }
        assert_eq!(decode_in_window(27, "enter", true), Input::Key(13));
        assert_eq!(decode_in_window(13, "space_cancel", true), Input::Key(32));
        assert_eq!(decode_in_window(27, "space_cancel", true), Input::Key(27));
    }

    #[test]
    fn directions_running_control_and_non_commands() {
        assert_eq!(decode(RG_KEY_UP), Input::Key(i32::from(b'k')));
        assert_eq!(
            decode(RG_KEY_UP | RG_EVENT_SHIFT),
            Input::Key(i32::from(b'K'))
        );
        assert_eq!(decode(u32::from(b'R') | RG_EVENT_CTRL), Input::Key(18));
        assert_eq!(decode(0x3042), Input::Ignore);
        assert_eq!(decode(u32::from(b'x') | RG_EVENT_ALT), Input::Ignore);
        assert_eq!(decode(RG_KEY_SAVE), Input::Save);
    }
}

mod bevy_plugin;
pub use bevy_plugin::{InputPort, RogueInputPlugin};
