# 元祖Rogue 5.4.4 日本語Web版

取得済みのRRP Rogue 5.4.4を、CのゲームロジックとBevy 0.19.1を使うRustの表示・入力・プラットフォームの4層に分けたローカルWeb版です。ゲーム本文、品名・装備・怪物、状態欄、ヘルプ、設定、死亡・勝利・得点画面を意味IDとEN/JA JSONから表示します。初期表示言語は日本語です。トップ画面からゲーム内ウインドウまで、可視UIは単一のCanvas2Dへ描画します。マップの初期表示は画像版です。

## 起動と操作

このフォルダでPowerShellを開いて実行します。

```powershell
.\start.ps1
```

ブラウザで http://127.0.0.1:4173/ を開き、トップ画面で名前・シードを入力し、「はじめから」を選びます。名前とシードはそれぞれランダムに決めることもでき、保存からは「ロード」で再開します。通常起動はloopbackに待受け、Workerの共有入力キューに必要なCOOP/COEPを付けます。終了はCtrl+Cです。

同じRogueが起動済みなら、`start.ps1` は既存サーバーのURLを表示して正常終了します。サーバーを止めるには最初に起動した端末でCtrl+Cを押します。別のアプリや別フォルダのRogueが4173番を使っている場合は、使用中であることを表示します。そのアプリを終了するか、`.\start.ps1 -Port 4174` のように空いているポートを指定してください。ポートを変えるとブラウザーの保存枠も変わるため、自動では変更しません。

LAN内のスマホから遊ぶ場合は、`.\start.ps1 -Lan` を実行し、表示される `https://PCのLANアドレス:4173/` を同じLANのスマホで開きます。ネットワークが複数ある場合は `-Address 192.168.11.4` のようにPCのIPv4アドレスを指定します。HTTPS証明書の生成にはOpenSSL（Git for Windows同梱）が必要です。ローカル証明書の警告が出るため、自分のPCのアドレスであることを確認して接続を許可してください。鍵とログは公開されない `.local/` に置きます。スマホとPCのブラウザの保存枠は別です。

矢印または h j k l、斜めは y u b n で移動します。Shift＋方向で走り、. で待機、i で持ち物、? で操作一覧です。マウスは隣接マスを選びます。質問には表示された元のキーで答え、ヘルプ・選択・重要な確認の Space 操作は維持します。通常の戦闘メッセージはログへ流れ、Space は不要です。持ち物・ヘルプ等の長い一覧は日本語の文章パネルで折り返してスクロールできます。

名前や品物の命名は日本語と絵文字を受け付けます。開始時の名前はUTF-8で49バイトまで、原作の設定・命名エディターは50バイトまでです。BackspaceはUnicode文字単位で削除します。書記素クラスタ単位の編集ではないため、結合文字や複数文字の絵文字にはブラウザの入力欄を使ってください。通常のゲーム操作中にIMEの未確定入力を送信しません。

## ゲーム画面と設定

上部タイトルは「元祖 ROGUE · 5.4.4」です。設定ボタンはタイトル横に置き、名前・ステータスの欄には入れません。地図・状態・ログは一つの画面内にあり、設定から保存・書き出し、表示方式、倍率スライダー、自分の位置へ戻る操作、全画面、トップ画面に戻る操作を選びます。幅500px以上ではタイトル横からも全画面にできます。全画面中の設定ボタンはログ見出しの右にあります。名前・シード・ロード・表示言語はトップ画面にあります。設定中のキーはゲームへ送らず、Escape または背景クリックで設定を閉じます。

名前とステータスは左詰めの1行です。階層はF、腕力は💪で示し、経験値とLvは別の項目にします。HUDは18〜20px、ログ・持ち物は18px、設定・ボタンは16px以上で表示します。狭い画面ではHUDを横にスワイプまたは横スクロールして読めます。Tabで選ぶ項目も見える位置へ送ります。大きな数値は短縮し、タップやホバーで正確な値を確認できます。

