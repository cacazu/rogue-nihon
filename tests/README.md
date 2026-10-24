# 検証の実行

作品フォルダーを作業ディレクトリーにします。仕様の正本は [実装](../docs/IMPLEMENTATION-ja.md)、[原作対応](../docs/ORIGINAL-SPEC-ja.md)、[日本語化](../docs/LOCALIZATION-ja.md)、[地図表示](../docs/MAP-DISPLAY-ja.md)。この文書は試験の選択・準備・実行方法を扱います。

Node と Python 3.11以上を使用します。Rust/CargoとEmscriptenはビルドする検査に必要です。ブラウザー検査はPlaywrightを通常のNodeモジュールとして読み、既定では付属Chromiumを使います。既存環境を使う場合は共通入口の `--python <実行ファイル>`、`--playwright <パッケージパス>`、`--browser <実行ファイル>`、`--sdk-root <SDK>` で指定できます。設定を省略したツールはPATHと有効化済みSDKから選びます。

`node tests/run.mjs --list` で試験候補を列挙します。`node --test tests/portability.test.mjs` は全試験と共通実行ヘルパーを監査し、固定パスやOS限定のskipが入った場合に失敗します。

## 全文言の検査

```sh
node tests/run.mjs --keep-artifacts wording
# 現在のmain/fixture buildが既にある場合
node tests/wording.test.mjs --skip-build --keep-artifacts
```

C出力箇所・文言IDから実際の翻訳処理を通し、未登録ID、引数不足、未置換、文字欠落、ログ内の翻訳エラーを失敗として検出します。UIラベル・名前・書式も全カタログを確認します。ブラウザーはPlaywrightのスマホ表示・タップとPC表示を使用します。装備・投擲・拾得・保存再開の実操作も検査し、再開前の翻訳失敗を消して成功扱いにしません。不特定の名前やゲーム状態の全組み合わせを実プレイした検査ではありません。

`wording-cases.generated.*` は `tools/generate-wording-tests.py` が現行ソースから生成し、fixture buildで自動更新します。負例には未登録ID・引数不足・未知のdescriptorと、通常buildにないMASTERデバッグ文を含みます。負例の検出を通常の翻訳成功件数へ混ぜません。

## 通常ゲームと専用ブラウザー検証ABIで行う検査

```sh
python tools/build-browser-tests.py --keep-artifacts
node --test tests/browser-boundary.test.mjs tests/production-boundary.test.mjs tests/event-queue.test.mjs tests/browser-smoke/host.test.mjs tests/browser-smoke/localization.test.mjs
node tools/run-clean.mjs cargo test --offline --locked --manifest-path rust/Cargo.toml --workspace --exclude rogue-layers --lib
python tools/check-rust-layers.py
python tools/check-rust-layers.py --binary entity-check
python tools/check-rust-layers.py --binary engine-check
```

ブラウザーの観測・操作は専用 `browser-test` featureの生成物を使います。`test-adapter.mjs` はPlaywrightのrouteでbindingを置き換え、配布用のJS/Wasmを変更しません。`queue-runtime.mjs` はRustのSAB実装を呼ぶ検証側の名前対応だけです。

Cとリンクする `rogue-layers` は独立lib testから除外します。ゲームの検査はstandalone WasmとRustの開始設定ABIを使います。純粋な層のテスト・単体binの成功だけではCゲームやブラウザーを実行したことにはなりません。

