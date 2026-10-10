# ブラウザーUIとRustの境界

2026-10-10に本番の `web/` 内のJS/MJS全8ファイル、HTMLの入力制約、ゲーム用Emscriptenの接続を確認した。UI・入力・セッションの判断は `rust/crates/browser-display/src/controller.rs`、入力検証・履歴・設定値・翻訳は `policies.rs`、画面とウィジェットは `rogue-display::browser_ui` / `widgets` に置く。

## Rustへ移した処理

| 対象 | Rustで行う処理 |
| --- | --- |
| 入力 | キーと修飾キーの解釈、IME中の操作制限、名前・seed・UTF-8バイト数・制御文字の検証、Unicode入力列、文字編集途中の保存と確定、キュー失敗時の編集状態維持 |
| 画面 | トップ・ゲーム・設定・結果の遷移、操作の可否、フォーカス先、ポインター取消、スクロール・カメラ・拡大率、イベントの既定動作を取り消す条件 |
| セッション | 起動条件、Worker世代と古いコールバックの無視、終了確認の入力、トップ復帰、フレームの検証、復元完了の通知 |
| 保存 | 保存中・完了・失敗・取消の状態、フラッシュした入力に保存操作が含まれるかの判定、書き出しの可否とファイル名、IndexedDB transaction完了後の成功通知 |
| 表示設定 | URLと保存設定の選択、表示モードと拡大率の検証・補正、設定JSON、言語・文書タイトル、ランダム名とseedの重複回避 |
| 履歴・翻訳 | ゲーム／システムの分類、空表示の除外、重複を残す500件の履歴、名前付き引数、翻訳欠落の検出と表示制限 |
| タイル | 語彙・フレームの検証、画像一覧と寸法、言語別説明、可視範囲、地形と役者の重ねる順序、端数を含むDPRでの描画座標 |

## JSに残した処理の全確認

| ファイル | 残した処理と境界 |
| --- | --- |
| `app.js` | Rustの命令に対応するWorker・IndexedDB・localStorage・crypto・全画面・Blobダウンロード・リンク・文書・console API。保存の実バイトはAPIへ渡すための不透明なバッファ。操作IDのaction表、ゲーム状態、入力検証、翻訳、ログ分類、テスト用操作窓口は持たない。 |
| `canvas-ui.js` | WasmメモリーとJSONの接続、イベントと入力値・選択範囲・画面寸法の観測、Canvas2D描画・文字計測、ネイティブ入力欄・pointer capture・requestAnimationFrame・timer API。イベント取消とフォーカス先はRustに従う。 |
| `tiles.js` | Rust指定画像のデコードと描画、ピクセルを保つ回転のラスタライズ。従来の `draw` / `validate` はテスト専用アダプターへ移した。地形・役者・可視性の判断は持たない。 |
| `event-queue.js` | SharedArrayBuffer/Atomicsのリング転送、待機・起床・切断・残量・容量の検査。配列の全公開または全拒否は転送の整合性のために必要。生の整数を転送し、保存キーやゲームキーを解釈しない。 |
| `worker.js` | EmscriptenとWorker、仮想FS、入力・フレーム・保存の転送。Rust指定の言語とファイル内容を渡し、フラッシュした生入力をRustへ報告する。 |
| `library.js` | Wasmの借用メモリーをコピーしてHost APIへ渡すFFI。 |
| `abi.js` | 契約ヘッダーから生成した定数宣言。通常ページとWorkerでは読み込まない。 |
| `server.mjs` | HTTP/HTTPSの静的配信、隔離ヘッダー、公開パス・HTTP method・port・TLSの検査。ブラウザーUI、入力処理、テスト、一時領域の回収には接続しない。 |

`localization.js`、`view-settings.js`、`game-log.js` は削除した。HTMLにはネイティブ編集用入力欄を残し、名前・seedの既定値と検証制約はRustで決める。`build/game.js` はEmscriptenが生成するWasm・メモリー・仮想FSの接続であり、今回のUI変更は独立した `build/browser-ui.wasm` にビルドする。

## 検証と本番からの分離

本番のテスト窓口・通常Wasmの回帰専用関数・サーバーから一時領域回収への依存を切り離した。[全起動・配信・ビルド経路と独立性の実行検証](PRODUCTION-BOUNDARY-ja.md)に対象と結果を記録する。

`tests/browser-boundary.test.mjs` は全手書きJSの残存規則・テストimportを検査し、JSのmodelを差し替えてもRustのセッションを変えられないことを実際のUI Wasmで確認する。Rustの8件のテストは入力制限、設定の破損、履歴、保存transaction、キュー失敗、IME制限、古いWorker、ランダム値の重複を確認する。タイルの描画試験も実際のRustの計画を使う。

HUDの大きな値を使う試験はPlaywrightの `addInitScript` でテスト内のWorker接続を差し替えてpresentationを送る。本番にはfixture・データ差し替え用の分岐を置かない。一時フォルダーとダウンロード先の問題への対処も `tests/browser-smoke/browser-runtime.mjs` 内に置く。

Playwrightは `canvas.mjs`（31件）、`hud-widgets.mjs`（27件）、`save-export.mjs`（6件）を実行する。主要操作、IME編集・保存・新規Workerへの復元、終了、全画面、PC・スマホ・日英、DPR 2、実ファイル6回の書き出しを確認する。名前と8項目のステータスはRustで左詰めの1行に配置し、設定ボタンはHUD外に置く。狭い画面での横スワイプ、横スクロールとTabでの項目表示もRustが扱う。画面操作だけでC/RNG/ターン/入力回数が変わらないことも確認する。証拠とスクリーンショットは各 `tests/browser-smoke/output/` に保持した出力に記録する。

過去のCanvas化前のWasmアーカイブは今回の環境にないため、その歴史的バイナリーとの比較は実行していない。現在のゲームでのC/RNG状態の一致、保存・復元、次のターンは確認する。Windowsの実IME製品の手動操作は自動化の範囲に含めない。
