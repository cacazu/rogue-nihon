# 元祖Rogue 5.4.4 日本語Web版

取得済みのRRP Rogue 5.4.4を、CのゲームロジックとRustの表示・入力・プラットフォームの4層に分けたローカルWeb版です。ゲーム本文、品名・装備・怪物、状態欄、ヘルプ、設定、死亡・勝利・得点画面を意味IDとEN/JA JSONから表示します。初期表示言語は日本語です。マップの初期表示は画像版です。

## 起動と操作

このフォルダでPowerShellを開いて実行します。

```powershell
.\start.ps1
```

ブラウザで http://127.0.0.1:4173/ を開き、「新しく始める」を選びます。サーバーはloopbackだけに待受け、Workerの共有入力キューに必要なCOOP/COEPを付けます。終了はCtrl+Cです。

矢印または h j k l、斜めは y u b n で移動します。Shift＋方向で走り、. で待機、i で持ち物、? で操作一覧です。マウスは隣接マスを選びます。質問には表示された元のキーで答え、ヘルプ・選択・重要な確認の Space 操作は維持します。通常の戦闘メッセージはログへ流れ、Space は不要です。持ち物・ヘルプ等の長い一覧は日本語の文章パネルで折り返してスクロールできます。

名前や品物の命名は日本語と絵文字を受け付けます。開始時の名前はUTF-8で49バイトまで、原作の設定・命名エディターは50バイトまでです。BackspaceはUnicode文字単位で削除します。書記素クラスタ単位の編集ではないため、結合文字や複数文字の絵文字にはブラウザの入力欄を使ってください。通常のゲーム操作中にIMEの未確定入力を送信しません。

## ゲーム画面と設定

タイトル横のボタンでゲーム画面を全画面にできます。地図・状態・ログは一つの画面内にあり、左上のプレイヤー名の左にある設定ボタンから保存／再開、表示言語、表示方式、倍率スライダー、自分の位置へ戻る操作、全画面、新規ゲームを選びます。表示言語は従来どおり開始・再開前に選択します。設定中のキーはゲームへ送らず、Escape または背景クリックで設定を閉じます。

画面の下には版と GitHub の配布元・ライセンス案内へのリンクを表示します。[ライセンス案内](docs/LICENSES-ja.md)から必要な文書をまとめて取得できます。PC では方向ボタンを表示せず、キーボード操作を使います。スマホのタッチ用方向ボタンは保持します。PC は画面幅全体のゲーム枠を地図 80%・ログ 20% に分け、スマホは地図の下へログを置きます。持ち物・操作一覧・階段・確認／キャンセルの操作ボタン欄はスマホの地図右下だけに表示し、PC ではキーボードを使います。画面内の設計と入力境界は [Web の説明](web/README.md) に記載しています。

## 画像マップ

マップの49種類の表示IDを、太い輪郭のファンタジー調PNG46枚で表示します。画像／文字表示の切替、50〜200%の拡大、自分の位置へのセンタリング、全画面表示に対応します。スマホではマップ内をドラッグできます。表示設定はゲームのターン・乱数・保存形式へ影響しません。

[画像一覧](web/assets/tiles/contact-sheet.png)、[実装と検証](docs/GRAPHICS-ja.md)、[画像版の検証記録](graphics-verification.json)を参照してください。旧 verification.json は画像追加前の検証履歴です。

## 32×32ドット絵

「地図の表示」で **文字／イラスト／ドット絵** を選べます。ドット絵は新規生成した実寸32×32 PNG46枚で、100〜400%の整数倍表示に対応します。表示モードと倍率はこのブラウザに保存されます。直接開く場合は `http://127.0.0.1:4173/?view=pixels` です。

[ドット絵一覧](web/assets/pixels/contact-sheet.png)、[仕様と検証](docs/PIXELS-ja.md)、[ドット絵版の検証記録](pixel-verification.json)を参照してください。従来のイラスト・ゲーム本体・保存形式は保持しています。

## 翻訳と4層

