# 日本語ブラウザ検証

対象はこのプロジェクトの実 C/Rust/Wasm ゲームです。テスト用のゲーム状態や画面を JavaScript で生成しません。実 Chrome/Brave、ローカルの Node サーバーと一時プロファイルで実行します。Playwright の起動経路を明示して選べます。

## 実行

プロジェクト直下で次のコマンドを実行します。

```powershell
node --test tests/browser-smoke/host.test.mjs tests/browser-smoke/localization.test.mjs
$env:ROGUE_PLAYWRIGHT_MODULE = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright'
$env:ROGUE_CHROME = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
node tests/browser-smoke/layout.mjs
$env:ROGUE_JA_SCENARIO='1'
node tests/browser-smoke/run.mjs
node tests/pixel-browser.mjs
```

`layout.mjs` は一体化した画面を Playwright と実 Brave/Chromium の headless・`--disable-gpu` で検証します。毎回新しいプロファイル・IndexedDB と空いている loopback ポートを使い、既存の保存とサーバーを操作しません。上の `ROGUE_PLAYWRIGHT_MODULE` と `ROGUE_CHROME` は既存パッケージ・実行ファイルの所在に合わせます。パッケージを指定すると、`run.mjs` と `pixel-browser.mjs` も Playwright の起動・CDPSession を使い、既存のシナリオとゲームの判定を保ちます。結果は [output/layout/evidence.json](output/layout/evidence.json)、PC・スマホ縦横・設定・全画面・保存復元の画面は同じフォルダーに出力します。

共有入力キュー、UTF8 一括送信、入力破棄、Worker の待機、ローカルサーバーの隔離ヘッダー、UI 翻訳 ID と引数、UTF8 バイト上限の静的・ホスト検証は 10 件成功しています。

## 表示と入力の契約

ゲームは Worker 内で同期実行し、ブラウザ側は DOM・Canvas・IndexedDB を担当します。表示言語の初期値は日本語で、新しいゲームを始める前に英語へ切り替えられます。Worker は `/locale.txt` へ選択言語を書きます。

原画面の `frame.cells` は論理回帰の観測用です。表示には文字領域を取り除いた ASCII の `frame.map_cells` と、Rust が翻訳した `frame.ui` を使います。日本語の状態・メッセージ・ヘルプ・一覧は DOM の文字列として描画し、一覧を縦スクロール・折り返しします。日本語の一覧画面では空の Canvas を隠し、ゲーム画面に戻ると表示します。

開始画面の名前は UTF8 で 49 バイト以内です。ゲーム内の名前編集と一般の文字入力は原 C の MAXINP に合わせて 50 バイト以内で、Rust の保存形式 v2 は 50 バイトの名前を保持します。ゲーム内の文字入力は `input-context` または `frame.ui.input` で示す専用フィールドを使い、確定時に Ctrl-U、Unicode スカラー列、Enter を一括送信します。IME の変換途中・通常のフォーム編集はゲームへ送りません。入力キューに全量を入れられなければ一部だけ送らず、画面に通知します。

文字入力途中の保存では未確定フィールドを Ctrl-U と文字列で C の入力途中状態へ反映し、Enter を送らず保存します。保存成功の通知は IndexedDB の書き込みトランザクション完了後です。復元したフレームの `ui.message` から直前の翻訳済みメッセージも表示します。

既定果物の編集は Root が提供する日本語の `input.placeholder` を表示し、初期入力値は空欄です。空欄の確定で原 C の既定値を保持するため、ホストで翻訳を推測して保存値を変えません。終了後の `{type:"presentation",ui:...}` はフレームを増やさず、既存 frame.ui の診断スナップショットと DOM だけを更新します。消費済みの Enter 待ち・確認文・More を消し、入力種別と読み上げ用の終了表示を揃えます。

