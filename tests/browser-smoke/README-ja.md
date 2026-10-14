# Playwrightによるブラウザー検証

作品フォルダーで実行します。実C/Rust/Wasm、隔離したブラウザープロファイルとテスト用originを使用します。仕様は [実装](../../docs/IMPLEMENTATION-ja.md)、[原作対応](../../docs/ORIGINAL-SPEC-ja.md)、[日本語化](../../docs/LOCALIZATION-ja.md)、[地図表示](../../docs/MAP-DISPLAY-ja.md) に集約しています。

## 準備と実行

Playwrightの標準Chromiumで実行します。先に `python tools/build-browser-tests.py --keep-artifacts` で検証専用ブラウザーABIを作ります。配布用の起動確認にはこの置換を使わず、観測・操作用adapterを使うシナリオだけPlaywrightのrouteで専用bindingへ接続します。fixtureを使うシナリオには [専用build](../README.md#fixture原作比較の準備) が必要です。

```sh
node tests/run.mjs --keep-artifacts tests/browser-smoke/canvas.mjs
# 別の既存環境を使う場合（全OS共通の指定方法）
node tests/run.mjs --playwright /path/to/playwright --browser /path/to/browser --python /path/to/python tests/browser-smoke/canvas.mjs
```

設定を省略した場合は、通常のNodeモジュール検索でPlaywrightを読みます。既存の `ROGUE_PLAYWRIGHT_MODULE`、`ROGUE_CHROME`、`ROGUE_TEST_PYTHON` も使用できます。ブラウザー検査はすべてPlaywright経由です。

通常は終了時に一時出力を削除します。結果とスクリーンショットを保持する場合は `--keep-artifacts` を指定します。`browser-runtime.mjs` はOSの一時フォルダーとダウンロードを実行専用領域へ向けます。

## シナリオの選択

| script（tests/browser-smoke/） | 確認対象 |
|---|---|
| `canvas.mjs` | PC・スマホ・日英の開始、単一Canvas、持ち物・ヘルプ・設定、IME編集、保存復元、終了、全画面、フッターのリンク |
| `mobile-ui.mjs` | スマホのトップ・開始/保存/トップからのロード、開始直後からの操作パッド、48px以上の新規ターゲット、操作一覧の全コマンド・ボタン上スワイプ・背景入力遮断、広域・全画面のC/RNG不変、320px縦/横表示、PC幅への復帰 |
| `wording-catalog.mjs` | 全C出力箇所のID・引数を実C→Rustで検査、全557文言ID、動的名・個数・数値・未鑑定品、スマホの2行ログと全履歴・PC・日英、翻訳失敗と引数不足の負例 |
| `log-parameters-wrap.mjs` | ログの装備パラメータの色付きアイコン、スマホは項目名省略・PCは併記、実装備変更・固定文の折り返しと文字保持（翻訳の全件検査は `wording-catalog.mjs`）、320px・再表示・未鑑定・英語 |
| `mobile-log-hints.mjs` | スマホの短いログ・全履歴からキー専用案内を除外、実Cの発見一覧・アイテム選択・指輪の手・終了確認、合成文と再表示、ゲーム文・名前・エラーの維持、PC・英語 |
| `parameter-icons.mjs` | 持ち物の数値ラベルのアイコン化、詳細のアイコンと項目名、武器・防具・指輪・杖、未鑑定の非表示、スマホ320px・PC・日英・配布Wasm |
| `equipment-style.mjs` | 装備中の名前前アイコン、半角括弧・半角空白の数値書式、未鑑定情報の非表示、武器・防具・左右の指輪の装備変更、320pxスマホ・PC・日英・配布Wasm |
| `inventory-tabs.mjs` | 所持品だけの種類・装備中タブ、横スクロール、タイトル高の履歴ボタン、タブごとの位置復元・再読み込みと保存復元、使用後の空タブ除去、PCのキー操作 |
| `discovery-direct.mjs` | アイテム履歴の直接全件表示、変更前の手動D*と20-word/入力位置/表示順を比較、一覧中の保存復元・複数ページ・次ターン。ROGUE_DISCOVERY_BASELINEに変更前のfixture moduleを指定 |
| `repeat-direction-pad.mjs` | 繰返しの長押し・回数入力・原作20回反復、全6方向操作のパッド表示と取消、持ち物からの投射と杖、PCの方向入力、キーボードで狭まった入力画面 |
| `mobile-context-history.mjs` | リストの除外と状況別ボタン、実アイテム拾得・罠の方向選択・階段昇降、PC/スマホの持ち物からアイテム履歴への遷移、配布Wasmの接続 |
| `mobile-layout.mjs` | 共通設定行・連続ズーム・スマホのステータスと履歴・全体図の凡例・設定内の保存とファイル再開 |
| `hud-widgets.mjs` | HUDの配置・正確な値の詳細、狭い画面の横スクロール、フォーカス、DPR |
| `save-export.mjs` | ダウンロードした実ファイル、IndexedDBとの一致、取消、復元と次ターン |
| `rust-browser-host.mjs` | 配布用bindingだけでの起動・原作操作・記録送信なし、RustのIME・crypto・Canvas・全画面・ズーム・画像回転・タッチ長押し・保存再開、Worker起動失敗通知と再開始。`--recovery-only` は失敗復帰・配布導線だけを再確認 |
| `rust-raster.mjs` | ブラウザーの図形・文字・画像描画とPNG decodeを禁止して、Rustの完成RGBA、PC・スマホ・文字/両PNGセット・文字計測・Unicode・持ち物・次ターン・32px回転/nearestを確認 |
| `character-animations.mjs --gallery-only` | 素材ギャラリーの全フレームRGBA、停止・フレーム選択・再生・sheet展開。`--illustrations` はイラスト版。作品のHTTPサーバーから開く |
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