画面の下には版と GitHub の配布元・ライセンス案内へのリンクを表示します。[ライセンス案内](docs/LICENSES-ja.md)から必要な文書をまとめて取得できます。PC では方向ボタンを表示せず、キーボード操作を使います。スマホのタッチ用方向ボタンは保持します。PC は画面幅全体のゲーム枠を地図 80%・ログ 20% に分け、スマホは地図の下へログを置きます。持ち物・操作一覧・階段・確認／キャンセルの操作ボタン欄はスマホの地図右下だけに表示し、PC ではキーボードを使います。画面内の設計と入力境界は [Web の説明](web/README.md) に記載しています。

## 画像マップ

マップの49種類の表示IDを、太い輪郭のファンタジー調PNG46枚で表示します。画像／文字表示の切替、50〜200%の拡大、自分の位置へのセンタリング、全画面表示に対応します。スマホではマップ内をドラッグできます。表示設定はゲームのターン・乱数・保存形式へ影響しません。

[画像一覧](web/assets/tiles/contact-sheet.png)、[実装と検証](docs/GRAPHICS-ja.md)を参照してください。過去の検証JSONと詳細出力は整理済みです。

## 32×32ドット絵

「地図の表示」で **文字／イラスト／ドット絵** を選べます。ドット絵は新規生成した実寸32×32 PNG46枚で、100〜400%の整数倍表示に対応します。表示モードと倍率はこのブラウザに保存されます。直接開く場合は `http://127.0.0.1:4173/?view=pixels` です。

[ドット絵一覧](web/assets/pixels/contact-sheet.png)、[仕様と検証](docs/PIXELS-ja.md)を参照してください。従来のイラスト・ゲーム本体・保存形式は保持しています。

## 翻訳と4層

| 層 | 主なファイル | 担当 |
|---|---|---|
| ロジック（C） | logic/core.c、元33C、knowledge.c、message.c、semantic.c、save_adapter.c | ターン・戦闘・生成・RNG・探索記憶、表示用意味情報の観測、論理保存 |
| 表示（rogue-display） | rust/crates/display/ | 翻訳、名称・ウインドウ・持ち物メニューの描画、メッセージ履歴、地図・足元・効果のフレーム生成とキャッシュ |
| 入力（rogue-input） | rust/crates/input/ | ブラウザイベントを原作キーへ変換、UTF-8文字編集、持ち物の選択状態と操作予約 |
| プラットフォーム（rogue-platform） | rust/crates/platform/ | 保存版・ソース・上限・checksum検証、checkpoint・入力履歴・再生状態・保存生成 |
| ブラウザAPI接続 | web/ | Canvas2D、透明な文字入力用HTML、Worker/SAB、IndexedDB、ローカルサーバー |

UI部品・HUD・トップ／設定／ログ／ゲームウインドウの配置・フォーカス・スクロール・マップのcamera・ブラウザー操作の判定は `rogue-display::widgets` と `rogue-display::browser_ui` のRust実装です。`rogue-browser-display` がメインスレッド用 `build/browser-ui.wasm` を提供し、JavaScriptのCanvas接続は描画命令の表示とブラウザーAPIを担当します。UIだけの変更は `./build-ui.ps1` で再ビルドできます。

Rust は実際の Bevy App と ECS でセッション・ウインドウ・マップを管理し、翻訳・入力変換・入力記録・フレーム生成・保存をシステムとして実行します。ゲーム操作は **Bevy/Rust ゲームウインドウ → Bevy/Rust 入力 → C 本体 → Bevy/Rust 表示 → Canvas** の順です。トップ・状態・ログ・設定・入力欄・ゲームウインドウもCanvasへ描きます。HTMLの入力欄は文字編集・IMEの受取りに使用します。Canvasの操作は直接関数を呼び、非表示のボタン・設定・ログは持ちません。

