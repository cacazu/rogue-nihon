# 元祖Rogue 5.4.4 日本語Web版

RRP Rogue 5.4.4のCルールを使う日本語Web版です。本文・品名・怪物・ヘルプ・設定・終了画面を日本語で表示し、文字・イラスト・32×32ドット絵の地図を選べます。

## 起動

このフォルダーでPowerShellを開いて実行します。

```powershell
.\start.ps1
```

[http://127.0.0.1:4173/](http://127.0.0.1:4173/) のトップで名前・シード・言語を選び、「はじめから」または「ロード」を使います。同じ配信元が起動済みなら同じURLを案内します。別サーバーがポートを使っている場合は、明示的に `.\start.ps1 -Port 4174` などを指定します。停止は起動した端末でCtrl+Cです。

LANのスマホでは `.\start.ps1 -Lan` を実行し、同じLANから表示されたHTTPS URLを開きます。複数のネットワークがある場合は `-Address <PCのIPv4>` を指定します。証明書生成にはOpenSSLが必要で、ローカル証明書の接続許可をブラウザーで行います。

## 操作と保存

矢印またはh/j/k/l、斜めはy/u/b/nで移動、Shift＋方向で走行、`.` で待機、`i` で持ち物、`?` でヘルプです。PCはキーボード、スマホは画面の方向・操作ボタンを使います。マップの隣接クリックでも移動できます。

右上の設定から保存・書き出し、表示方式と倍率、自分の位置へのセンタリング、トップへの復帰を選べます。通常メッセージはログへ流れ、一覧・選択・結果はウインドウで操作します。開始名はUTF-8で49 byte、ゲーム内の名前・命名は50 byteまでです。

保存はブラウザーのoriginごとのIndexedDBへ入ります。ポートやブラウザーが変わると保存枠も変わります。入力途中も保存でき、ロードは新しいWorkerで再開します。トップへ戻る前に必要な進行を保存してください。旧端末Rogueのsaveには対応しません。

## 実装資料

| 文書 | 内容 |
|---|---|
| [実装の判断と境界](docs/IMPLEMENTATION-ja.md) | 層の責務、ABI、実行順、checkpoint・保存、本番と検証 |
| [原作仕様とWeb版の対応](docs/ORIGINAL-SPEC-ja.md) | 原典、コマンド・入力待ち・周期・乱数、意図した変更と比較基準 |
| [日本語化と意味データ](docs/LOCALIZATION-ja.md) | カタログ、原作データ表、descriptorの可視条件、UTF-8 |
| [地図表示と原作記号](docs/MAP-DISPLAY-ja.md) | 記号と画像ID、観測・足元・弾道、画像と表示設定 |

## ビルドと検証

ゲーム用Rustのtargetは `wasm32-unknown-emscripten`、UI用は `wasm32-unknown-unknown`。依存はCargo.lockで固定し、Rust・Emscripten・Nodeを使用します。SDKの場所は環境に合わせて指定します。

```powershell
cargo fetch --locked --manifest-path rust/Cargo.toml
.\build.ps1 -SdkRoot C:\Users\kit\emsdk
# UI・画像manifestだけの変更
.\build-ui.ps1
```

ローカル起動は作品外の開発用 [../tools/server.mjs](../tools/server.mjs) を使用します。本番の静的配信条件は [web/README](web/README.md)、試験コマンドと必要な比較buildは [tests/README](tests/README.md)、Playwrightの実行は [ブラウザー検証README](tests/browser-smoke/README-ja.md) を参照してください。

## ライセンス

原作・関連ソフトの著作権表示とライセンスは [ライセンス案内](docs/LICENSES-ja.md) を参照してください。案内から原文を確認し、通知一式のZIPを取得できます。
