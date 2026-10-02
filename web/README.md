# Web のホスト

C/Rust の Wasm をビルドした後、プロジェクト直下で実行します。

```powershell
node web/server.mjs 4173
```

`http://127.0.0.1:4173/` を開きます。サーバーは loopback のみで待機し、COOP same-origin と COEP require-corp を返して SharedArrayBuffer を有効にします。

`app.js` は DOM 入力、Canvas と日本語 DOM の描画、IndexedDB 保存を担当します。ゲームのコマンド解釈・翻訳・ルールは Rust/C にあります。`worker.js` はゲームごとに Emscripten モジュールを新規作成し、`/locale.txt`、必要なら `/restore.json` を配置して `rg_run` を呼びます。既定言語は日本語で、開始前に英語を選べます。`abi.js` は `contract/rogue_abi.h` から生成します。

主スレッドは raw event を `event-queue.js` の共有キューへ渡します。Atomics.wait で待機するのは Worker だけです。キューの容量は 2 の累乗で、uint32 カウンターの周回時も位置を保持します。Unicode 文字入力は一括で公開し、空きが足りなければ全体を拒否して通知します。元 C が行う typeahead flush は未消費 raw event だけを破棄し、消費済み入力の Rust journal は保持します。

## 表示ペイロード

`library.js` の Emscripten import は `js_rg_read_event`、`js_rg_flush_input`、`js_rg_present`、`js_rg_store`、`js_rg_outcome` です。present の UTF8 JSON は次のイベントを受け付けます。

| type | 表示上の意味 |
| --- | --- |
| frame | cells は原画面の回帰観測用。map_cells の ASCII 地形・記号を Canvas へ、ui の日本語状態・一覧・メッセージを DOM へ表示する。 |
| message | 意味 ID、引数、翻訳済み text をメッセージ欄へ表示する。 |
| input-context | input.kind、limit_bytes、initial/current_text、placeholder に従い専用文字入力欄と進行待ちを更新する。 |
| presentation | 既存 frame.ui の診断スナップショットと DOM だけ更新する。raw frame や frameCount を増やさない。終了時の確認文・More・入力待ちを消す。 |
| trace | 診断用の論理 trace を保持する。通常プレイでは送らない。 |

日本語は固定 1 バイトの Canvas セルへ入れません。一覧は DOM で折り返し・縦スクロールし、日本語の非 game 画面では空 Canvas を隠します。再描画と画面サイズ変更は最後のフレームだけを読み、ゲームへ入力を送りません。`ui.message` により、復元フレームだけでも直前の日本語メッセージを表示します。

ホストのラベル・ARIA・通知は `locales/ui-web-ja.json` と `ui-web-en.json` の 83 個の共通意味 ID を使います。ゲームの翻訳は Rust が供給します。fallback_used/missing_ids を記録し、日本語モードの英語 fallback 本文を一般画面へ表示しません。例外の実装スタックは診断ログへ記録します。

## 入力と保存

開始名は UTF8 49 バイト以内、ゲーム内の文字入力と名前編集は原 C の MAXINP に従い 50 バイト以内です。IME の変換中とフォーム編集はゲームへ送らず、専用フィールドの確定時に Ctrl-U、Unicode scalar 列、Enter を一括送信します。既定果物は日本語 placeholder と空欄を使い、空欄確定で C の原既定値を保持します。マウスの地図クリックは隣接方向だけを入力します。

入力途中の保存は現在の文字列を Ctrl-U と Unicode 列で反映し、Enter を送らず保存します。Rust の保存形式 v2 をホストでは opaque bytes として扱い、IndexedDB の書き込み transaction 完了後に成功を表示します。保存ダウンロードは同じ JSON envelope を出力します。同じ保存スロットを使うにはサーバーのポートを固定します。

## 検証

```powershell
node --test tests/browser-smoke/host.test.mjs tests/browser-smoke/localization.test.mjs
$env:ROGUE_JA_SCENARIO='1'
node tests/browser-smoke/run.mjs
```

2026-10-02 11:32:56.913–11:33:02.347 UTC の実 Chrome 検証は 19/19 成功しました。host/catalog 検証は 10/10 成功。日本語名・状態・ヘルプ・アイテム・設定・終了スコア、一覧の折り返しと Canvas の復帰、IME 入力途中の保存復元と論理 trace 一致、既定果物の日本語表示、消費済み終了プロンプトの除去を確認しました。実行範囲の翻訳 fallback/未登録 UI ID は 0、ブラウザ例外はありません。

実行時の Wasm は 1,042,044 バイト、SHA256 `d4e4f53f7e3b5c6e1a86c1fa185f41d172893afa3d269a101e10bbbd3ee2fb56` です。[証拠](../tests/browser-smoke/output-ja/evidence.json)、[画面](../tests/browser-smoke/output-ja/browser.png)、[詳しい検証範囲](../tests/browser-smoke/README-ja.md) を保存しています。墓碑・勝利の実 Chrome 到達と Windows IME 製品の手操作はこのシナリオに含みません。

Browser API references: [Atomics.wait](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/wait), [IndexedDB transactions](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase).
