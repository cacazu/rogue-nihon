//! Read-only projection of the original C player flags, never inferred from UI.
use rogue_contract::{RG_FLAG_AMULET, RG_FLAG_LEVITATING};
use serde::Serialize;

#[derive(Clone, Copy, Default, Serialize)]
pub struct PlayerState {
    pub amulet: bool,
    pub levitating: bool,
}

impl PlayerState {
    pub fn from_snapshot(flags: u32) -> Self {
        Self {
            amulet: flags & RG_FLAG_AMULET != 0,
            levitating: flags & RG_FLAG_LEVITATING != 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projects_original_flags_without_other_player_or_command_bits() {
        for (flags, amulet, levitating) in [
            (0, false, false),
            (RG_FLAG_AMULET, true, false),
            (RG_FLAG_LEVITATING, false, true),
            (RG_FLAG_AMULET | RG_FLAG_LEVITATING, true, true),
            (0x0003fff7, false, false),
        ] {
            let state = PlayerState::from_snapshot(flags);
            assert_eq!(state.amulet, amulet);
            assert_eq!(state.levitating, levitating);
        }
    }
}
