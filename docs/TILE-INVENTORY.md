# Rogue image-tile inventory

49 semantic IDs; 46 unique raster tiles (four bolt orientations share one image).

| ID | Glyph | Meaning | Sheet / slot |
|---|---|---|---|
| terrain.unexplored | `space` | Unexplored or unlit | terrain-actors / 0 |
| terrain.floor | `.` | Room floor | terrain-actors / 1 |
| terrain.passage | `#` | Passage | terrain-actors / 2 |
| terrain.door | `+` | Door | terrain-actors / 3 |
| terrain.wall_horizontal | `-` | Horizontal wall | terrain-actors / 4 |
| terrain.wall_vertical | `&#124;` | Vertical wall | terrain-actors / 5 |
| terrain.stairs | `%` | Stairs down | terrain-actors / 6 |
| terrain.trap | `^` | Visible trap (all eight types) | terrain-actors / 7 |
| actor.player | `@` | Player adventurer | terrain-actors / 8 |
| marker.magic | `$` | Magic detection marker | terrain-actors / 9 |
| effect.bolt_horizontal | `-` | Visible bolt horizontal | terrain-actors / 10 |
| effect.bolt_vertical | `&#124;` | Visible bolt vertical | terrain-actors / 10 |
| effect.bolt_slash | `/` | Visible bolt slash | terrain-actors / 10 |
| effect.bolt_backslash | `\` | Visible bolt backslash | terrain-actors / 10 |
| item.gold | `*` | Gold coins | items / 0 |
| item.potion | `!` | Unidentified potion | items / 1 |
| item.scroll | `?` | Unidentified scroll | items / 2 |
| item.food | `:` | Food | items / 3 |
| item.weapon | `)` | Weapon / thrown weapon | items / 4 |
| item.armor | `]` | Armor | items / 5 |
| item.ring | `=` | Ring | items / 6 |
| item.stick | `/` | Wand or staff | items / 7 |
| item.amulet | `,` | Amulet of Yendor | items / 8 |
| monster.aquator | `A` | aquator | monsters-1 / 0 |
| monster.bat | `B` | bat | monsters-1 / 1 |
| monster.centaur | `C` | centaur | monsters-1 / 2 |
| monster.dragon | `D` | dragon | monsters-1 / 3 |
| monster.emu | `E` | emu | monsters-1 / 4 |
| monster.venus_flytrap | `F` | venus flytrap | monsters-1 / 5 |
| monster.griffin | `G` | griffin | monsters-1 / 6 |
| monster.hobgoblin | `H` | hobgoblin | monsters-1 / 7 |
| monster.ice_monster | `I` | ice monster | monsters-1 / 8 |
| monster.jabberwock | `J` | jabberwock | monsters-2 / 0 |
| monster.kestrel | `K` | kestrel | monsters-2 / 1 |
| monster.leprechaun | `L` | leprechaun | monsters-2 / 2 |
| monster.medusa | `M` | medusa | monsters-2 / 3 |
| monster.nymph | `N` | nymph | monsters-2 / 4 |
| monster.orc | `O` | orc | monsters-2 / 5 |
| monster.phantom | `P` | phantom | monsters-2 / 6 |
| monster.quagga | `Q` | quagga | monsters-2 / 7 |
| monster.rattlesnake | `R` | rattlesnake | monsters-2 / 8 |
| monster.snake | `S` | snake | monsters-3 / 0 |
| monster.troll | `T` | troll | monsters-3 / 1 |
| monster.black_unicorn | `U` | black unicorn | monsters-3 / 2 |
| monster.vampire | `V` | vampire | monsters-3 / 3 |
| monster.wraith | `W` | wraith | monsters-3 / 4 |
| monster.xeroc | `X` | xeroc | monsters-3 / 5 |
| monster.yeti | `Y` | yeti | monsters-3 / 6 |
| monster.zombie | `Z` | zombie | monsters-3 / 7 |

Original map remains 80x24 cells. No animation assets are required: the existing C refresh sequence moves thrown items and beams. Graphical display must not enqueue keys or invoke RNG.

Hook: web/app.js redraw() / canvas#board. Read frame.map_cells and observational effect IDs; never read hidden places/objects/monsters.

Traps: trapdoor, arrow, sleep, bear, teleport, poison dart, rust, mysterious all retain the same visible trap image. Item subtypes retain their original category image until the text UI identifies them.