`rust/Cargo.toml` は Cargo workspace です。3層はそれぞれ独立したBevyクレートです。`rogue-display` の `RogueDisplayPlugin` が表示Resource・マップ/ウインドウComponentと描画System、`rogue-input` の `RogueInputPlugin` が入力Resourceとキー変換・確定入力反映System、`rogue-platform` の `RoguePlatformPlugin` がセッションResourceと入力journal・保存Systemを登録します。各クレートはBevy Appを使ってCのリンクなしで単体テストできます。既存の `rogue-layers` は C/JS FFI、Bevy Appの組立て、実行順序とクレート間の状態投影を担当します。入力は表示の公開descriptorを参照し、表示から入力への依存はありません。プラットフォームは表示・入力に依存しません。

層の境界は contract/rogue_abi.h が正本です。Rustの `rogue-contract`（rust/crates/contract/）のABI定数とJSの定数を同じheaderから生成します。共通のBevy SystemSetと確定入力のResourceも `rogue-contract` に定義します。CのWINDOW・THING・FILE・関数ポインターを境界へ公開しません。

locales/ は game（en.json/ja.json）、ui-game、entities、runtime、endings、ui-webの6系統です。未鑑定のアイテムにはゲームが既に表示した色・材質・表題を使い、隠れた効果や能力を翻訳のために参照しません。自由な命名は文字列として保持します。意味IDが欠ければfallback_used/missing_idsで記録し、検査では失敗扱いにします。

元のASCII知識画面と英語のMore判定はゲーム側に残します。日本語本文はRust/BevyのフレームからCanvas2Dの文字として描き、文字幅や折り返しからターン・RNGを動かしません。一覧表示中は直前のマップをウインドウの背後に保持します。再描画は最後のframeを使います。

## 保存と再開

「保存」はIndexedDBの書込み完了後に成功表示します。「保存から再開」は新しいWorkerでCのcheckpointと既に読んだ入力を再生します。持ち物選択、More待ち、日本語を入力している途中からも戻れます。入力途中の保存は草稿をCエディターへ反映して保存し、Enterによる確定は行いません。

日本語版のRust envelope v2は、CのRG4SAVEコンテナ、UTF-8の入力byte履歴、意味ID付きの表示・メッセージ履歴を保存します。旧Web envelope v1も構造を検証して読めますが、v1には当時の翻訳履歴がないため、過去メッセージの完全な日本語復元を保証しません。旧端末のsave形式とは別です。

保存は現在のoriginのIndexedDBに入ります。同じサーバーポートを使うと同じ保存枠へ戻れます。「保存を書き出す」は同じJSONをファイルとして保存します。得点画面はセッション内のものです。

## ビルドと検証

既存環境はRust 1.98.1、Emscripten 6.0.8、Node 24.19.0です。Rust targetは wasm32-unknown-emscripten、依存はCargo.lockで固定します。

```powershell
cargo fetch --locked --manifest-path rust/Cargo.toml # 初回に依存を取得
.\tools\run-clean.ps1 cargo test --offline --locked --manifest-path rust/Cargo.toml --workspace --exclude rogue-layers --lib
.\build.ps1 -SdkRoot C:\Users\kit\emsdk
.\tools\check-rust-layers.ps1
.\tools\check-rust-layers.ps1 -Binary entity-check
.\tools\check-rust-layers.ps1 -Binary engine-check
./build.ps1 -SdkRoot C:\Users\kit\emsdk -OutputName game-fixtures -TestFixtures -KeepArtifacts
node --test tests/production-boundary.test.mjs
node tests/browser-smoke/production-boundary.mjs
node tests/browser-smoke/canvas.mjs
```

ビルドは明示した38CとRustを使います。取得コードのconfigure/installスクリプトを実行しません。配布フォルダには `build/game.js`、`game.wasm`、`browser-ui.wasm` を含め、SDK・コンパイラーキャッシュは含めません。