| 検査 | 実行入口 |
|---|---|
| カタログ・翻訳・Cヘルプ対応 | `tests/catalog.test.py`、`localization.test.py`、`ui-game-catalog.test.py` |
| Cメッセージ・ページ送り・意味捕捉・UTF-8 | `tests/build-message-tests.py` |
| 確定得点の観測・C状態保持 | `tests/score-results.test.mjs`。quit/death/winner、取消・保存を検査し、変更前baselineがあればC状態・RNG・フレームも比較 |
| 個人ランキングの永続化・再試行・表示 | `tests/browser-smoke/rankings.mjs`（独立context、fixture C + browser-test UI） |
| C保存codec・参照・失敗時rollback | `tests/build-save-adapter.py`。必要時に `--diagnostics` |
| Rust formatter・入力・保存・名称・Bevy | `tools/check-rust-layers.py` と各Binary |
| タイル語彙・画像・重ね順 | `tests/tiles.test.mjs`、`pixels.test.mjs`、`graphics-beams.test.mjs` |
| 実ゲーム・locale差・保存継続 | `tests/game-regression.test.mjs`、`game-ui.test.mjs`、`game-localization.test.mjs`、`game-more-localization.test.mjs`、`game-log-paging.test.mjs` |
| PCの品物先行・終了待ち | `tests/item-first.test.mjs` と `tests/quit-flow.test.mjs`。品物先行の使用・取消・新instance保存継続と、Q肯定時の得点表示・死亡／勝利の意味待ちを実Cで検査。通常buildとfixture buildを先に用意する |
| 通常生成地図の確認済み境界・保存・C状態保持 | `tests/map-checked.test.mjs`。通常 `game.wasm` の新規開始と新instance復元を確認し、`ROGUE_CHECKED_BEFORE` に変更前の通常Wasmを指定すると同じ入力のC画面・状態・RNGを比較。探索選択の通常冒険回帰データは `tests/data/autoexplore-normal-potion.json` |
| 公開地図の記憶・現在視界・保存境界 | `tests/map-memory.test.mjs`。変更前fixture Wasmを `ROGUE_MAP_MEMORY_BEFORE` に指定し、同じ消費済み入力のC状態・RNG・原画面を比較。未指定時は変更前比較のみ明示skip |
| 自動探索・操作・地図記憶の実ブラウザー | `tests/browser-smoke/autoexplore.mjs`、`autoexplore-controls.mjs`、`map-memory.mjs`。先に通常・fixture・browser-testの生成物を用意し、[ブラウザー手順](browser-smoke/README-ja.md)から対象を選択 |
| 自動移動のCイベントと原作状態 | `tests/autowalk.test.mjs`。比較する変更前fixture Wasmを `ROGUE_AUTOWALK_BEFORE` へ指定。未指定時は変更前比較のみ明示skip |
| 目的地走行の原作run・保存再生 | `tests/target-run.test.mjs`。走る1/2の停止・区間切替・専用待ち・取消・保存復元を検査。`ROGUE_TARGET_RUN_MODULE` に現行fixture Wasm（既定 `build/game-fixtures.wasm`）、`ROGUE_TARGET_RUN_BEFORE` に変更前fixture Wasm、`ROGUE_TARGET_RUN_ORIGINAL` に固定原典fixture Wasmを指定すると全検査を実行。比較先未指定時は該当比較のみ明示skip。契約は[実装資料](../docs/IMPLEMENTATION-ja.md#目的地への自動移動)を参照 |
| 実ブラウザー | [Playwrightの実行とシナリオ](browser-smoke/README-ja.md) |

Python検査は使用するPythonを指定し、`node tools/run-clean.mjs <Python実行ファイル> <試験ファイル>` で実行できます。

## fixture・原作比較の準備

fixtureまたはテストexportを使う検査は、専用Wasmを先に作ります。通常の配布buildを上書きしない出力名を使います。

```sh
python tools/build.py --output-name game-fixtures --test-fixtures --keep-artifacts
# fixtureを使わず回帰入口だけ必要な場合
python tools/build.py --output-name game-check --test-hooks --keep-artifacts
```

原作archiveの版・hashは [原作対応](../docs/ORIGINAL-SPEC-ja.md#対象と比較元) で照合します。原本を展開したパスを明示して比較用ソースを生成します。原本同梱のconfigure/installは実行しません。

```sh
# 使用環境のPythonで実行
python tests/prepare-baseline.py --original /path/to/rogue5.4.4
python tests/audit-baseline.py
python tools/build.py --logic-directory tests/baseline-src --output-name baseline --keep-artifacts
python tools/build.py --logic-directory tests/baseline-src --output-name baseline-fixtures --test-fixtures --keep-artifacts
node tests/run.mjs --env ROGUE_BASELINE_MODULE=build/baseline.wasm tests/game-regression.test.mjs tests/game-fixtures.test.mjs
```

auditはprepareが記録した原本パスを読みます。`game-fixtures.test.mjs` は `build/baseline-fixtures.wasm` と `game-fixtures.wasm` を使用します。`run-game.mjs` の検証hostは同じ開始設定ABIを使い、歴史的なJS loader付きarchiveも読み込めます。各scriptのfixture・比較archive依存を確認してから実行してください。比較元がなくskipした検査は原作一致を確認した扱いにしません。20 word・入力位置・原英文画面に加え、保存復元後の次操作を照合します。

投げ物の壁衝突は `tests/throw-wall.test.mjs` で、同じ `game-fixtures.c` を使った固定原作・壁の落下中心を変更する前の独立C・現行Cを比較します。`ROGUE_THROW_ORIGINAL` は原作baseline fixture、`ROGUE_THROW_BEFORE` は落下中心変更前Cを保持して同じfixtureだけをリンクした独立Wasm、`ROGUE_THROW_WASM` は現行版（既定 `build/game-fixtures.wasm`）を指定します。全品種・縦横斜め・岩と秘密壁の着地は、壁の向こうの候補を含め、同じ消費済み入力と全20状態語・RNG・C画面・着地位置で原作と一致させます。着地先なしの公開品名の安全性を検査し、扉・敵・魔法・矢罠・敵ドロップの13例も原作と比較します。

UI変更前・画像変更前などの歴史的比較は、各scriptの環境変数で指定した独立archiveが必要です。原作baselineとの比較と、以前のWeb版との比較を区別します。

## 一時出力と実行記録

通常の検証は実行専用の一時領域を使い、終了時にcache・中間生成物・ログ・画像等を片付けます。比較buildは `--keep-artifacts`、Node/Pythonの結果は `ROGUE_KEEP_ARTIFACTS=1` で保持します。

```sh
node tests/run.mjs --keep-artifacts tests/browser-smoke/canvas.mjs
```

現在の成功判断は終了コードと実際の検査結果に基づきます。出力を保持した場合の場所はscriptのoutput定義を参照します。過去の成功件数や文書内の例を現在の証拠として扱いません。

`tools/verify-japanese.py` は補助検査の実行・集約、`tools/record-verification.py` は既存証拠の集約です。後者はゲームを実行せず、現在のsource/moduleと試験時のhashが異なる記録を拒否します。必要な入力・引数は各toolの `--help` で確認し、未記録・skip・残る範囲を明示します。記録parserの検査は `tests/record-verification.test.py` です。
