# Playwrightによるブラウザー検証

作品フォルダーで実行します。実C/Rust/Wasm、隔離したブラウザープロファイルとテスト用originを使用します。仕様は [実装](../../docs/IMPLEMENTATION-ja.md)、[原作対応](../../docs/ORIGINAL-SPEC-ja.md)、[日本語化](../../docs/LOCALIZATION-ja.md)、[地図表示](../../docs/MAP-DISPLAY-ja.md) に集約しています。

## 準備と実行

既存のPlaywrightパッケージとChrome/Brave実行ファイルを指定します。fixtureを使うシナリオには [専用build](../README.md#fixture原作比較の準備) が必要です。

```powershell
$env:ROGUE_PLAYWRIGHT_MODULE = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:ROGUE_CHROME = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node tests/browser-smoke/canvas.mjs
```

通常は終了時に一時出力を削除します。結果とスクリーンショットを確認・保持する場合は実行前に `ROGUE_KEEP_ARTIFACTS=1` を設定します。`browser-runtime.mjs` はWindowsのTEMP/TMPとダウンロードを実行専用領域へ向けます。

## シナリオの選択

| script（tests/browser-smoke/） | 確認対象 |
|---|---|
| `canvas.mjs` | PC・スマホ・日英の開始、単一Canvas、持ち物・ヘルプ・設定、IME編集、保存復元、終了、全画面、フッターのリンク |
| `mobile-ui.mjs` | スマホのトップ・開始/保存/トップからのロード、開始直後からの操作パッド、48px以上の新規ターゲット、操作一覧の全コマンド・ボタン上スワイプ・背景入力遮断、広域・全画面のC/RNG不変、320px縦/横表示、PC幅への復帰 |
| `equipment-style.mjs` | 装備中の名前前アイコン、半角括弧・半角空白の数値書式、未鑑定情報の非表示、武器・防具・左右の指輪の装備変更、320pxスマホ・PC・日英・配布Wasm |
| `inventory-tabs.mjs` | 所持品だけの種類・装備中タブ、横スクロール、タイトル高の履歴ボタン、タブごとの位置復元・再読み込みと保存復元、使用後の空タブ除去、PCのキー操作 |
| `discovery-direct.mjs` | アイテム履歴の直接全件表示、変更前の手動D*と20-word/入力位置/表示順を比較、一覧中の保存復元・複数ページ・次ターン。ROGUE_DISCOVERY_BASELINEに変更前のfixture moduleを指定 |
| `repeat-direction-pad.mjs` | 繰返しの長押し・回数入力・原作20回反復、全6方向操作のパッド表示と取消、持ち物からの投射と杖、PCの方向入力、キーボードで狭まった入力画面 |
| `mobile-context-history.mjs` | リストの除外と状況別ボタン、実アイテム拾得・罠の方向選択・階段昇降、PC/スマホの持ち物からアイテム履歴への遷移、配布Wasmの接続 |
| `mobile-layout.mjs` | 共通設定行・連続ズーム・スマホのステータスと履歴・全体図の凡例・設定内の保存とファイル再開 |
| `hud-widgets.mjs` | HUDの配置・正確な値の詳細、狭い画面の横スクロール、フォーカス、DPR |
| `save-export.mjs` | ダウンロードした実ファイル、IndexedDBとの一致、取消、復元と次ターン |
| `startup.mjs` | Node/start.ps1、既存origin、ポート競合、HTTPS、保存後の再起動 |
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
