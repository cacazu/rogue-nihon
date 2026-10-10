# 本番実行と検証・一時領域回収の境界

本番の `web/index.html → ブラウザー接続JS → Rust UI Wasm / Worker → ゲームWasm` と、通常ビルドの入力・生成物を調べた。ローカル起動は `start.ps1 → ../tools/server.mjs` という開発専用経路で、配信サーバーを作品フォルダーの外へ分離している。

## 分離した依存

- 開発・テスト用のローカル配信サーバーは `../tools/server.mjs` に置く。本番の `web/` には含めず、ブラウザーから読み込む経路もない。Node標準モジュールだけでHTTP/HTTPSを起動し、一時領域の回収を呼ばない。
- `web/app.js` から `__rogueBrowserTest`、操作注入用アダプター、診断値のテスト用getterを削除した。`canvas-ui.js` からテストのためだけに公開していたactive instanceと補助メソッドを削除した。
- 同じ実Rust入口を使うテストアダプターを `tests/browser-smoke/test-adapter.mjs` へ移した。Playwrightの `addInitScript` または検証側CDPでだけ注入する。HTML・本番JSから読み込む経路はない。
- 旧タイル検査の `RogueCanvasUi.active` / `planRequest` を使う入口と、フレームからの直接描画・検証アダプターも `tests/tile-test-adapter.mjs` へ移した。本番 `tiles.js` はRustが渡した画像計画の読み込みと描画だけを行う。
- `rg_test_repaint`、`rg_test_save_roundtrip` と専用の内部関数・C宣言を `test-hooks` feature / `RG_TEST_HOOKS` に限定した。通常Wasmにテスト用export・fixtureコードを残さない。
- 通常の `build.ps1` / `build-ui.ps1` が使うPowerShell一時作業領域の作成から、回収レジストリー呼び出しを削除した。コンパイラー自身の専用領域を終了時に閉じる処理は残るが、他の中断した実行を走査・回収しない。

## 全体の確認範囲

| 対象 | 実行時の依存と判断 |
| --- | --- |
| `start.ps1`（ローカル起動用） | 作品フォルダー外の開発用サーバーをNodeで起動し、配信対象を明示する。LAN HTTPSを指定した場合は証明書を生成・更新する。回収処理は呼ばない。`.local/lan` は起動に使う証明書の保存先。 |
| `../tools/server.mjs`（開発・テスト用） | Node標準のHTTP/HTTPS・ファイル配信と、ポート使用中の既存サーバー識別。同じ配信元ならURLを案内し、別サーバーは終了せずポート競合を報告する。本番配布に含めず、回収ツール、テスト、検証結果JSONを読まない。 |
| `web/index.html` / `style.css` | 本番Canvas・ネイティブ入力と4本の本番JSだけ。テスト用scriptや回収処理なし。 |
| `app.js` / `canvas-ui.js` / `tiles.js` | Rustからの指示をブラウザーAPI・Canvas・画像へ接続。テスト用操作窓口なし。 |
| `worker.js` / `event-queue.js` / `library.js` | Worker・共有メモリー入力・Emscriptenのコピー接続。製品の `game.js` / `game.wasm` だけを実行する。 |
| `abi.js` | 本番ABIの生成済み定数。本番HTML/Workerは現在これを読み込まず、実行方針やテスト依存を持たない。 |
| Rustの統合・5層クレート | 本番のクレート、Bevy、serde、埋め込み翻訳JSON・画像manifestを使用。単体テストは `cfg(test)`、回帰用入口は明示的featureに分離。snapshotと保存形式検証APIは状態を変えない通常の診断APIとして残る。 |
| C本体・contract | fixture適用は `RG_TEST_FIXTURES` に限定。通常ビルドには `tests/game-fixtures.c` をリンクしない。 |
| `build.ps1` / `build-ui.ps1` / 生成ツール | コンパイラーと翻訳・ABI入力を使用。検証結果・回収レジストリー・プロセス列挙C#に依存しない。テスト用指定には `game` 以外の出力名を要求する。 |
| `tools/run-clean.ps1` / Node・Python検証ツール | 開発者が明示的に実行する検証処理。回収登録はここに限定し、本番起動から呼ばない。 |
| `tools/deliver-local.ps1` | 過去のローカル納品とその検証記録を確認する開発者用操作。本番起動・HTTP配信から参照しない。 |

## ビルドと検証

通常の `./build.ps1` はfeature無効でビルドし、公開manifestにも `test_hooks: false` / `test_fixtures: false` を記録する。テスト用は `./build.ps1 -OutputName game-fixtures -TestFixtures -KeepArtifacts`、fixture不要の回帰入口だけなら `-OutputName game-check -TestHooks` を明示する。テストビルドが公開済み `game.js` / `game.wasm` を上書きすることはない。

`tests/production-boundary.test.mjs` は全本番JS・起動・ビルドの依存、実Wasmのexportとfixture不在、テスト版の入口を確認する。`tests/browser-smoke/production-boundary.mjs` は、製品ファイルだけの別配置と、読み込むと例外になる回収ツールを置いた配置を作る。どちらも作品の外にある開発用サーバーで配信し、Nodeの実CLIと `start.ps1` の両経路を確認する。PlaywrightでPC・スマホの表示、開始、ターン、持ち物、設定、保存、実ファイル書き出し、再読み込み後の復元と次のターンを実行する。最初のページはテストアダプターなしで描画を確認し、サーバーソースが公開されないことも確認する。

通常の `canvas.mjs` / `hud-widgets.mjs` / `save-export.mjs` も本番ファイルに依存しているテスト入口を使わず、検証側からアダプターを注入して実行する。歴史的な比較アーカイブがない環境での旧Wasm比較と、実機スマートフォン・Windows IMEの手操作は今回の自動検証に含めない。
