# Web のホスト

UIと入力の判断はRustに置きます。2026-10-10の全JS確認と移行範囲は [ブラウザーUIとRustの境界](../docs/UI-RUST-BOUNDARY-ja.md) に記録しています。`controller.rs` が開始・設定・終了・保存復元の状態とブラウザーAPIへの命令を管理し、`policies.rs` が入力検証・表示設定・履歴・翻訳、`browser_ui/tiles.rs` がタイルの検証と重ねる順序を担当します。JSは描画とAPI接続を行います。

C/Rust の Wasm をビルドした後、プロジェクト直下で実行します。

```powershell
node web/server.mjs 4173
```

`http://127.0.0.1:4173/` を開きます。サーバーは loopback のみで待機し、COOP same-origin と COEP require-corp を返して SharedArrayBuffer を有効にします。

同じフォルダのサーバーが既に起動している場合は、既存のURLを案内して正常終了します。既存サーバーは配信元フォルダのハッシュと隔離ヘッダーで識別します。識別ヘッダー追加前のサーバーは、入口HTML・サーバーソース・ビルド情報の一致も確認します。別のサーバーによるポート使用は明示し、ポートの自動変更やプロセスの終了は行いません。ブラウザーの保存枠を維持するため、別ポートでの起動は明示して指定します。

## Canvas のゲーム画面

トップ画面、マップ、状態、ログ、設定、ゲームウインドウ、ボタン、入力欄、フッターを、単一の可視 Canvas2D（#rogue-canvas）へ描きます。画面の組み立て・レイアウト・入力判定・フォーカス・スクロール・マップのcameraは `rogue-display` のRust部品が管理します。`canvas-ui.js` はRustの描画命令をCanvasへ表示し、文字幅の取得、DOMイベント、IME・pointer capture・全画面などのブラウザーAPIを接続します。

名前・シード・命名の編集には、透明なネイティブ input を使い、文字・選択範囲・カーソルは Canvas に描きます。IME、クリップボード、スマホのキーボードはブラウザ標準の入力機能を使います。読み上げ用HTMLと非表示のHTMLボタン・フォームは置きません。Canvasの操作から直接、開始・保存・設定・入力の関数を呼びます。

最初はトップ画面から、名前・シードの手動入力または各ランダムボタンで「はじめから」、保存済みデータの「ロード」を選びます。言語もトップで選び、Worker 実行中は変更しません。PC は左80%に地図、右20%にログを配置し、スマホは地図の下にログを配置します。Canvas の倍率は devicePixelRatio に合わせます。

ゲーム画面右上の設定ボタンから、保存・書き出し、文字／イラスト／ドット絵、倍率、自分の位置へ戻る、全画面、トップ画面へ戻る操作を選びます。その隣の全画面ボタンはPC・スマホとも直接使え、全画面中は解除アイコンになります。2つのボタンはHUDの枠の外に置き、全画面中もゲーム画面右上にあります。ゲームウインドウを開いた場合も上部に操作領域を確保します。設定のキーはゲームに送りません。Escape または背景クリックで閉じます。Tab は表示中の設定またはゲームウインドウの操作を巡回します。

### 再利用する UI / HUD 部品

`rust/crates/display/src/widgets.rs` の `Widgets` はパネル、折り返す文章、1行ラベル、ベクターアイコン、ボタン、入力欄、スクロールバーを提供します。CanvasやDOMには依存せず、描画命令と操作領域を同じ座標から作ります。`MeasureText` はホストのフォント計測関数で、文字の折り返し・省略・中央配置はRustが決めます。トップ・設定・ログ・ゲームウインドウは同じ部品を使用します。

`Widgets::control` は意味のあるIDとラベル、`Rect`、操作descriptor、`ControlStyle` を受け取ります。アイコン・無効状態・押下色・左揃え・スライダー等を共通化し、独自の内容は `custom` を指定して同じRust命令バッファへ追加できます。`TextStyle` と `LineStyle` が文字のスタイルを指定します。`single_line` は文字を折り返さず、必要なら末尾を省略します。アイコンの形状と中央配置もRustで定義します。

