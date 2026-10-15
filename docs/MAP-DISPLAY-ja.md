# 地図表示と原作記号の対応

原作が既に表示したASCIIセル・効果・足元だけを画像へ変換する。未探索のplaces、アイテムの隠れた効果、敵の実体、RNGを参照して見た目を決めない。原作の視認・幻覚・擬態は [原作仕様との対応](ORIGINAL-SPEC-ja.md)、処理の所有者は [実装の判断](IMPLEMENTATION-ja.md) に定義する。

## 観測から描画まで

`logic/knowledge.c:rg_knowledge_present` がCの画面を観測し、Rustの `display/src/map_tiles.rs` が文字を表示IDへ変換する。`frame.cells` は原英文画面の比較用、`frame.map_cells` は文字UI領域を除いた地図用である。論理画面は80×24セル。

`display/src/browser_ui/tiles.rs` がmanifest・フレームの語彙を検証し、可視領域・重ね順・DPR座標の描画計画を作る。Rustの `browser-display/src/browser/images.rs` がPNGのbytesを取得し、`raster/src/images.rs` がdecode・回転・拡大・RGBA合成とcacheを所有する。ドット絵は `display/src/browser_ui/pixels.rs` と同じ32pxの回転計算を使う。CanvasにはRustが作った全画面RGBAだけを転送する。表示・拡大・スクロール・全画面・resizeは最後のframeを使い、Cのlookや入力を追加しない。

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

移動・攻撃・反射・damage・待機・画面復元の順序はC側を維持する。画像は原作記号の軸を表し、新たな進行方向の矢印を推定しない。投げたアイテムと光線の動きは既存Cのrefresh順を使い、独自animationでゲームを進めない。

横壁と縦壁は同じ大きさの正方形石ブロックを使い、横/縦の石積み模様を別PNGで表す。壁の模様を方向ごとの回転で代用せず、既存terrain IDに対応する画像を参照する。

## 足元と重ね順

Cの画面更新時に `rg_host_map_terrain` で表示中キャラクターの足元を通知する。プレイヤーは原作のfloor_at、視認中の敵は表示可能な地形を使い、暗い部屋で床を見せない場合は空白。検知だけで表示される敵は原作のt_oldchの範囲に限定する。

Rustの `map_underlays` に観測をまとめ、`map_player_underlay` は同じデータから操作用に導く。`map_player_surface` は同じ公開観測から足元のアイテム記号も保持し、状況別の「拾う」ボタンへ使う。地形用underlayにはアイテムを混ぜない。更新ごとに置き換え、移動・階移動後の古い座標を残さない。メニュー中は直前の地図と足元を保持し、ロード時はCの画面更新から再取得する。

キャラクターは床/暗闇/通路を基底に、扉・階段・見えている罠等の観測済み足元、キャラクターの順で重ねる。足元観測がないセルは中立的な床と当該画像を使う。通常アイテムも表示済みセルの床へ重ねる。表示のために未公開地形を埋めない。

## キャラクターアニメーション

画像モードの27キャラクターは、各素材の `animations-v1/manifest.json` にある待機・攻撃・被ダメージのコマをシートから切り出して使う。キャラクター最上層だけを差し替え、床・暗闇・足元・表示記号の契約は維持する。PNGの読込み・寸法検査・3列4行からの切出し・透過合成はRustで行う。

`display::animation::Animator` が公開キャラクターの寿命、表示時計、行動ごとの優先選択、再生位置、移動補間と次回描画時刻を所有する。Cは確定した移動・攻撃・正のHP減少と、元のコマンド処理単位を示す表示専用stepを通知する。入力待ちの間にstepを進めず、品物・方向などの後続入力は同じ行動に属する。Rustはイベントsequenceを一度だけ消費し、新しい入力が受理されたら攻撃・被ダメージの残りのモーションを終了する。同じstep内でも入力後に新しく発生したイベントは受け入れる。

行動の表示優先順位は攻撃、被ダメージ、待機。攻撃と被ダメージを順に再生するキューは持たず、同じ行動で一つだけを選ぶ。攻撃と被ダメージのクリップは一度再生して待機へ戻り、待機はmanifestの周期でループする。歩行時も待機のコマを使い、キャラクターの表示座標を120ms補間する。反復入力でも待機の周期を保ち、移動途中に次の移動が確定したら、直前に描いた位置から最新の移動先へ補間をつなぐ。描画済みの移動をつなぐときは直前の描画時刻も引き継ぎ、入力のたびに初期位置で一コマ止まることを防ぐ。描画前に複数の移動が届き、最新の移動先と表示位置の差が各軸2マスの範囲を超えた場合は、最新の確定座標へ表示を進める。カメラも表示座標に追従し、地形を先に描いてからキャラクターを重ねる。