| 層 | 主なファイル | 担当 |
|---|---|---|
| ロジック（C） | logic/core.c、元33C、knowledge.c、message.c、semantic.c、save_adapter.c | ターン・戦闘・生成・RNG・探索記憶、表示用意味情報の観測、論理保存 |
| 表示（Rust） | rust/src/display.rs、entities.rs、presentation.rs | 翻訳、数量・未鑑定の外見・装備状態、日本語の語順、画面とメッセージ履歴 |
| 入力（Rust） | rust/src/input.rs、lib.rsの入力callbacks | ブラウザイベントを原作キーに変換、明示的な文字エディターだけUTF-8化 |
| プラットフォーム（Rust） | rust/src/platform.rs、lib.rsの保存callbacks | 保存版・ソース・上限・checksum検証、checkpoint＋入力再生 |
| ブラウザAPI接続 | web/ | DOM・Canvas、Worker/SAB、IndexedDB、ローカルサーバー |

層の境界は contract/rogue_abi.h が正本です。Rust/JSの定数を同じheaderから生成します。CのWINDOW・THING・FILE・関数ポインターを境界へ公開しません。

locales/ は game（en.json/ja.json）、ui-game、entities、runtime、endings、ui-webの6系統です。未鑑定のアイテムにはゲームが既に表示した色・材質・表題を使い、隠れた効果や能力を翻訳のために参照しません。自由な命名は文字列として保持します。意味IDが欠ければfallback_used/missing_idsで記録し、検査では失敗扱いにします。

元のASCII知識画面と英語のMore判定はゲーム側に残します。日本語本文はUTF-8のDOM表示へ渡し、文字幅や折り返しからターン・RNGを動かしません。日本語画面のCanvasにはマップ用セルだけを描き、一覧表示中はCanvasを閉じます。再描画は最後のframeを使います。

## 保存と再開

「保存」はIndexedDBの書込み完了後に成功表示します。「保存から再開」は新しいWorkerでCのcheckpointと既に読んだ入力を再生します。持ち物選択、More待ち、日本語を入力している途中からも戻れます。入力途中の保存は草稿をCエディターへ反映して保存し、Enterによる確定は行いません。

日本語版のRust envelope v2は、CのRG4SAVEコンテナ、UTF-8の入力byte履歴、意味ID付きの表示・メッセージ履歴を保存します。旧Web envelope v1も構造を検証して読めますが、v1には当時の翻訳履歴がないため、過去メッセージの完全な日本語復元を保証しません。旧端末のsave形式とは別です。

保存は現在のoriginのIndexedDBに入ります。同じサーバーポートを使うと同じ保存枠へ戻れます。「保存を書き出す」は同じJSONをファイルとして保存します。得点画面はセッション内のものです。

## ビルドと検証

既存環境はRust 1.98.1、Emscripten 6.0.8、Node 24.19.0です。Rust targetは wasm32-unknown-emscripten、依存はCargo.lockで固定します。

```powershell
.\build.ps1 -SdkRoot C:\Users\kit\emsdk
.\tools\check-rust-layers.ps1
.\tools\check-rust-layers.ps1 -Binary entity-check
$env:ROGUE_JA_SCENARIO='1'
node tests/browser-smoke/run.mjs
```

ビルドは明示した38CとRustを使います。取得コードのconfigure/installスクリプトを実行しません。配布フォルダには build/game.js と game.wasm を含め、SDK・コンパイラーキャッシュは含めません。

実行した試験と対象SHA-256は verification.json、各raw結果、tests/browser-smoke/output-ja/evidence.json に記録します。構造と検証の限界は docs/IMPLEMENTATION-ja.md、日本語の組立ては docs/MESSAGES-ja.md と docs/ENTITIES-ja.md、ゲーム比較は tests/RESULTS-ja.md にあります。今回の試験が全seed・全展開の網羅であるとは主張しません。

## 出典と保護

原典はRRP Rogue 5.4.4です。取得URL・版・アーカイブのSHA-256と、Gitで管理する資料の範囲は [docs/PROVENANCE-ja.md](docs/PROVENANCE-ja.md) に記録しています。調査用の取得原本・アーカイブはローカル資料で、Web版の起動には不要です。Brogueは同じリポジトリの `brogue-nihon/` で保持します。

原著作権と3条項BSD形式の本文は logic/LICENSE.TXT にあります。依存とSDKの通知は THIRD-PARTY-NOTICES.md と licenses/ に残します。スマホ専用操作、ゲームパッド、永続ランキング、端末対応は今回の実装範囲に含めません。

Gitには起動用Wasm・JavaScriptとソースを含め、詳細トレース、画面画像、補助テストバイナリ、キャッシュ、配達manifestは含めません。verification.json とテスト説明資料は2026-10-02のローカル検証記録です。参照する詳細出力はローカル成果物に保持し、Gitのチェックアウト後は試験で再生成します。