HTML ラベルとホストの通知は `locales/ui-web-ja.json` と `locales/ui-web-en.json` の共通の意味 ID を使います。ゲーム表示の翻訳は Rust の責任です。`fallback_used` と `missing_ids` を監視し、日本語モードで翻訳漏れがあれば英語の本文を表示せず、日本語の通知と診断記録にします。例外の実装スタックは通常の通知へ表示しません。

## 画面統合後の実測記録

2026-10-07 の Brave 154.0.8037.98／Playwright／headless・`--disable-gpu` では、レイアウト 8 項目、日本語回帰 20 項目、Node pixels/tiles/host/catalog 19 項目が成功しました。設定内のキー・Tab の隔離、PC・スマホ縦横の地図タッチと設定スクロール、全表示と倍率、位置復帰、二つの全画面ボタンと Escape、通常保存の C/RNG 不変、新しい Worker での保存復元を確認しました。日本語の入力途中の保存復元・持ち物・設定・名前編集・原操作での終了スコアも成功し、翻訳 fallback・未登録 ID・Runtime 例外は 0 でした。

[レイアウト証拠](output/layout/evidence.json)と[日本語証拠](output-ja/evidence.json)に実行時刻・ブラウザー・JS/Wasm ハッシュ・画面を保存しています。ゲーム本体 JS/Wasm と保存形式は今回変更していません。

既存の厳密な pixel-browser RGBA 比較は 7 項目成功後に失敗しました。app・ゲーム・CSS を読み込まない既存 renderer/PNG だけでも最大 1 の色差を再現しています。[単独比較](output/layout/pixel-baseline.json)を残し、描画コード・画像・判定を変更していません。ヘルプの折り返しは[変更前との実測](output/layout/help-baseline.json)で幅 320px が必要と確認し、360px の全文・横はみ出し検査を維持して 320px で同じ厳密な折り返し判定を行います。

## 過去の実測記録

以下は 2026-10-02 の記録です。通常の証拠ファイルは再実行で更新されるため、現在の結果は上記を参照してください。

2026-10-02 11:32:56.913–11:33:02.347 UTC の承認済み Chrome 実行は最終ビルドで 19 項目成功しました。日本語の実名・状態・ヘルプの折り返し・メッセージ・アイテム名・元の選択キー・日本語入力途中の保存と新規 Worker 復元・論理 trace の一致、設定と日本語の名前変更、既定果物の日本語表示、原 Q/y/Enter 操作の終了後スコアと消費済みプロンプトの除去を確認しました。実行した画面では意味 ID の英語 fallback と未登録 UI ID がともに 0 で、ブラウザ Runtime 例外もありませんでした。

この実行の Wasm は 1,042,044 バイト、SHA256 は `d4e4f53f7e3b5c6e1a86c1fa185f41d172893afa3d269a101e10bbbd3ee2fb56` です。正確な JS/Wasm ハッシュとビルド情報は [evidence.json](output-ja/evidence.json) に記録しました。前段の 17 項目と表示後処理修正前の 19 項目の証拠は [stage17/evidence.json](output-ja/stage17/evidence.json)、[stage19/evidence.json](output-ja/stage19/evidence.json) に保持しています。

日本語の一覧画面で空 Canvas を隠し、ゲーム復帰時に再表示する動作も確認しました。50 回の描画更新で入力数と論理 trace は変化していません。

スクリーンショットは `output-ja/` に保存しました。ゲーム・ヘルプ上下・幅 360px の折り返し・持ち物・日本語入力前後・設定・名前変更・スコアの 10 枚と最終 browser.png を目視確認しました。各 JA 画像の寸法と SHA256 は evidence.ja_screenshots に記録し、日本語入力途中と復元後の画像は完全一致しています。IME は Chrome 内で composition/input イベントを発生させて検証しており、Windows の特定 IME 製品を手操作した検証ではありません。

墓碑・勝利に通常操作で到達する実 Chrome 検証はこのシナリオに含みません。それらの C/Rust 検証結果は別の資料を参照してください。ブラウザ UI の検証範囲を、ゲーム内すべての分岐の実行済み保証として扱わないでください。
