//! Browser events become the original game's semantic keys here.
use crate::abi::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Input {
    Key(i32),
    Save,
    End,
    Ignore,
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

#[cfg(test)]
mod tests {
    use super::*;
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
