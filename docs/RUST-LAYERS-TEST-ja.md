# Rust三層の単体検査

`rust/src/bin/layer-check.rs` は `input.rs`、`display.rs`、`platform.rs`、`entities.rs`、生成済み `abi.rs` を直接読み込むCargo autobinである。C FFIを呼び出さず、純粋なRustの公開関数を検査する。Cのゲームループ、ブラウザDOM、IndexedDBはこの実行の対象に含めない。

2026-10-02、Rust 1.98.1 / `wasm32-unknown-emscripten`、既存のEmscripten 6.0.8、Node 24.19.0で **109項目すべて成功**した。

| 層 | 項目数 | 確認内容 |
|---|---:|---|
| 入力 | 38 | 8方向の通常移動、Shiftによる走行、Ctrl変換、ASCIIの修飾キー、リピート、Escape/Space、Altや未対応キーの除外、Unicodeをゲーム命令として扱わないこと、保存・入力終了の制御イベント |
| 表示 | 31 | 原版の能力表示行を含むprintf書式、文字・文字列・整数・浮動小数点、符号・幅・精度・ゼロ埋め、星指定、Unicodeの `{n}` による語順変更、波括弧のエスケープ、不足・余剰・型違いの引数、未対応書式、幅・精度の上限、意味ID、大文字化、fallback、断片連結 |
| 保存 | 40 | checkpoint・journal・seedの往復、UTF-8名、hexの全バイト値、format/version/ABI/source/checksumの不一致、長さ制限、不正hex、journalのキーや位置の不整合、壊れたJSON、版2のpresentation復元と形状の制限、改ざん拒否、版1の互換性 |

名称と日本語の意味記述子は `entity-check.rs` の独立実行で **694項目成功**。詳細は [ENTITIES-ja.md](ENTITIES-ja.md)。この実行はアイテムや所持品行、日本語の戦闘語順、未識別情報の保護、任意入力のUTF-8保持、未知断片の `missing_ids` も検査する。

さらに、ネイティブの `cargo test --bins` で組込みの **4 unit tests成功・失敗0・無視0**を確認した。`entity-check` の表示formatter 1件と、`layer-check` の入力・表示・保存 3件である。これらは上の109/694項目とは別の検査であり、同じ数として集計しない。

ゲームライブラリにはC/JSへの外部参照があるため、`Cargo.toml` の `[lib] test = false` と `staticlib / rlib` を使う。binが純粋なモジュールを直接読み込むことでネイティブ単体試験とWasm単体実行を成立させる。Cargo.lockの依存版は固定されており、検査は `--offline --locked` で行う。

## 再実行と証拠

三層の単体実行だけを行う場合は次を使う。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/check-rust-layers.ps1
```

ハッシュとログを含む補助検証一式は次で実行する。

```powershell
& 'C:\Users\kit\emsdk\python\3.13.3_64bit\python.exe' tools/verify-japanese.py --merge build/c-supplementary-evidence.json
```

事前に `--plan` を指定すると、実行するコマンドと入力ファイル数だけを表示する。既定の範囲はRust三層、動的名称、ネイティブbin単体試験、fmt/clippy、Nodeホスト単体試験、カタログ・翻訳validator。Chromeや実ゲームはこの補助ランナーでは起動しない。Cのメッセージ・ページ送り・意味記述子・UTF-8入力の試験は、別担当が実行した現行の証拠を `--merge` で取り込む。

結果は `build/supplementary-results.json`、実行ログは `build/verification-logs/*.log`。範囲ごとにソースとカタログの実行前後のSHA-256を比較し、Wasm/JSとネイティブ試験実行ファイルもビルド後・試験直前・試験直後に比較する。統合時に改めて全ファイルのハッシュを確認し、ソースが変わった古い実行証拠は拒否する。件数は実際の構造化出力、Cargo、Node TAP、Python unittestから取得し、過去の期待件数で成功を補わない。

SDKの絶対パスとプロセス限定の `EM_CONFIG` / `EM_CACHE` を使い、グローバルPATHや依存の版を変更しない。Rustリンカーには公式配布の既存 `upstream/emscripten/emcc.exe` を指定する。単体実行の主な指定は `panic=abort`、`ENVIRONMENT=node`、`EXIT_RUNTIME=1`、`ALLOW_MEMORY_GROWTH=1`。後者は、16MiBを超える保存入力の拒否試験に必要な入力配列を確保するための単体実行設定である。EmscriptenにはRust targetが指定する `WASM_BIGINT` の非推奨警告が出るが、実行結果は終了コードと検査結果で判断する。

109項目の構造化出力は次のとおり。

```json
{"display_checks":31,"input_checks":38,"platform_checks":40,"result":"pass","scope":"pure Rust modules in standalone Emscripten/Node executable; no C game or browser","total_checks":109}
```

IMEのDOMイベント順序、Cの保存状態の意味的同一性、実ゲームのターン・乱数・再描画、ブラウザの永続保存はそれぞれ全体の検証資料を参照する。この文書のRust単体検査だけで、それらの成功は主張しない。