`browser_ui::hud::HudWidget` は独立して再利用できるRustのHUD部品です。`draw(&mut Widgets, HudData, MeasureText)` に名前、既存の `ui.status.args`、表示領域、横スクロール量、ラベル関数を渡すと、名前・地下階・所持金・体力・腕力・防御・レベル・経験値・空腹を左詰めの1行に配置します。階層は階段アイコンと負の階数（地下2階は−2）、腕力は💪で示します。元のCが渡す経験レベルと経験値はそれぞれ👑と☆で示し、`👑3=☆12` のように `=` でつなぎます。レベルと経験値の操作領域・ラベル・詳細は独立した項目です。設定ボタンは含めません。`draw_details` は正確な値の詳細を作ります。翻訳済み文章を分解せず、ブラウザーやゲームのWorkerを直接操作しません。

`browser_ui::BrowserUi` が画面を組み立て、押下・取消・ドラッグ・キー入力・IME変換中の判定を行い、ホストへ操作命令を返します。メインスレッド用の `rogue-browser-display` クレートはこの部品を `build/browser-ui.wasm` として公開します。入力待ちで停止するC用Workerとは別のWasmインスタンスであり、UIの再描画からゲームのターン・乱数を実行しません。`build.ps1` はゲーム用とUI用の両方をビルドし、UIだけの変更では `./build-ui.ps1` で更新できます。追加のRust依存はありません。

名前とステータスはPC・スマホとも折り返さず、項目間隔10pxで左端から詰めます。レベルと経験値の間だけは空白を詰めて `=` を表示します。HUDの文字は18〜20pxで縮小せず、狭い画面は横スワイプ・横スクロールで読みます。スクロール、押下取消、Tabでの項目の表示はRustが判断し、地図の移動やゲーム入力へ渡しません。大きい数値だけは `k`（千）・`m`（百万）・`b`（十億）で短縮します。ホバー、タップ、または Tab と Enter で項目名と正確な値を表示し、Escape または別の場所を選ぶと閉じます。空腹の警告は食事アイコンの色と印で示し、詳細で状態名を読めます。長い名前は1行で省略します。ログと持ち物は18px、ボタンと設定の説明は16px以上、入力は18pxです。

`node tests/browser-smoke/hud-widgets.mjs` がPlaywrightで実ゲームのPC・スマホ、日英、幅320/360/390/700/844/1240px、DPR 2、大きな数値、空腹4状態、詳細・設定・持ち物・待機操作を確認します。描画だけの操作でC状態・乱数・入力回数が変わらないこと、ステータス同士とタッチ操作が重ならないことも検査します。証拠とスクリーンショットは `tests/browser-smoke/output/hud-widgets/` に保存します。

地図の描画とクリックは同じ camera 座標を使います。マウスは隣接マスを選び、タッチドラッグは地図を移動します。タッチ方向・操作ボタンはスマホの横向きでも維持します。表示変更、スクロール、全画面、リサイズは最後のフレームを再描画し、C の look、command、Rust の保存再生を呼びません。

持ち物・ヘルプ・設定・検出・品物選択・文字入力・結果は、Rust/Bevy の descriptor に従う Canvas ウインドウです。背後に観測済みマップを保持します。持ち物一覧は閉じてもログへコピーしません。ログはゲーム・システムを区別して最大500件を保持し、末尾を読む間は追従、過去を読む間は位置を保持します。

`i` の持ち物はアイテムを選ぶと操作メニューを開きます。薬は飲む、巻物は読む、食料は食べる、武器・防具・指輪は装備状態に応じた操作、杖は使うを表示し、投げる・落とす・詳細・戻るも選べます。命名できる品物には命名操作を表示します。詳細に出すのは C が公開した情報だけで、未鑑定の効果・呪い・強化値は公開しません。項目選択・詳細・戻るはターンも乱数も消費しません。

