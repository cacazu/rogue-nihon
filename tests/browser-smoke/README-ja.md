# Playwrightによるブラウザー検証

作品フォルダーで実行します。実C/Rust/Wasm、隔離したブラウザープロファイルとテスト用originを使用します。仕様は [実装](../../docs/IMPLEMENTATION-ja.md)、[原作対応](../../docs/ORIGINAL-SPEC-ja.md)、[日本語化](../../docs/LOCALIZATION-ja.md)、[地図表示](../../docs/MAP-DISPLAY-ja.md) に集約しています。

## 準備と実行

Playwrightの標準Chromiumで実行します。先に `python tools/build-browser-tests.py --keep-artifacts` で検証専用ブラウザーABIを作ります。配布用の起動確認にはこの置換を使わず、観測・操作用adapterを使うシナリオだけPlaywrightのrouteで専用bindingへ接続します。fixtureを使うシナリオには [専用build](../README.md#fixture原作比較の準備) が必要です。

```sh
node tests/run.mjs --keep-artifacts tests/browser-smoke/canvas.mjs
# 別の既存環境を使う場合（全OS共通の指定方法）
node tests/run.mjs --playwright /path/to/playwright --browser /path/to/browser --python /path/to/python tests/browser-smoke/canvas.mjs
```

通常fixtureの最新buildを明示してWeb操作を確認する場合は、次の入口を使います。fixtureの実体は上書きせず、指定したWasmをブラウザーとC/RNG参照実行の両方へ使います。

```sh
node tests/run.mjs --keep-artifacts --env ROGUE_COMMAND_REFERENCE_WASM=build/game-fixtures.wasm tests/browser-smoke/command-reference.mjs
node tests/run.mjs --keep-artifacts --env ROGUE_MOBILE_WINDOWS_WASM=build/game-fixtures.wasm --env "ROGUE_MOBILE_WINDOWS_FILTER=all command menu" --env ROGUE_MOBILE_WINDOWS_WIDTHS=390,320 tests/browser-smoke/mobile-window-layout.mjs
```

設定を省略した場合は、通常のNodeモジュール検索でPlaywrightを読みます。既存の `ROGUE_PLAYWRIGHT_MODULE`、`ROGUE_CHROME`、`ROGUE_TEST_PYTHON` も使用できます。ブラウザー検査はすべてPlaywright経由です。

通常は終了時に一時出力を削除します。結果とスクリーンショットを保持する場合は `--keep-artifacts` を指定します。`browser-runtime.mjs` はOSの一時フォルダーとダウンロードを実行専用領域へ向けます。

投射物の変更前比較には、変更前にビルドした独立のfixture Wasmを `ROGUE_PROJECTILE_BASELINE` に指定します。`node tests/run.mjs --env ROGUE_PROJECTILE_BASELINE=/path/to/before-fixtures.wasm tests/projectile-animation.test.mjs tests/browser-smoke/projectile-animation.mjs` で、全14種類の杖・全投擲カテゴリ・8方向の矢・反射についてCの20 word・入力待ち・原画面を比較し、ブラウザーの実際の動きまで確認します。

## シナリオの選択

| script（tests/browser-smoke/） | 確認対象 |
|---|---|
| `canvas.mjs` | PC・スマホ・日英の開始、単一Canvas、持ち物・ヘルプ・設定、IME編集、保存復元、終了、全画面、フッターのリンク |
| `desktop-dock.mjs` | PC下部の方向・主要操作とキー表記、Web操作の厳密大小shortcut・パッド非表示時の入力・無効射撃・設定回数Eと原作aの区別、700px以上の日英配置と地図・ログの分離、実クリックから探索・待機・武器変更・投射・杖の方向取消・射撃・繰返し、履歴・設定・持ち物の背景遮断、全体図・全画面・PC/スマホ切替、旧UI/通常キーとのC・RNG比較。`ROGUE_PC_DOCK_BEFORE` に変更前buildを含む作品コピーを指定可能。 |
| `mobile-ui.mjs` | スマホのトップ・開始/保存/トップからのロード、開始直後からの操作パッド、48px以上の新規ターゲット、操作一覧の全コマンド・ボタン上スワイプ・背景入力遮断、広域・全画面のC/RNG不変、320px縦/横表示、PC幅への復帰 |
| `wording-catalog.mjs` | 全C出力箇所のID・引数を実C→Rustで検査、全557文言ID、動的名・個数・数値・未鑑定品、スマホの2行ログと全履歴・PC・日英、翻訳失敗と引数不足の負例 |
| `log-parameters-wrap.mjs` | ログの装備パラメータの色付きアイコン、スマホは項目名省略・PCは併記、実装備変更・固定文の折り返しと文字保持（翻訳の全件検査は `wording-catalog.mjs`）、320px・再表示・未鑑定・英語 |
| `mobile-window-layout.mjs` | 390px・320pxのタッチ表示で持ち物の全タブ・操作・詳細・履歴、設定・選択肢・ステータス・ログ・操作一覧・回数入力、全操作一覧のscroll・条件行・選択専用*の除外・移動3方式、一覧タップから武器変更・射撃・投射・杖・品選択取消・次操作、各使用後の識別対象・命名・左右の手・方向・検出結果・終了画面を実際に開き、重複案内・空白・枠内配置と次コマンドまでのC/RNGを確認。`item-use-flows.mjs` と同じ専用Wasmを使用 |
| `mobile-log-hints.mjs` | PC・スマホのログ・全履歴から一時的な質問を除外し、スマホではキー専用案内も除外、実Cの発見一覧・アイテム選択・指輪の手・終了確認、合成文と再表示、ゲーム文・名前・エラーの維持、PC・英語 |
| `parameter-icons.mjs` | 持ち物の数値ラベルのアイコン化、詳細のアイコンと項目名、武器・防具・指輪・杖、未鑑定の非表示、スマホ320px・PC・日英・配布Wasm |
| `equipment-style.mjs` | 右端の装備部位名、半角括弧・半角空白の数値書式、未鑑定情報の非表示、武器・防具・左右の指輪の装備変更、320pxスマホ・PC・日英・配布Wasm |
| `inventory-tabs.mjs` | 所持品だけの種類・装備中タブ、横スクロール、タイトル高の履歴ボタン、タブごとの位置復元・再読み込みと保存復元、使用後の空タブ除去、PCのキー操作 |
| `discovery-direct.mjs` | アイテム履歴の直接全件表示、変更前の手動D*と20-word/入力位置/表示順を比較、一覧中の保存復元・複数ページ・次ターン。ROGUE_DISCOVERY_BASELINEに変更前のfixture moduleを指定 |
| `autowalk.mjs` / `autowalk-production.mjs` | PCクリック・スマホタップと3表示方式の到達、歩行100ms・走る1/2の原作run境界、階段での自然停止差・途中目的地・L字の区間切替、専用待ち中の実キー/Web操作/blur/保存復帰取消、命中/miss/不可視攻撃・罠・敵衝突・進行不可・物理操作での停止、取消済みtimer・手入力直後tap、pan/pinchと未知地形のC/RNG不変。前者は `game-fixtures.wasm`（`--run-only` で走行ケースだけ実行）、後者は配布用binding・Wasmだけで通常seedのPC/スマホ到達を確認。`ROGUE_AUTOWALK_OUTPUT` で証拠出力先を指定 |
| `wait-direction-preferences.mjs` | PC・390/320pxの待機保持中の主人公画素固定とCターン継続・解除・同一入力の20word比較、待機キーとTabからのEnter/Space反復、方向パッド／共通ウィンドウの強調と取消、初訪問と3方式の保存・再読込・再開・URL優先。`ROGUE_WAIT_CONTROLS_BASE` で既存配信origin、`ROGUE_WAIT_CONTROLS_OUTPUT` で証拠出力先を指定 |
| `repeat-direction-pad.mjs` | 繰返しの長押し・回数入力・原作20回反復、全6方向操作のパッド表示と取消、持ち物からの投射と杖、PCの方向入力、キーボードで狭まった入力画面 |
| `mobile-context-history.mjs` | リストの除外と状況別ボタン、実アイテム拾得・罠の方向選択・階段昇降、PC/スマホの持ち物からアイテム履歴への遷移、配布Wasmの接続 |
| `mobile-layout.mjs` | 共通設定行・連続ズーム・スマホのステータスと履歴・全体図の凡例・設定内の保存とファイル再開 |
| `themes.mjs` | デフォルト／緑黒の実プルダウン操作、PC・390/320pxスマホ・日英・3表示方式、設定・HUD・履歴・持ち物・操作・詳細・入力・使用後・墓石・得点の配色、再読込・旧/不明設定、地図とC/RNGの不変。`item-use-fixtures.wasm` を使用 |
| `command-reference.mjs` | PCの設定横ボタン、日英・配色・3表示方式・狭い画面、ジャンル別のキー/処理2列表とWeb10操作の全件掲載、全件スクロール、背景入力遮断、所持品・方向・対象・命名・確認の待ちへの復帰、次ターンのC/RNG一致、スマホへの影響なし。`item-use-fixtures.wasm` を使用 |
| `hud-widgets.mjs` | PC・スマホで共通の二段ステータス、HP/経験値ゲージ、列・色・文字縁、全数値ウィンドウ、クリック・タップ・Tab/Enter・Esc、全画面、日英・DPR・全表示方式、次コマンドまでのC/RNG |
| `save-export.mjs` | ダウンロードした実ファイル、IndexedDBとの一致、取消、復元と次ターン |
| `system-messages.mjs` | PC・スマホ・幅320pxの日本語/英語で、処理中表示の履歴除外、名前・シード・文字入力の原因別エラーと欄直下配置、訂正解除、設定から保存する時の不正草稿・入力転送失敗、S説明通知の遮断を確認 |
| `autosave.mjs` | PC・スマホの手動保存/書出し/ファイル再開の非表示、実Cの階段上り下りでの自動保存、トップ復帰時のcommit待ちと失敗時の再試行、ロード成功後・死亡時の保存削除、再読込み後の復活防止、保存復元後のC/RNG・次ターン一致。`--production-only` は配布用binding/Wasmで非表示・Sで説明が出ないこと・トップ復帰時の保存・一度限りのロードを確認。`ROGUE_AUTOSAVE_OUTPUT` で画像と記録の出力先を指定 |
| `rust-browser-host.mjs` | 配布用bindingだけでの起動・原作操作・記録送信なし、RustのIME・crypto・Canvas・全画面・ズーム・画像回転・タッチ長押し・保存再開、Worker起動失敗通知と再開始。`--recovery-only` は失敗復帰・配布導線だけを再確認 |
| `font-glyphs.mjs` | PC・スマホ・日英・3表示方式で終了・スコア・ログの杖残り回数・持ち物・詳細・文字入力・設定を開き、Enter表示と実描画文字列を記録。`ROGUE_FONT_CORPUS=<出力先>/draw-text.json cargo test --manifest-path rust/Cargo.toml -p rogue-raster --lib bundled_fonts_cover_catalogues_and_actual_widget_shortcuts` で辞書・共通キー表記とともに欠字glyph 0を検査。専用Wasmは `item-use-flows.mjs` と共通 |
| `rust-raster.mjs` | ブラウザーの図形・文字・画像描画とPNG decodeを禁止して、Rustの完成RGBA、PC・スマホ・文字/両PNGセット・文字計測・Unicode・持ち物・次ターン・32px回転/nearestを確認 |
| `projectile-animation.mjs` | PC・スマホの実キー/持ち物タップから、杖の光線・対象魔法・短い魔法・反射、回転する投げ物、直進する矢、斜め・倍率・実画素変化・終了後の消去・オフ/再オン・取消・次ターンのC/RNGを確認。`item-use-fixtures.wasm` と変更前の独立fixture Wasm（`ROGUE_PROJECTILE_BASELINE`）を使用 |
| `character-animation.mjs` | 実Cの攻撃優先・被ダメージ・待機、次入力による再生打切り、連続座標と左右反転、停止/解除、PC/スマホの設定スイッチと再読込時の保持。`--throw-only` は方向・品物の後続入力から実投擲モーションまでを確認。`--hold-only` はスマホ両画像モードのタッチ長押し・PCのキー反復・アニメーションOFFでの長押しを実操作し、移動途中の次入力で表示が進むこと、待機周期の維持、解放後の余分なターンと入力の停止を確認。両画像モードの実画素変化・C/RNG/入力不変、隠れた敵/擬態/幻覚、保存復元後の次攻撃も確認。`ROGUE_ANIMATION_OUTPUT` で確認画像と記録の出力先を指定 |
| `visibility-motion.mjs` | 暗い部屋の床・視界と主人公の描画座標、連続入力・斜め移動・方向転換・走行・タッチ長押し、PC/スマホ・両画像モード・アニメーションOFF・ASCII、次のコマンドまでのC/RNG一致。`python tools/build.py --output-name visibility-fixtures --test-fixtures --keep-artifacts` で専用Wasmを用意し、別名の場合は `ROGUE_VISIBILITY_WASM` を指定 |
| `character-animations.mjs --gallery-only` | 素材ギャラリーの全フレームRGBA、停止・フレーム選択・再生・sheet展開。`--illustrations` はイラスト版。作品のHTTPサーバーから開く |
| `map-presentation.mjs` | 実Cのアイテム取得中の文字消去フレーム、弓の装備と左右への矢投射、各描画でのプレイヤー維持、正面素材の方向マークなし、設定プルダウンの実測幅・ベクター矢印・3方式の切替とC/RNG不変。スマホ390px・PCの両画像モード、英語320px。`--actors-only` / `--settings-only` で対象を限定し、`ROGUE_PRESENTATION_OUTPUT` で画像と記録の出力先を指定 |
| `keyboard-repeat.mjs` | 両画像モード・アニメーションON/OFFで50ms間隔の移動キー連打を56回実行。実入力から各移動結果の表示までの遅延、描画時間、入力中に表示した処理結果を記録し、入力の停滞と表示のまとめ送りを検出する。テスト専用Wasmで計画生成・画素合成・転送・DOM更新の時間も記録する。`--cadence-only` はこの確認だけを実行。`--case=tiles-on` 等で対象を限定し、`--profile` を加えるとCDPのCPU profileを保存する。profile実行は計測負荷が増すため時間上限の合否判定を行わず、通常実行で性能を判定する。通常実行では、30ms間隔・14入力の長押しと連打をnative keydown/upで送り、解放後の停止と同じC/RNG状態も比較。`ROGUE_KEYBOARD_OUTPUT` で画像と記録の出力先を指定 |
| `item-use-flows.mjs` | 原作で携行できる全80種類の主操作、各カテゴリの投擲・配置・名付け、空の杖・弱い状態・呪い・対象なし・指輪／杖の識別、PCのキー／方向ウィンドウ・スマホのタップ、後続入力・装備解除・次コマンドまでのC/RNG比較と、実Cが出した選択・方向・手・命名の質問がログに残らないこと。専用buildは `python tools/build.py --output-name item-use-fixtures --test-fixtures --keep-artifacts`。`ROGUE_ITEM_USE_WASM` で別名を指定、`--quick` は代表経路だけ実行 |
| `item-use-keys.mjs` | 単品・複数品の物理 `*`／テンキー乗算、重複一覧ボタンの撤去、PC三表示の公開hover画像・名前・武器／投げる／落とすの対象タブ、全通常品物コマンドの共通候補窓と取消、使用品と識別対象の選択、方向・品物・識別対象・左右の手・命名の取消、ヘルプ・発見一覧、印字可能なASCII全95文字の物理キー入力とCでの消費。前項と同じ専用buildを使用。`ROGUE_ITEM_REFERENCE` を指定すると、同じ既存fixtureを持つ変更前buildとのC一覧処理も比較 |
| `item-prompt-history.mjs` | 配布用UI・通常Wasmだけでシード12345の水銀のワンドを取得して使用。PC・スマホと3表示方式で、使用後・取消後・次コマンド・履歴画面に回答済みの質問が残らないこと、直接操作で必要な品物選択が出ること、C/RNG不変を確認。`ROGUE_PROMPT_URL` で起動中の配信先も指定できる |
| `input-ownership.mjs` | 通常build・seed 17の持ち物閲覧と装備、投擲方向の取消、UTF-8草稿保存と新Worker復元後の編集、空Enter・先頭 `-`・明示改名、入力journalとC/RNG状態、最新観測と足元操作候補 |
| `ownership-boundaries.mjs` | 通常buildの保存・実書出し・新Worker復元と次ターン、実IndexedDB read完了の遅延とファイルimportの競合、無効・取消importで以前の保存bytesを保持、画像セットの重複応答 |
| `startup.mjs` | Node起動、既存origin、ポート競合、HTTPS、保存後の再起動 |
| `production-boundary.mjs` | 製品ファイルだけの配置、開発tools非依存、開始・保存・書き出し・再開 |
| `game-windows.mjs / space-waits.mjs` | 入力待ちの表示、ページ・一品ずつ・検出・精算の後続操作 |
| `inventory-actions.mjs / context-controls.mjs / item-selection.mjs / throw-direction.mjs` | コマンドと後続入力、状態別候補、方向・手・文字・識別、取消後の復帰 |
| `pixels-v2.mjs / wall-blocks.mjs / underfoot.mjs` | 現行画像、倍率、壁・足元・重ね順、クリック移動 |
| `touch-input.mjs / lan.mjs` | タッチ入力、スマホ縦横、LAN HTTPS |
| `top-screen.mjs / ending-screens.mjs / combat-log.mjs / playthrough-fixes.mjs` | トップ復帰、終了経路、通常ログ、ゲーム不具合の再現 |
| `session-rng.mjs` | 表示操作のC/RNG不変、指定した旧buildとの比較 |

アイテム・魔法・終了等の決定的な状態はテスト専用C fixtureで作ります。通常Wasmへfixtureや操作用exportを追加しません。`test-adapter.mjs` はPlaywright側から注入します。HUDの極端な数値は試験内のWorker presentation差し替えで表示を確認し、ゲームルールの検証と区別します。

`inventory-actions.mjs` のタッチ表示は `ROGUE_INVENTORY_MOBILE=1` で選択できます。旧build比較を使うscriptは独立した比較archiveを要求します。`canvas.mjs` はarchiveがなくても現行の操作を確認できますが、歴史的Wasm比較は行いません。

保存・復元は新Workerへ戻った状態と次のC操作を確認します。キャッシュ再描画・設定・地図移動・全画面ではC状態・RNG・入力回数が変わらないこと、翻訳のmissing_ids/fallback、ブラウザー例外を確認します。画面変更は出力したスクリーンショットでも確認します。

スマホは画面・タッチ・DPRのエミュレーションです。実機の操作やWindowsの実IME製品の手動入力は自動検証とは別です。各scriptの実行範囲・skip・失敗をそのまま報告し、仕様表の全条件を実行済みと扱いません。