素材の元の向きは各animation manifestの `facing` (`left` / `right` / `front`) に定義する。Cで成立した移動・攻撃方向から左右を更新し、上下移動は前の左右を保つ。Rustのラスタライズで素材の元の向きと進行方向を合わせる。正面向きの素材には小さな左右の方向マークを添える。プレイヤーの睡眠・凝視など行動不可の `no_command`、敵の睡眠・保持では、公開済みキャラクターの停止booleanだけを渡して表示コマを静止する。移動だけを制限するプレイヤーの熊罠・捕縛は攻撃可能なので全モーションの停止対象にしない。

キャラクターIDは表示専用で、連続して公開されている期間だけ有効にする。隠れた敵の位置・内部の種類や擬態の正体を渡さず、画像は現在の公開glyphから選ぶ。resize・倍率・言語・画像モードの変更では行動を再生し直さない。非表示になった敵、階移動・テレポート・新Workerでは表示IDや再生状態を破棄し、復元中の入力再生による過去の行動は再生しない。

設定のアニメーションスイッチをオフにすると静止画を使い、移動補間・モーション更新を止める。左右の向きは保つ。設定は表示設定としてブラウザーに保存し、ゲーム保存には含めない。再生時刻・step・選択した行動・補間座標・コマ番号もゲーム保存から除外する。時間による再描画はCの入力・ターン・RNGを呼ばない。ブラウザー側Rustは次の表示変化までの一度限りのタイマーを所有し、画像が画面にない場合、ASCIIモード、非表示タブ、更新対象が全て停止している場合はアニメーション更新を要求しない。

## 画像・倍率・保存設定

操作パッドの「全体図」は `browser_ui/mobile_map.rs` が現在の `frame.map_cells` を色付きのセルへ変換する。幅80マスを画面へ収め、壁・通路・プレイヤー・階段・敵・アイテムを示す。空白は埋めず、暗い部屋で消えた床を独自の記憶で復元しない。図のタイトルは表示せず、凡例は一行・17 CSS px、入口ボタンは48px以上を保つ。同じ「全体図」ボタンを再度押すと通常の表示に戻る。シード123の7階で長い経路の未探索側を確認する際、16pxの広域でも390pxに地図全幅が入らなかったため追加した。通常の倍率設定・C状態・入力回数は変えない。

| モード | 画像・倍率 |
|---|---|
| 文字 | 観測済みASCII地図。画像と同じ正方形セル内に文字を描く |
| イラスト | `web/assets/tiles/` の96×96 PNG |
| ドット絵 | `web/assets/pixels-v2/` の32×32 RGBA |

全方式で32px/セルを基準とし、8〜128px/セルを小数を含む連続値で使う。同じcamera・縦横比・倍率・操作中心を共有し、表示方式の切替で倍率をリセットしない。

ドット絵は各画像16色以下、透明度0/255、床・通路・暗闇は不透明。最近傍で拡大縮小し、非整数の倍率も使う。Canvas buffer倍率は1または2とする。斜め弾道は元の32px格子へ最近傍で回転した一時画像をcacheしてから拡大し、半透明のぼけを作らない。

ピンチは指の距離の変化へ直接追従し、マップ上のホイールはdeltaに比例した指数倍率をRustで計算し、requestAnimationFrameで滑らかに変化させる。方式別の段階丸めやホイールの入力しきい値は使わない。操作中心の地図位置を保ち、全体図からは実際の表示倍率を基準に通常の地図へ戻る。二本指を離しても移動コマンドを送らず、通常倍率は小数を含めて保存する。設定・ログ・ダイアログ上のホイールはスクロールを維持する。

Rustが見えるセルだけを計画し、巨大な地図全体を高DPI Canvasへ展開しない。DPRは2まで、画像補間を無効にし、セル境界を整数device pixelへ丸める。画像表示とクリックは同じcameraを使い、拡大率・スクロール・CSS表示寸法から元セル座標へ戻す。隣接クリックは通常の移動入力、タッチdragは地図の移動である。

表示モード・倍率・アニメーションのオン/オフはlocalStorageの `rogue-map-display-v1` に保存し、Rustの `browser-display/src/policies.rs` が版・mode・倍率を検証する。不正設定はイラスト100%へ戻す。アニメーション設定を持たない既存の表示設定はオンとして読む。保存領域が禁止されてもその場の表示変更は使える。`?view=ascii / tiles / pixels` は起動時指定。表示設定はC/RNG・ターン・ゲーム保存へ含めない。

画像不足や未対応記号はエラーとして扱い、通常の画像プレイでASCIIへ自動置換しない。manifestはUI Wasmへ埋め込むため、参照変更時は `build-ui.ps1` で更新する。画素・表示ID・移動入力の検証方法は [ブラウザー検証README](../tests/browser-smoke/README-ja.md) を参照する。