操作を決めると Rust が元の C コマンドと対象キーを、対応する入力待ちで渡します。投げる方向はマップを表示したまま、スマホの普段の方向ボタン、PC の矢印・h j k l y u b n・Home/End/PageUp/PageDown で指定します。Shift/Ctrl 付きも同じ一方向を選び、方向入力ではプレイヤーを移動させません。方向待ちはオレンジ色の8方向とキャンセルだけを表示します。スマホのキャンセル、PC の Esc で取り消し、全画面でも先に投げる操作を取り消します。通常マップには移動・待機・持ち物・操作一覧を表示し、階段に乗っているときだけ階段ボタンを追加します。続ける・キャンセルを常設しません。杖の方向・着ける手・名前・識別の追加対象はゲームウインドウで選びます。C が失敗を返した場合や方向の取消後に、対象キーを次の移動へ持ち越しません。キーボードの q / w なども引き続き使用できます。状態別の表示条件と後続処理の確認範囲は [操作の調査](../docs/UI-COMMAND-AUDIT-ja.md) に記録しています。

版5.4.4は上部タイトルとブラウザーのタブ名に表示し、フッターから版の行を削除します。フッターはGitHub配布元、ライセンス案内へのリンクを描きます。案内は docs/LICENSES-ja.md、一括取得は distribution/rogue-5.4.4-licenses.zip です。

Rust 側は Bevy 0.19.1 の App/ECS を実行し、ゲームウインドウ・入力変換・表示フレーム・保存をシステムとして処理します。C が入力を待つタイミングに合わせて動きます。Bevy が生成したフレームを、ブラウザーの Canvas2D が描きます。`frame.engine` は版と描画バックエンドの診断情報です。

`app.js` はRustから受けた命令をWorker・IndexedDB・localStorage・crypto・全画面・Blobダウンロード等のブラウザーAPIに接続し、成功・失敗をRustへ報告します。UIの状態、入力の検証、操作の可否、保存完了の判断はRustの `Controller` が管理します。`worker.js` はゲームごとに Emscripten モジュールを新規作成し、Rustが指定した仮想ファイルを配置して `rg_run` を呼びます。既定言語は日本語で、開始前に英語を選べます。`abi.js` は `contract/rogue_abi.h` から生成した宣言だけで、通常ページとWorkerでは読み込みません。

主スレッドは raw event を `event-queue.js` の共有キューへ渡します。Atomics.wait で待機するのは Worker だけです。キューの容量は 2 の累乗で、uint32 カウンターの周回時も位置を保持します。Unicode 文字入力は一括で公開し、空きが足りなければ全体を拒否して通知します。元 C が行う typeahead flush は未消費 raw event だけを破棄し、消費済み入力の Rust journal は保持します。

## 表示ペイロード

`library.js` の Emscripten import は `js_rg_read_event`、`js_rg_flush_input`、`js_rg_present`、`js_rg_store`、`js_rg_outcome` です。present の UTF8 JSON は次のイベントを受け付けます。

| type | 表示上の意味 |
| --- | --- |
| frame | cells は原画面の回帰観測用。map_cells の地形・記号と ui の日本語状態・一覧・メッセージを Canvas へ表示する。 |
| message | 意味 ID、引数、翻訳済み text をメッセージ欄へ表示する。 |
| input-context | input.kind、limit_bytes、initial/current_text、placeholder に従い専用文字入力欄と進行待ちを更新する。 |
| presentation | 既存 frame.ui と Canvas の表示を更新する。raw frame や frameCount を増やさない。終了時の確認文・More・入力待ちを消す。 |
| trace | 診断用の論理 trace を保持する。通常プレイでは送らない。 |