ビルド、Rust検査、Cの補助検査、ブラウザー検証とゲーム回帰テストは、通常終了・例外終了のどちらでも、その実行が作った一時ファイルを自動で削除します。コンパイラーキャッシュ、テスト用バイナリ、ログ、結果JSON、画像、ブラウザープロファイルは実行ごとの `.local/tasks/` 内へ分け、他の実行や既存ファイルを削除しません。通常の `build.ps1` は、コンパイル成功後に `build/game.js`、`game.wasm`、`browser-ui.wasm`、`build-manifest.json` を配置して保持します。ソース、翻訳の編集入力、画像、ライセンス、LAN証明書も保持します。キャッシュは残さないため、次回ビルド時に再コンパイルします。

直接のCargo／Pythonコマンドも `.\tools\run-clean.ps1 <コマンド> <引数...>` で実行すると、終了時にコンパイラーキャッシュと一時領域を片付けます。保持が必要な比較用ビルドには `build.ps1 -OutputName game-fixtures -TestFixtures -KeepArtifacts`、PowerShellの検査には `-KeepArtifacts` を指定してください。Node／Pythonの検証結果を後で確認・集約する場合は、実行前に `$env:ROGUE_KEEP_ARTIFACTS='1'` を設定します。その場合だけ従来の出力先と一時領域を保持します。確認後は `Remove-Item Env:ROGUE_KEEP_ARTIFACTS` で通常の自動削除へ戻してください。

中断した登録済みの検証領域は、検証ツールまたは `./tools/artifact-registry.ps1 -Mode Recover -ProjectPath .` の明示的な実行で回収します。本番の起動・配信・通常ビルドでは回収ツールやプロセス列挙を呼びません。実行中の所有者・残存する子プロセス・保持指定・所有者不明・壊れた記録・照会不能・ジャンクションを含む領域は保持します。通常ビルドが自分で作った専用コンパイラー領域を終了時に閉じる処理は、他の実行を回収する処理と分離しています。テスト用JS入口・Wasm関数の分離と実際の独立性の確認は [本番と検証の境界](docs/PRODUCTION-BOUNDARY-ja.md) に記載します。

検証結果の保持を指定した場合、現行Canvas版のPlaywright結果と対象SHA-256は tests/browser-smoke/output/canvas/evidence.json へ、画像は同じフォルダーへ記録します。通常は実行専用の一時領域へ保存して終了時に削除します。2026-10-10の整理で過去の検証JSON、詳細出力、比較用ビルド、コンパイラーキャッシュを削除しました。fixtureや比較版を使う試験は、必要なビルドを再生成してから実行してください。構造と検証の限界は docs/IMPLEMENTATION-ja.md、日本語の組立ては docs/MESSAGES-ja.md と docs/ENTITIES-ja.md、ゲーム比較の過去の説明は tests/RESULTS-ja.md にあります。今回の試験が全seed・全展開の網羅であるとは主張しません。

## 出典と保護

原典はRRP Rogue 5.4.4です。取得URL・版・アーカイブのSHA-256と、Gitで管理する資料の範囲は [docs/PROVENANCE-ja.md](docs/PROVENANCE-ja.md) に記録しています。調査用の取得原本・アーカイブはローカル資料で、Web版の起動には不要です。Brogueは同じリポジトリの `brogue-nihon/` で保持します。

原著作権と3条項BSD形式の本文は logic/LICENSE.TXT にあります。依存とSDKの通知は THIRD-PARTY-NOTICES.md と licenses/ に残します。スマホ専用操作、ゲームパッド、永続ランキング、端末対応は今回の実装範囲に含めません。

Gitには起動用Wasm・JavaScriptとソースを含め、詳細トレース、画面画像、補助テストバイナリ、キャッシュ、配達manifestは含めません。テスト説明資料には実行当時の結果と制約を残し、詳細出力は必要な試験を実行して再生成します。
