# 地図表示と原作記号の対応

原作が既に表示したASCIIセル・効果・足元だけを画像へ変換する。未探索のplaces、品物の隠れた効果、敵の実体、RNGを参照して見た目を決めない。原作の視認・幻覚・擬態は [原作仕様との対応](ORIGINAL-SPEC-ja.md)、処理の所有者は [実装の判断](IMPLEMENTATION-ja.md) に定義する。

## 観測から描画まで

`logic/knowledge.c:rg_knowledge_present` がCの画面を観測し、Rustの `display/src/map_tiles.rs` が文字を表示IDへ変換する。`frame.cells` は原英文画面の比較用、`frame.map_cells` は文字UI領域を除いた地図用である。論理画面は80×24セル。

`display/src/browser_ui/tiles.rs` がmanifest・フレームの語彙を検証し、可視領域・重ね順・DPR座標の描画計画を作る。`web/tiles.js` は指定されたPNGを読み込み、計画に従ってCanvasへ描く。表示・拡大・スクロール・全画面・resizeは最後のframeを使い、Cのlookや入力を追加しない。

## 表示IDと原作記号

以下は原作の `rogue.h` の記号、`extern.c:monsters`、実C画面と `sticks.c:fire_bolt` に対応する。49表示IDに対し各画像セット46 PNG。弾道4方向は1枚を共有する。画像path・回転・寸法の正本は [イラストmanifest](../web/assets/tiles/manifest.json) と [ドット絵manifest](../web/assets/pixels-v2/manifest.json)。

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

8種類の罠（trapdoor、arrow、sleep、bear、teleport、poison dart、rust、mysterious）は、原作の共通記号^に対応する同じ画像を使う。薬・杖等は鑑定後もcategory画像であり、効果別の画像へ切り替えない。幻覚や擬態は実種類でなく、その時Cが表示した記号を使う。

## 壁・杖・弾道の区別

`-`・`|`・`/` は壁・杖・弾道で重複する。`sticks.c:fire_bolt` の `rg_host_map_effect` が実際に描いた座標・記号を一時通知し、C画面の文字が一致するときだけeffect IDへ置換する。描画終了でタグを消す。

移動・攻撃・反射・damage・待機・画面復元の順序はC側を維持する。画像は原作記号の軸を表し、新たな進行方向の矢印を推定しない。投げた品物と光線の動きは既存Cのrefresh順を使い、独自animationでゲームを進めない。

横壁と縦壁は同じ大きさの正方形石ブロックを使い、横/縦の石積み模様を別PNGで表す。壁の模様を方向ごとの回転で代用せず、既存terrain IDに対応する画像を参照する。

## 足元と重ね順

Cの画面更新時に `rg_host_map_terrain` で表示中キャラクターの足元を通知する。プレイヤーは原作のfloor_at、視認中の敵は表示可能な地形を使い、暗い部屋で床を見せない場合は空白。検知だけで表示される敵は原作のt_oldchの範囲に限定する。

Rustの `map_underlays` に観測をまとめ、`map_player_underlay` は同じデータから操作用に導く。更新ごとに置き換え、移動・階移動後の古い座標を残さない。メニュー中は直前の地図と足元を保持し、ロード時はCの画面更新から再取得する。

キャラクターは床/暗闇/通路を基底に、扉・階段・見えている罠等の観測済み足元、キャラクターの順で重ねる。足元観測がないセルは中立的な床と当該画像を使う。通常アイテムも表示済みセルの床へ重ねる。表示のために未公開地形を埋めない。

## 画像・倍率・保存設定

| モード | 画像・倍率 |
|---|---|
| 文字 | 観測済みASCII地図。倍率操作は出さない |
| イラスト | `web/assets/tiles/` の96×96 PNG。32px基準、50〜200% |
| ドット絵 | `web/assets/pixels-v2/` の32×32 RGBA。100/200/300/400%、32/64/96/128px |

ドット絵は各画像16色以下、透明度0/255、床・通路・暗闇は不透明。最近傍で整数倍に拡大し、Canvas buffer倍率は1または2とする。斜め弾道は元の32px格子へ最近傍で回転した一時画像をcacheしてから拡大し、半透明のぼけを作らない。

Rustが見えるセルだけを計画し、巨大な地図全体を高DPI Canvasへ展開しない。DPRは2まで、画像補間を無効にし、セル境界を整数device pixelへ丸める。画像表示とクリックは同じcameraを使い、拡大率・スクロール・CSS表示寸法から元セル座標へ戻す。隣接クリックは通常の移動入力、タッチdragは地図の移動である。

表示モードと倍率はlocalStorageの `rogue-map-display-v1` に保存し、Rustの `browser-display/src/policies.rs` が版・mode・倍率を検証する。不正設定はイラスト100%へ戻す。保存領域が禁止されてもその場の表示変更は使える。`?view=ascii / tiles / pixels` は起動時指定。表示設定はC/RNG・ターン・ゲーム保存へ含めない。

画像不足や未対応記号はエラーとして扱い、通常の画像プレイでASCIIへ自動置換しない。manifestはUI Wasmへ埋め込むため、参照変更時は `build-ui.ps1` で更新する。画素・表示ID・移動入力の検証方法は [ブラウザー検証README](../tests/browser-smoke/README-ja.md) を参照する。