日本語はCanvas2DのfillTextで描き、マップの固定1バイトセルへ詰めません。一覧はCanvasのゲーム内ウインドウで折り返し・縦スクロールし、地図領域を維持します。再描画と画面サイズ変更は最後のフレームだけを読み、ゲームへ入力を送りません。`ui.message` により、復元フレームだけでも直前の日本語メッセージを表示します。

ホストのラベル・ARIA・通知は `locales/ui-web-ja.json` と `ui-web-en.json` の共通意味 ID を使います。ゲームの翻訳は Rust が供給します。fallback_used/missing_ids を記録し、日本語モードの英語 fallback 本文を一般画面へ表示しません。例外の実装スタックは診断ログへ記録します。

## 入力と保存

開始名は UTF8 49 バイト以内、ゲーム内の文字入力と名前編集は原 C の MAXINP に従い 50 バイト以内です。IME の変換中とフォーム編集はゲームへ送らず、専用フィールドの確定時に Ctrl-U、Unicode scalar 列、Enter を一括送信します。既定果物は日本語 placeholder と空欄を使い、空欄確定で C の原既定値を保持します。マウスの地図クリックは隣接方向だけを入力します。

入力途中の保存は現在の文字列を Ctrl-U と Unicode 列で反映し、Enter を送らず保存します。Rust の保存形式 v2 をホストでは opaque bytes として扱い、IndexedDB の書き込み transaction 完了後に成功を表示します。保存ダウンロードは同じ JSON envelope を出力します。同じ保存スロットを使うにはサーバーのポートを固定します。

## 検証

現行Canvasの実ブラウザー検証は node tests/browser-smoke/canvas.mjs です。[試験説明](../tests/browser-smoke/README-ja.md)に手順・制限・結果を記載します。PlaywrightでCanvas上のボタン、入力、保存・ロード、終了、スマホを操作し、スクリーンショットも確認します。以下のDOMレイアウト用検証記録とコマンドはCanvas化前の履歴です。

