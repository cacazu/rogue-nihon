# 検証の実行

作品フォルダーを作業ディレクトリーにします。仕様の正本は [実装](../docs/IMPLEMENTATION-ja.md)、[原作対応](../docs/ORIGINAL-SPEC-ja.md)、[日本語化](../docs/LOCALIZATION-ja.md)、[地図表示](../docs/MAP-DISPLAY-ja.md)。この文書は試験の選択・準備・実行方法を扱います。

## 通常ビルドで行う検査

```powershell
node --test tests/browser-boundary.test.mjs tests/production-boundary.test.mjs tests/event-queue.test.mjs tests/browser-smoke/host.test.mjs tests/browser-smoke/localization.test.mjs
.\tools\run-clean.ps1 cargo test --offline --locked --manifest-path rust/Cargo.toml --workspace --exclude rogue-layers --lib
.\tools\check-rust-layers.ps1
.\tools\check-rust-layers.ps1 -Binary entity-check
.\tools\check-rust-layers.ps1 -Binary engine-check
```

C/JSをリンクする `rogue-layers` は独立lib testから除外します。純粋な層のテスト・単体binの成功だけではCゲームやブラウザーを実行したことにはなりません。

| 検査 | 実行入口 |
|---|---|
| カタログ・翻訳・Cヘルプ対応 | `tests/catalog.test.py`、`localization.test.py`、`ui-game-catalog.test.py` |
| Cメッセージ・ページ送り・意味捕捉・UTF-8 | `tests/build-message-tests.ps1` |
| C保存codec・参照・失敗時rollback | `tests/build-save-adapter.ps1`。必要時に `-Diagnostics` |
| Rust formatter・入力・保存・名称・Bevy | `tools/check-rust-layers.ps1` と各Binary |
| タイル語彙・画像・重ね順 | `tests/tiles.test.mjs`、`pixels.test.mjs`、`graphics-beams.test.mjs` |
| 実ゲーム・locale差・保存継続 | `tests/game-regression.test.mjs`、`game-ui.test.mjs`、`game-localization.test.mjs`、`game-more-localization.test.mjs`、`game-log-paging.test.mjs` |
| 実ブラウザー | [Playwrightの実行とシナリオ](browser-smoke/README-ja.md) |

Python検査は使用するPythonを指定し、`tools/run-clean.ps1 <Python実行ファイル> <試験ファイル>` で実行できます。

## fixture・原作比較の準備

fixtureまたはテストexportを使う検査は、専用Wasmを先に作ります。通常の配布buildを上書きしない出力名を使います。

```powershell
.\build.ps1 -OutputName game-fixtures -TestFixtures -KeepArtifacts
# fixtureを使わず回帰入口だけ必要な場合
.\build.ps1 -OutputName game-check -TestHooks -KeepArtifacts
```

原作archiveの版・hashは [原作対応](../docs/ORIGINAL-SPEC-ja.md#対象と比較元) で照合します。原本を展開したパスを明示して比較用ソースを生成します。原本同梱のconfigure/installは実行しません。

```powershell
# 使用環境のPythonで実行
python tests/prepare-baseline.py --original C:\path\to\rogue5.4.4
python tests/audit-baseline.py
.\build.ps1 -LogicDirectory tests/baseline-src -OutputName baseline -KeepArtifacts
.\build.ps1 -LogicDirectory tests/baseline-src -OutputName baseline-fixtures -TestFixtures -KeepArtifacts
$env:ROGUE_BASELINE_MODULE = (Resolve-Path build/baseline.js).Path
node --test tests/game-regression.test.mjs tests/game-fixtures.test.mjs
Remove-Item Env:ROGUE_BASELINE_MODULE
```

auditはprepareが記録した原本パスを読みます。`game-fixtures.test.mjs` は `build/baseline-fixtures.js` と `game-fixtures.js` を使用します。各scriptのfixture・比較archive依存を確認してから実行してください。比較元がなくskipした検査は原作一致を確認した扱いにしません。20 word・入力位置・原英文画面に加え、保存復元後の次操作を照合します。

UI変更前・画像変更前などの歴史的比較は、各scriptの環境変数で指定した独立archiveが必要です。原作baselineとの比較と、以前のWeb版との比較を区別します。

## 一時出力と実行記録

通常の検証は実行専用の一時領域を使い、終了時にcache・中間生成物・ログ・画像等を片付けます。比較buildは `-KeepArtifacts`、Node/Pythonの結果は `ROGUE_KEEP_ARTIFACTS=1` で保持します。

```powershell
$env:ROGUE_KEEP_ARTIFACTS = '1'
node tests/browser-smoke/canvas.mjs
Remove-Item Env:ROGUE_KEEP_ARTIFACTS
```

現在の成功判断は終了コードと実際の検査結果に基づきます。出力を保持した場合の場所はscriptのoutput定義を参照します。過去の成功件数や文書内の例を現在の証拠として扱いません。

`tools/verify-japanese.py` は補助検査の実行・集約、`tools/record-verification.py` は既存証拠の集約です。後者はゲームを実行せず、現在のsource/moduleと試験時のhashが異なる記録を拒否します。必要な入力・引数は各toolの `--help` で確認し、未記録・skip・残る範囲を明示します。記録parserの検査は `tests/record-verification.test.py` です。
