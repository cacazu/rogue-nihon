# 元祖Rogue 5.4.4 日本語Web版

RRP Rogue 5.4.4のCルールを使う日本語Web版です。本文・品名・怪物・ヘルプ・設定・終了画面を日本語で表示し、文字・イラスト・32×32ドット絵の地図を選べます。

## 起動

このフォルダーでPowerShellを開いて実行します。

```powershell
.\start.ps1
```

[http://127.0.0.1:4173/](http://127.0.0.1:4173/) のトップで名前・シード・言語を選び、「はじめから」「前回の続き」を使います。同じ配信元が起動済みなら同じURLを案内します。別サーバーがポートを使っている場合は、明示的に `.\start.ps1 -Port 4174` などを指定します。停止は起動した端末でCtrl+Cです。

スマホでもトップ画面で名前・シード・言語を選べます。「前回の続き」はブラウザー内の自動保存から再開します。保存がない場合は「前回の続き」を無効にします。トップ右上は全画面ボタンだけです。開始直後から操作ボタンを表示します。

LANのスマホでは `.\start.ps1 -Lan` を実行し、同じLANから表示されたHTTPS URLを開きます。複数のネットワークがある場合は `-Address <PCのIPv4>` を指定します。証明書生成にはOpenSSLが必要で、ローカル証明書の接続許可をブラウザーで行います。

## 操作と保存

矢印またはh/j/k/l、斜めはy/u/b/nで移動、テンキー1〜9でも8方向移動（5は待機）、Shift＋方向で走行、`.` で待機、`i` で持ち物、`?` でヘルプです。PCはキーボードと画面の操作ボタン、スマホは画面の方向・操作ボタンを使います。地図のクリック・タップで、公開済みの経路を目的地まで自動移動します。操作入力・敵からの攻撃（回避を含む）・敵との衝突・罠で停止します。PCの確認・選択ウィンドウには選択キーを表示し、`a`・`b`・`c`…や表示されたEnter・Space・Escで操作できます。

右上の設定から全画面・操作ボタンの表示切替・表示方式・トップへの復帰・冒険の終了を選べます。地図はピンチとホイールで拡大縮小できます。スマホは地図の上に階層・所持金・レベル・HP・空腹度、地図の下にメッセージを表示します。ステータス欄をタップすると全ステータスを、メッセージ欄をタップすると履歴を開きます。表示言語と前回の続きはトップ画面で選びます。画面下の操作パッドから移動方式・持ち物・状況別操作・全体図・繰返しを使います。開始名はUTF-8で49 byte、ゲーム内の名前・命名は50 byteまでです。

階層を移動した時と、設定の「トップ画面に戻る」を選んだ時に自動保存します。トップへの移動は保存完了後に行い、保存失敗時はゲーム画面に残ります。死亡・冒険終了時とロード成功時には保存を破棄します。ロード後は次の階層移動かトップへの復帰で再び自動保存します。手動保存・保存ファイルの書き出し・ファイルからの再開はPC・スマホとも非表示です。

保存はブラウザーのoriginごとのIndexedDBへ入ります。ポートやブラウザーが変わると保存枠も変わります。入力途中の状態も保存でき、ロードは新しいWorkerで再開します。旧端末Rogueのsaveには対応しません。

## 実装資料

| 文書 | 内容 |
|---|---|
| [実装の判断と境界](docs/IMPLEMENTATION-ja.md) | 層の責務、ABI、実行順、checkpoint・保存、本番と検証 |
| [原作仕様とWeb版の対応](docs/ORIGINAL-SPEC-ja.md) | 原典、[原作のキーボード・コマンド一覧](docs/ORIGINAL-SPEC-ja.md#original-commands)、入力待ち・周期・乱数、意図した変更と比較基準 |
| [日本語化と意味データ](docs/LOCALIZATION-ja.md) | カタログ、原作データ表、descriptorの可視条件、UTF-8 |
| [地図表示と原作記号](docs/MAP-DISPLAY-ja.md) | 記号と画像ID、観測・足元・弾道、画像と表示設定 |
| [文書とライセンスの管理](docs/specifications/maintenance/DOCS-AND-LICENSES-ja.md) | 文書・cacheの保持、依存と通知の収録範囲、更新手順 |

## ビルドと検証

ゲーム用Rustのtargetは `wasm32-unknown-emscripten`、UI用は `wasm32-unknown-unknown`。ゲーム本体はCとRustをstandalone `game.wasm` へリンクし、ブラウザー用に `browser-ui.js / browser-ui.wasm` を生成します。依存はCargo.lockで固定し、Rust・Emscripten・NodeとCargo.lockに一致するUI用のwasm-bindgen-cliを使用します。SDKの場所は環境に合わせて指定します。原典比較や名称データの再生成には、`python tools/acquire-original.py` で固定版の原典を取得します。取得物は `upstream/` に保持し、通常のゲーム起動には不要です。

```powershell
cargo fetch --locked --manifest-path rust/Cargo.toml
cargo install wasm-bindgen-cli --version 0.2.128 --locked
.\build.ps1
# UI・画像manifestだけの変更
.\build-ui.ps1
```

`wasm-bindgen` がPATHにない場合は `ROGUE_WASM_BINDGEN` で実行ファイルを指定します。ブラウザーAPI用のJSとUI Wasmは `tools/bind_browser.py` が対で生成し、文字列の変換をRust codecへ接続します。ゲーム本体の起動・設定転送にはEmscriptenのJSランタイムを使いません。

ローカル起動は作品内の開発用 [tools/server.mjs](tools/server.mjs) を使用します。本番の静的配信条件は [web/README](web/README.md)、試験コマンドと必要な比較buildは [tests/README](tests/README.md)、Playwrightの実行は [ブラウザー検証README](tests/browser-smoke/README-ja.md) を参照してください。

## ライセンス

原作・関連ソフトの著作権表示とライセンスは [ライセンス案内](docs/LICENSES-ja.md) を参照してください。案内から原文を確認し、通知一式のZIPを取得できます。
