//! Generated ABI and shared Bevy schedule contract.
/// Static map memory contains only publicly observed terrain/item glyphs.
/// Actor identities, effects and unknown bytes cannot enter a saved memory.
pub fn map_memory_glyph(glyph: u8) -> bool {
    b" .#+-|%^*!?:)]/=,".contains(&glyph)
}
pub fn valid_map_memory(level: u64, cells: &str) -> bool {
    level > 0 && level <= u64::from(u32::MAX) && cells.len() == 80 * 24
        && cells.is_ascii() && cells.bytes().all(map_memory_glyph)
        && cells.as_bytes()[..80].iter().chain(&cells.as_bytes()[80*23..]).all(|glyph| *glyph == b' ')
}
/// Public map observation order, shared by memory and exploration.
pub const MAP_DIRECTIONS: [(i32,i32);8] = [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(1,-1),(-1,1),(1,1)];
pub const MAP_UNCHECKED: u16 = 256;

/// Unknown neighbours of an actually observed position, never hidden terrain.
pub fn map_unknown_mask(cells: &[u8], width: usize, height: usize, x: i32, y: i32) -> Option<u8> {
    if width==0 || width>80 || height<=2 || height>24 || cells.len()!=width*height
        || x<0 || x>=width as i32 || y<=0 || y>=height as i32-1 {return None;}
    Some(MAP_DIRECTIONS.iter().enumerate().fold(0,|mask,(bit,(dx,dy))| {
        let (nx,ny)=(x+dx,y+dy);
        mask | if nx>=0 && nx<width as i32 && ny>0 && ny<height as i32-1
            && cells[ny as usize*width+nx as usize]==b' ' {1<<bit} else {0}
    }))
}

pub fn valid_map_checked(checked: &[u16], width: usize, height: usize) -> bool {
    width>0 && width<=80 && height>2 && height<=24 && checked.len()==width*height
        && checked.iter().all(|mask|*mask<=MAP_UNCHECKED)
        && checked[..width].iter().chain(&checked[width*(height-1)..]).all(|mask|*mask==MAP_UNCHECKED)
}

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
/// Decode transport permission without admitting it into the journal.
pub fn target_run_permit(raw: u32) -> Option<(u8, u32)> {
    let index = raw.checked_sub(RG_KEY_TARGET_RUN_PERMIT_BASE)?;
    let steps = index / 8 + 1;
    (steps <= RG_TARGET_RUN_PERMIT_MAX_STEPS).then(|| (b"hjklyubn"[(index % 8) as usize], steps))
}
pub fn target_run_permit_key(direction: u8, steps: u32) -> Option<u32> {
    if !(1..=RG_TARGET_RUN_PERMIT_MAX_STEPS).contains(&steps) { return None; }
    let index = b"hjklyubn".iter().position(|v| *v == direction)? as u32;
    Some(RG_KEY_TARGET_RUN_PERMIT_BASE + (steps - 1) * 8 + index)
}
#[cfg(test)]
mod permit_tests {
    use super::*;
    #[test]
    fn transport_grants_are_bounded_and_never_journal_keys() {
        for direction in b"hjklyubn" { for steps in 1..=80 {
            let key=target_run_permit_key(*direction,steps).unwrap();
            assert_eq!(target_run_permit(key),Some((*direction,steps)));
            assert!(!target_run_journal_key(key as i32));
        }}
        assert!(target_run_permit_key(b'l',0).is_none());
        assert!(target_run_permit_key(b'l',81).is_none());
        assert!(target_run_permit(RG_KEY_TARGET_RUN_PERMIT_BASE-1).is_none());
        assert!(target_run_permit(RG_KEY_TARGET_RUN_PERMIT_BASE+640).is_none());
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

#[cfg(test)]
mod checked_tests {
    use super::*;
    #[test]
    fn public_checked_masks_have_shared_direction_order_and_strict_bounds() {
        let mut cells=vec![b'.';5*5];cells[2*5+1]=b' ';cells[3*5+3]=b' ';
        assert_eq!(map_unknown_mask(&cells,5,5,2,2),Some(1|128));
        cells[2*5+1]=b'.';assert_eq!(map_unknown_mask(&cells,5,5,2,2),Some(128));
        cells[1*5+2]=b' ';assert_eq!(map_unknown_mask(&cells,5,5,2,2),Some(4|128));
        assert_eq!(map_unknown_mask(&cells,5,5,2,0),None);
        let mut checked=vec![MAP_UNCHECKED;25];checked[12]=255;
        assert!(valid_map_checked(&checked,5,5));
        checked[12]=257;assert!(!valid_map_checked(&checked,5,5));
        checked[12]=0;checked[0]=0;assert!(!valid_map_checked(&checked,5,5));
        assert!(!valid_map_checked(&checked[..24],5,5));
    }

}

mod runtime;
pub use runtime::{BEVY_VERSION, JournalPort, RogueSystems};
