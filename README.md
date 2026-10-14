# 元祖Rogue 5.4.4 日本語Web版

RRP Rogue 5.4.4のCルールを使う日本語Web版です。本文・品名・怪物・ヘルプ・設定・終了画面を日本語で表示し、文字・イラスト・32×32ドット絵の地図を選べます。

## 起動

このフォルダーでPowerShellを開いて実行します。

```powershell
.\start.ps1
```

[http://127.0.0.1:4173/](http://127.0.0.1:4173/) のトップで名前・シード・言語を選び、「はじめから」「前回の続き」「セーブファイル」を使います。同じ配信元が起動済みなら同じURLを案内します。別サーバーがポートを使っている場合は、明示的に `.\start.ps1 -Port 4174` などを指定します。停止は起動した端末でCtrl+Cです。

スマホでもトップ画面で名前・シード・言語を選べます。「前回の続き」はブラウザー内の保存、「セーブファイル」は選んだ保存JSONから再開します。保存がない場合は「前回の続き」を無効にします。トップ右上は全画面ボタンだけです。開始直後から操作ボタンを表示します。

LANのスマホでは `.\start.ps1 -Lan` を実行し、同じLANから表示されたHTTPS URLを開きます。複数のネットワークがある場合は `-Address <PCのIPv4>` を指定します。証明書生成にはOpenSSLが必要で、ローカル証明書の接続許可をブラウザーで行います。

## 操作と保存

矢印またはh/j/k/l、斜めはy/u/b/nで移動、Shift＋方向で走行、`.` で待機、`i` で持ち物、`?` でヘルプです。PCはキーボード、スマホは画面の方向・操作ボタンを使います。マップの隣接クリックでも移動できます。

右上の設定から全画面・操作ボタンの表示切替・表示方式・保存・書き出し・セーブファイルから再開・トップへの復帰・冒険の終了・原作の設定を選べます。地図はピンチとホイールで拡大縮小できます。スマホは地図の上に階層・所持金・レベル・HP・空腹度、地図の下にメッセージを表示します。ステータス欄をタップすると全ステータスを、メッセージ欄をタップすると履歴を開きます。表示言語と前回の続きはトップ画面で選びます。画面下の「操作一覧」から各コマンド・走行・反復回数・広域表示・センタリングを選べます。開始名はUTF-8で49 byte、ゲーム内の名前・命名は50 byteまでです。

保存はブラウザーのoriginごとのIndexedDBへ入ります。ポートやブラウザーが変わると保存枠も変わります。入力途中も保存でき、ロードは新しいWorkerで再開します。トップへ戻る前に必要な進行を保存してください。旧端末Rogueのsaveには対応しません。

## 実装資料

| 文書 | 内容 |
|---|---|
| [実装の判断と境界](docs/IMPLEMENTATION-ja.md) | 層の責務、ABI、実行順、checkpoint・保存、本番と検証 |
| [原作仕様とWeb版の対応](docs/ORIGINAL-SPEC-ja.md) | 原典、[原作のキーボード・コマンド一覧](docs/ORIGINAL-SPEC-ja.md#original-commands)、入力待ち・周期・乱数、意図した変更と比較基準 |
| [日本語化と意味データ](docs/LOCALIZATION-ja.md) | カタログ、原作データ表、descriptorの可視条件、UTF-8 |
| [地図表示と原作記号](docs/MAP-DISPLAY-ja.md) | 記号と画像ID、観測・足元・弾道、画像と表示設定 |

## ビルドと検証

ゲーム用Rustのtargetは `wasm32-unknown-emscripten`、UI用は `wasm32-unknown-unknown`。依存はCargo.lockで固定し、Rust・Emscripten・NodeとCargo.lockに一致するwasm-bindgen-cliを使用します。SDKの場所は環境に合わせて指定します。

```powershell
cargo fetch --locked --manifest-path rust/Cargo.toml
cargo install wasm-bindgen-cli --version 0.2.128 --locked
.\build.ps1 -SdkRoot C:\Users\kit\emsdk
# UI・画像manifestだけの変更
.\build-ui.ps1
```

`wasm-bindgen` がPATHにない場合は `ROGUE_WASM_BINDGEN` で実行ファイルを指定します。JSとWasmのbindingは `tools/bind_browser.py` が対で生成します。

ローカル起動は作品外の開発用 [../tools/server.mjs](../tools/server.mjs) を使用します。本番の静的配信条件は [web/README](web/README.md)、試験コマンドと必要な比較buildは [tests/README](tests/README.md)、Playwrightの実行は [ブラウザー検証README](tests/browser-smoke/README-ja.md) を参照してください。

## ライセンス

原作・関連ソフトの著作権表示とライセンスは [ライセンス案内](docs/LICENSES-ja.md) を参照してください。案内から原文を確認し、通知一式のZIPを取得できます。
