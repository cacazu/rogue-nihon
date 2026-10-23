//! Generated ABI and shared Bevy schedule contract.
mod abi;
pub use abi::*;

/// Apply the selected movement mode only to unmodified direction commands.
/// Explicit Shift/Ctrl/Alt and uppercase commands keep their original meaning.
pub fn movement_mode_key(raw: u32, mode: u32) -> u32 {
    if raw & (RG_EVENT_SHIFT | RG_EVENT_CTRL | RG_EVENT_ALT) != 0 { return raw; }
    let letter = match raw & RG_EVENT_SCALAR_MASK {
        RG_KEY_UP => b'k', RG_KEY_DOWN => b'j', RG_KEY_LEFT => b'h', RG_KEY_RIGHT => b'l',
        RG_KEY_HOME => b'y', RG_KEY_END => b'b', RG_KEY_PAGE_UP => b'u', RG_KEY_PAGE_DOWN => b'n',
        value if value <= 127 && b"hjklyubn".contains(&(value as u8)) => value as u8,
        _ => return raw,
    };
    match mode {
        1 => (raw & !RG_EVENT_SCALAR_MASK) | u32::from(letter.to_ascii_uppercase()),
        2 => raw | RG_EVENT_CTRL,
        _ => raw,
    }
}

#[cfg(test)]
mod movement_tests {
    use super::*;

    #[test]
    fn selected_mode_maps_all_directions_and_preserves_explicit_commands() {
        for (symbol, letter) in [(RG_KEY_UP,b'k'),(RG_KEY_DOWN,b'j'),(RG_KEY_LEFT,b'h'),
            (RG_KEY_RIGHT,b'l'),(RG_KEY_HOME,b'y'),(RG_KEY_END,b'b'),
            (RG_KEY_PAGE_UP,b'u'),(RG_KEY_PAGE_DOWN,b'n')] {
            for raw in [symbol,u32::from(letter)] {
                for repeat in [0,RG_EVENT_REPEAT] {
                    assert_eq!(movement_mode_key(raw|repeat,0),raw|repeat);
                    assert_eq!(movement_mode_key(raw|repeat,1),u32::from(letter.to_ascii_uppercase())|repeat);
                    assert_eq!(movement_mode_key(raw|repeat,2),raw|repeat|RG_EVENT_CTRL);
                }
                for modifier in [RG_EVENT_SHIFT,RG_EVENT_CTRL,RG_EVENT_ALT,RG_EVENT_SHIFT|RG_EVENT_CTRL] {
                    for mode in 0..3 {
                        assert_eq!(movement_mode_key(raw|modifier,mode),raw|modifier);
                    }
                }
            }
        }
        for key in "HJKLYUBN.1234567890gExAt".bytes().map(u32::from)
            .chain([RG_KEY_SAVE,RG_KEY_END_INPUT,0x3042]) {
            for mode in 0..3 { assert_eq!(movement_mode_key(key,mode),key); }
        }
    }
}
/// Only these dedicated journal values may cross the target-run boundary.
pub fn target_run_start_key(key: i32) -> Option<u8> {
    let index = key.checked_sub(RG_KEY_TARGET_RUN_BASE as i32)?;
    if !(0..16).contains(&index) { return None; }
    let letter = b"hjklyubn"[index as usize % 8];
    Some(if index < 8 { letter.to_ascii_uppercase() } else { letter & 0x1f })
}

pub fn target_run_journal_key(key: i32) -> bool {
    target_run_start_key(key).is_some()
        || key == RG_KEY_TARGET_RUN_CONTINUE as i32 || key == RG_KEY_TARGET_RUN_STOP as i32
}

mod runtime;
pub use runtime::{BEVY_VERSION, JournalPort, RogueSystems};
