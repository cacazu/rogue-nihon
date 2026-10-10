# Rogue image-tile inventory

49 semantic IDs; 46 unique raster tiles (square walls have horizontal/vertical stone patterns; four bolt orientations share one image).

| ID | Glyph | Meaning |
|---|---|---|
| terrain.unexplored | `space` | Unexplored or unlit |
| terrain.floor | `.` | Room floor |
| terrain.passage | `#` | Passage |
| terrain.door | `+` | Door |
| terrain.wall_horizontal | `-` | Horizontal wall |
| terrain.wall_vertical | `&#124;` | Vertical wall |
| terrain.stairs | `%` | Stairs down |
| terrain.trap | `^` | Visible trap (all eight types) |
| actor.player | `@` | Player adventurer |
| marker.magic | `$` | Magic detection marker |
| effect.bolt_horizontal | `-` | Visible bolt horizontal |
| effect.bolt_vertical | `&#124;` | Visible bolt vertical |
| effect.bolt_slash | `/` | Visible bolt slash |
| effect.bolt_backslash | `\` | Visible bolt backslash |
| item.gold | `*` | Gold coins |
| item.potion | `!` | Unidentified potion |
| item.scroll | `?` | Unidentified scroll |
| item.food | `:` | Food |
| item.weapon | `)` | Weapon / thrown weapon |
| item.armor | `]` | Armor |
| item.ring | `=` | Ring |
| item.stick | `/` | Wand or staff |
| item.amulet | `,` | Amulet of Yendor |
| monster.aquator | `A` | aquator |
| monster.bat | `B` | bat |
| monster.centaur | `C` | centaur |
| monster.dragon | `D` | dragon |
| monster.emu | `E` | emu |
| monster.venus_flytrap | `F` | venus flytrap |
| monster.griffin | `G` | griffin |
| monster.hobgoblin | `H` | hobgoblin |
| monster.ice_monster | `I` | ice monster |
| monster.jabberwock | `J` | jabberwock |
| monster.kestrel | `K` | kestrel |
| monster.leprechaun | `L` | leprechaun |
| monster.medusa | `M` | medusa |
| monster.nymph | `N` | nymph |
| monster.orc | `O` | orc |
| monster.phantom | `P` | phantom |
| monster.quagga | `Q` | quagga |
| monster.rattlesnake | `R` | rattlesnake |
| monster.snake | `S` | snake |
| monster.troll | `T` | troll |
| monster.black_unicorn | `U` | black unicorn |
| monster.vampire | `V` | vampire |
| monster.wraith | `W` | wraith |
| monster.xeroc | `X` | xeroc |
| monster.yeti | `Y` | yeti |
| monster.zombie | `Z` | zombie |

Original map remains 80x24 cells. No animation assets are required: the existing C refresh sequence moves thrown items and beams. Graphical display must not enqueue keys or invoke RNG.

Hook: web/app.js redraw() / canvas#board. Read frame.map_cells and observational effect IDs; never read hidden places/objects/monsters.

Traps: trapdoor, arrow, sleep, bear, teleport, poison dart, rust, mysterious all retain the same visible trap image. Item subtypes retain their original category image until the text UI identifies them.