保存の書き出しは `node tests/browser-smoke/save-export.mjs` でも確認します。PC・タッチ対応スマホ・日英で実ファイルを各2回書き出し、IndexedDBに保存したデータとのバイト単位の一致、書き出したファイルからの復元と次のターンを検査します。Windowsの制限付き検証環境でのキャンセルを避けるため、`tests/browser-smoke/browser-runtime.mjs` が実行ごとのプロファイル用一時フォルダーとダウンロード先を `.local/playwright/` に作ります。検査終了後にその実行の一時ファイルを片付けます。原因とChrome・Braveの結果は [保存書き出しの検証](../tests/browser-smoke/README-ja.md#保存の書き出しがキャンセルされる原因と修正2026-10-10) を参照してください。

2026-10-07 の最初の画面統合時の検証履歴は、実 Brave 154.0.8037.98 の headless・CPU 描画でレイアウト 8/8、日本語回帰 20/20、Node の pixels/tiles/host/catalog 19/19 が成功しました。通常保存は C/RNG とフレームを変えず、日本語入力途中の保存・新規 Worker 復元も論理状態と文字列が一致しています。日本語の fallback、未登録 ID、通常ブラウザーの Runtime 例外は 0 です。[レイアウト証拠](../tests/browser-smoke/output/layout/evidence.json)と[日本語回帰証拠](../tests/browser-smoke/output-ja/evidence.json)に実行時刻・実ファイルのハッシュ・画面を記録しています。この最初の画面統合ではゲーム本体 JS/Wasm は変更していません。

既存 `pixel-browser.mjs` は 7 項目成功後、32px→128px の厳密な RGBA 比較で失敗しました。app・ゲーム・CSS を読み込まない単独の既存 renderer/PNG でも最大 1 の色差を再現し、[独立した証拠](../tests/browser-smoke/output/layout/pixel-baseline.json)を保存しています。描画コード・画像・厳密な判定は変更していません。ヘルプは幅 360px で全文と横はみ出しを確認し、変更前・変更後とも実際に折り返す幅 320px で従来の厳密な折り返し判定を行います。[変更前との実測比較](../tests/browser-smoke/output/layout/help-baseline.json)も記録しています。

以下は 2026-10-02 当時の検証履歴です。通常の証拠ファイルはテスト実行で更新され、今回の結果は上記を参照します。

2026-10-02 11:32:56.913–11:33:02.347 UTC の実 Chrome 検証は 19/19 成功しました。host/catalog 検証は 10/10 成功。日本語名・状態・ヘルプ・アイテム・設定・終了スコア、一覧の折り返しと Canvas の復帰、IME 入力途中の保存復元と論理 trace 一致、既定果物の日本語表示、消費済み終了プロンプトの除去を確認しました。実行範囲の翻訳 fallback/未登録 UI ID は 0、ブラウザ例外はありません。

実行時の Wasm は 1,042,044 バイト、SHA256 `d4e4f53f7e3b5c6e1a86c1fa185f41d172893afa3d269a101e10bbbd3ee2fb56` です。[証拠](../tests/browser-smoke/output-ja/evidence.json)、[画面](../tests/browser-smoke/output-ja/browser.png)、[詳しい検証範囲](../tests/browser-smoke/README-ja.md) を保存しています。墓碑・勝利の実 Chrome 到達と Windows IME 製品の手操作はこのシナリオに含みません。

Browser API references: [Atomics.wait](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/wait), [IndexedDB transactions](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase).

追加変更の最終ローカル検証（2026-10-07）: 通常用・fixture 用の JS/Wasm を SDK で再ビルドしました。Node の入力・ログ・カタログ・戦闘・保存・原作比較 32/32、実 Brave のレイアウト 11/11、日本語導線 20/20、戦闘と再開 2/2 が成功しています。戦闘の実ブラウザ証拠は tests/browser-smoke/output/combat-log/evidence.json です。C 単体 4 群と Rust 層検証 123 項目も成功し、Rust の fmt と clippy が通過しました。親の最終確認待ちのため、この追加変更は未プッシュです。

通常メッセージは履歴へ流し、Space 待ちを行いません。C の look・RNG・ターン処理と、ヘルプ・道具・方向・終了確認の待機は維持します。Worker は /message-paging.txt でログ表示方式を指定します。保存 envelope の版と C checkpoint は維持し、既存 v2 の presentation.input に message_paging と必要な場合だけ message_paging_legacy_until を記録します。旧 v1/v2 の過去入力は従来の More 待ち込みで再生し、ロード後の新しい通常メッセージでは Space を要求しません。移行途中の再保存・再復元でも入力境界を保持します。

追加の再現検証: node --test tests/game-log-paging.test.mjs tests/game-regression.test.mjs、および node tests/browser-smoke/combat-log.mjs。原作比較は ROGUE_BASELINE_MODULE に原作ルールの fixture モジュールを指定します。

## ゲーム操作ウインドウ（2026-10-08）

持ち物・ヘルプ・ゲーム内設定・品物選択・方向指定・文字入力・発見一覧・記号確認・終了確認は、`rust/crates/display/src/game_window.rs` が作る表示データをゲーム画面内のウインドウへ描画します。マップは直前の観測済みセルとタイルを Rust が保持します。入力は `Rust ゲームウインドウ → Rust 入力 → C 本体 → Rust 表示` の順で処理し、品物ボタンも C が公開した descriptor と選択キーを使います。表示と入力待ちの同期、Space 待ちの Enter/Esc、入力欄の Esc、フォーカスとスクロールを確認します。

`node tests/browser-smoke/game-windows.mjs` で実 Playwright/Brave を起動し、隔離したブラウザーと loopback origin で実 C/Rust/Wasm を操作します。結果・現行ファイルの SHA-256・PC/スマホ/英語 ASCII のスクリーンショットは `tests/browser-smoke/output/windows/evidence.json` と同じフォルダーに保存します。持ち物表示中の保存・新しい Worker への復元、C の装備処理、入力待ちの取消、変更中にマップと Canvas の画素が保持されることを検査します。

一覧の最終画面の操作は「閉じる」。長い一覧の途中は「次のページ」、1行ずつの所持品は「次の品物」または「閉じる」、勝利画面は「結果を見る」。薬・巻物の検出マップは専用ウインドウ内で表示する。Space 待ちの呼び出し元と検証範囲は `../docs/SPACE-WAITS-ja.md` を参照。

ドット絵表示は `web/assets/pixels-v2/manifest.json` の新アセットを直接読み込みます。銀色の鎧のプレイヤー、地形、品物、26種類のモンスター、光線の49種類を46枚の32×32 PNGで描画し、32／64／96／128pxの整数倍率を使います。設定の「表示方法 → ドット絵」で選択でき、表示方法と倍率は従来の設定キーで保存します。アセットの表示・実ゲームとの接続・表示切替・クリック移動・スマホ・再読み込み後の設定保持は `node tests/browser-smoke/pixels-v2.mjs` で Playwright を使って確認します。

## 品物選択の整理（2026-10-08）

q / w / r / e / W / P / d / c / t / z / I の品物選択と、識別の巻物による対象選択は、候補を直接選ぶ形式に統一しました。候補が表示されているため、重複する「持ち物を表示（*）」ボタンを外し、補助操作は取消だけにしています。案内は「品物を選択。キー入力でも選べます。Esc：取消」です。

i の持ち物ウインドウ、I の選択後の品物確認、勝利時の精算一覧は維持します。キーボードの * は従来どおり C の一覧処理へ渡します。ヘルプ・発見一覧の「すべて表示」も維持します。

Playwright の item-selection.mjs で日本語PC・英語スマホの11操作（計22経路）、キーボード *、i、ヘルプ、発見一覧を確認し、実際の識別の巻物から対象をクリックして C の識別処理まで完了しました。画面も目視確認済みです。整理直前のビルドとの比較は、通常・幻覚状態の34ケース、129か所で乱数を含む全20項目の C 状態・入力位置・原文フレームが一致しました。証拠は tests/browser-smoke/output/item-selection/evidence.json と rng-evidence.json です。

## トップ画面（2026-10-08）

名前は従来どおり UTF-8 49 バイト以内、シードは0〜4294967295の整数です。個別の「ランダム」ボタンは browser crypto.getRandomValues で生成し、もう一方の入力を変更しません。C のゲーム用乱数は呼びません。トップの文字入力やキー操作はゲームキューへ渡しません。保存がない場合はロードを無効にし、保存の有無と入力エラーをトップで表示します。

設定の「トップ画面に戻る」は現在の Worker と入力キューを終了し、ゲーム画面・モーダル・入力欄を解除します。保存済みデータは保持します。未保存の進行は自動保存せず、必要な場合は戻る前に保存します。保存処理中は戻るボタンを無効にし、完了後に戻れます。ロードはトップの名前・シードと別に、既存の opaque な保存データから新しい Worker で再開します。

ゲームオーバー・勝利・スコアウインドウの「トップ画面に戻る」は、その時点の元の Space / Enter を Rust 入力経路へ順に渡し、C のスコア・精算処理と終了が完了してからトップへ戻ります。「スコアを見る」「終了する」などの従来ボタンも使えます。

node tests/browser-smoke/top-screen.mjs の Playwright/Chrome 検証は11項目成功しました。手動・ランダム開始、入力エラー、スマホと英語、保存・トップ復帰・ロード・再読み込み、死亡2種類と勝利の精算、終了後の復帰を確認しました。開始時と終了3経路の全20項目の C 状態・トレースは変更前の画面で同じ入力を行った結果と一致し、製品 JS/Wasm はトップ追加前とバイト単位で同一です。画面は目視確認済みです。証拠と画像は tests/browser-smoke/output/top-screen/ に保存します。
