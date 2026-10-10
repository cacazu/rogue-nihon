//! Perceived map glyphs only. No world, item subtype, FOV or RNG access.
pub const IDS: [&str; 49] = [
    "terrain.unexplored",
    "terrain.floor",
    "terrain.passage",
    "terrain.door",
    "terrain.wall_horizontal",
    "terrain.wall_vertical",
    "terrain.stairs",
    "terrain.trap",
    "actor.player",
    "marker.magic",
    "effect.bolt_horizontal",
    "effect.bolt_vertical",
    "effect.bolt_slash",
    "effect.bolt_backslash",
    "item.gold",
    "item.potion",
    "item.scroll",
    "item.food",
    "item.weapon",
    "item.armor",
    "item.ring",
    "item.stick",
    "item.amulet",
    "monster.aquator",
    "monster.bat",
    "monster.centaur",
    "monster.dragon",
    "monster.emu",
    "monster.venus_flytrap",
    "monster.griffin",
    "monster.hobgoblin",
    "monster.ice_monster",
    "monster.jabberwock",
    "monster.kestrel",
    "monster.leprechaun",
    "monster.medusa",
    "monster.nymph",
    "monster.orc",
    "monster.phantom",
    "monster.quagga",
    "monster.rattlesnake",
    "monster.snake",
    "monster.troll",
    "monster.black_unicorn",
    "monster.vampire",
    "monster.wraith",
    "monster.xeroc",
    "monster.yeti",
    "monster.zombie",
];

pub fn glyph(value: u8) -> Option<u8> {
    Some(match value {
        b' ' => 0,
        b'.' => 1,
        b'#' => 2,
        b'+' => 3,
        b'-' => 4,
        b'|' => 5,
        b'%' => 6,
        b'^' => 7,
        b'@' => 8,
        b'$' => 9,
        b'\\' => 13,
        b'*' => 14,
        b'!' => 15,
        b'?' => 16,
        b':' => 17,
        b')' => 18,
        b']' => 19,
        b'=' => 20,
        b'/' => 21,
        b',' => 22,
        b'A'..=b'Z' => 23 + value - b'A',
        _ => return None,
    })
}

pub fn bolt(value: u8) -> Option<u8> {
    match value {
        b'-' => Some(10),
        b'|' => Some(11),
        b'/' => Some(12),
        b'\\' => Some(13),
        _ => None,
    }
}

pub fn map(
    cells: &[u8],
    columns: u32,
    rows: u32,
    effects: &[(u32, u32, u8)],
) -> (Vec<u8>, Vec<u8>) {
    let mut unknown = Vec::new();
    let mut tiles: Vec<u8> = cells
        .iter()
        .map(|&cell| {
            glyph(cell).unwrap_or_else(|| {
                if !unknown.contains(&cell) {
                    unknown.push(cell);
                }
                0
            })
        })
        .collect();
    for &(x, y, character) in effects {
        if x >= columns || y == 0 || y >= rows.saturating_sub(1) {
            continue;
        }
        let Some(index) = y
            .checked_mul(columns)
            .and_then(|row| row.checked_add(x))
            .and_then(|index| usize::try_from(index).ok())
        else {
            continue;
        };
        if cells.get(index) == Some(&character)
            && let Some(id) = bolt(character)
            && let Some(tile) = tiles.get_mut(index)
        {
            *tile = id;
        }
    }
    (tiles, unknown)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn entire_original_map_alphabet_is_mapped() {
        for byte in b" .#+-|%^@$*!? :)]/=,\\ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
            assert!(glyph(*byte).is_some());
        }
        assert_eq!(IDS.len(), 49);
        assert_eq!(glyph(b'X'), Some(46));
    }
    #[test]
    fn observable_bolts_disambiguate_items_and_walls() {
        let cells = b"     -|/\\      ";
        let (plain, unknown) = map(cells, 5, 3, &[]);
        assert!(unknown.is_empty());
        let effects = [(0, 1, b'-'), (1, 1, b'|'), (2, 1, b'/'), (3, 1, b'\\')];
        let (observed, unknown) = map(cells, 5, 3, &effects);
        assert!(unknown.is_empty());
        assert_eq!(&plain[5..9], &[4, 5, 21, 13]);
        assert_eq!(&observed[5..9], &[10, 11, 12, 13]);
        assert_eq!(cells, b"     -|/\\      ");
    }
    #[test]
    fn unknown_and_hidden_cells_are_not_invented() {
        let (tiles, unknown) = map(b"     ", 5, 1, &[(0, 0, b'-'), (u32::MAX, 1, b'/')]);
        assert_eq!(tiles, vec![0; 5]);
        assert!(unknown.is_empty());
        let (tiles, unknown) = map(b"aa", 2, 1, &[]);
        assert_eq!(tiles, vec![0; 2]);
        assert_eq!(unknown, vec![b'a']);
    }
    #[test]
    fn repaint_and_disguises_use_only_presented_bytes() {
        let cells = b" /!X .";
        assert_eq!(map(cells, 6, 1, &[]), map(cells, 6, 1, &[]));
        assert_eq!(glyph(b'/'), Some(21));
        assert_eq!(glyph(b'!'), Some(15));
    }
}
