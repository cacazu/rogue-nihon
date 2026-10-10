# 日本語ブラウザ検証

## 名前とステータスの左詰め1行表示・文字の拡大（2026-10-10）

名前と8項目のステータスを同じ1行に左詰めで配置し、設定ボタンはタイトル横へ移しました。階層はF、腕力は💪、経験値とLvは別項目です。上部タイトルとタブ名は「元祖 ROGUE · 5.4.4」で、下部の版表示を削除しました。HUDは18〜20px、ログ・持ち物は18px、入力は18px、設定・ボタンは16px以上です。狭い画面では文字を縮めず、同じ行を横に送ります。スクロールとフォーカスの判断はRustが行います。

最終UIビルドのPlaywright/Chromeで `hud-widgets.mjs` 27件、`canvas.mjs` 31件、`save-export.mjs` 6件、`production-boundary.mjs` 10件が成功しました。PC・スマホ縦横・日英・幅320〜1240px・DPR 2で、左端から一定間隔に並ぶこと、名前とステータスが同じ行にあること、設定ボタンがHUD外にあること、F/💪と経験値・レベルの独立表示、上部タイトルと下部の版表示削除、文字サイズを確認しました。横スワイプ・スクロール・Tab移動・詳細・設定・全画面では地図・C状態・ターン・乱数・入力回数が変化しません。

保存・実ファイル書き出し・新しいWorkerへの復元と次のターン、通常ゲーム操作と終了、開発用ファイルのない配置と壊れた回収ツールを置いた配置での起動も確認しました。PC・スマホのHUD、上部タイトル、トップ画面、設定、全画面のスクリーンショットは目視確認済みで、ブラウザー例外は0です。スマホはPlaywrightのエミュレーションです。過去のCanvas移行前のWasmアーカイブとの比較は、既存アーカイブがないため行っていません。

Rustの表示14件とController8件が成功し、Clippy・Rust書式・JS構文・差分検査も通過しました。NodeのJS境界・実UI Wasm・転送・本番境界14件も成功しました。保持した結果は `output/hud-widgets/`、`output/canvas/`、`output/save-export/chrome/`、`output/production-boundary/` にあります。

## 起動済みサーバーとポート競合（2026-10-10）

`node tests/browser-smoke/startup.mjs` の12項目が成功しました。実Node起動と `start.ps1` の再実行、同じURLの維持、別アプリ・別フォルダのRogue・応答しないサーバーとの競合、識別ヘッダーのない既存サーバーの製品ファイル確認、異なるビルドの拒否、証明書付きHTTPSの再実行を確認します。競合しているプロセスは終了せず、ポートも自動変更しません。

Playwright/ChromeでHTTPSの隔離済みページ、PCとタッチ対応スマホのゲーム開始・ターン進行・保存・起動コマンドの再実行・再読み込み後のロードと次のターンを確認しました。ブラウザー例外は0で、PC・スマホのスクリーンショットも目視確認しました。スマホはエミュレーションです。結果の保存先は `output/startup/` です。

修正後の `production-boundary.mjs` も10項目成功し、開発用ファイルのない配置と壊れた回収ツールを置いた配置で起動・表示・操作・保存・実書き出し・再開が動作しました。Nodeのホスト・本番境界検査12項目とJS構文・差分検査も通過しました。

## 本番起動と検証・回収の分離（2026-10-10）

全本番JS、起動・配信、C/Rustと通常ビルドを監査し、サーバーの回収ツール依存、本番JSのテスト用操作窓口、旧タイル検査用の接続、通常Wasmの回帰専用関数を分離しました。通常ビルドの作業領域も回収レジストリーがなくても作成・終了できます。[監査範囲と構造](../../docs/PRODUCTION-BOUNDARY-ja.md)に詳細を記載します。

`production-boundary.mjs` はPlaywrightで開発用ファイルのない配置と、壊れた回収ツールを置いた配置を実際に起動し、PC・スマホの表示、開始、ターン、持ち物、設定、保存、実書き出し、再読み込み後の復元と次のターンの10件が成功しました。中断した一時ファイルも変化しません。テスト窓口のない通常ページとスクリーンショットも確認しました。再ビルドした本番で `canvas.mjs` 31件、`hud-widgets.mjs` 22件、`save-export.mjs` 6件も成功し、合計69件・ブラウザー例外0です。

依存と実Wasmの検査5件、既存Nodeの転送・履歴・翻訳・タイル・保存回帰と一時領域終了の検査も成功しました。通常/テストfeature両方のClippyとfmt・JS構文検査が通過しました。旧独立ビルドとの比較1件はアーカイブ指定がないためskipです。

## 残存JS処理のRust移行（2026-10-10）

本番JS全8ファイルとHTMLを確認し、開始・終了・保存復元・操作可否・フォーカス・IME制限・UTF-8検証・設定値補正・翻訳・履歴分類・フレーム検証・タイル合成をRustへ移しました。[移行先と全JSの境界](../../docs/UI-RUST-BOUNDARY-ja.md)に対象を記録しています。`localization.js`、`view-settings.js`、`game-log.js` は削除しました。

移行後のPlaywright/Chromeで `canvas.mjs` 31/31、`hud-widgets.mjs` 22/22、`save-export.mjs` 6/6が成功しました。スクリーンショットでPC・スマホの一行HUD・アイコン・設定・保存画面を確認し、ブラウザー例外は0です。書き出した実ファイル6個の内容はIndexedDBと一致し、新規Workerへの復元と次のターンも成功しました。C/RNGと入力回数の不変性も確認しています。

RustのController 8件とDisplay 13件、Nodeの境界・実UI Wasm・履歴・転送・タイル・ピクセル・カタログ24件が成功しました。Rust fmt、Clippy（警告をエラーとして扱う）、JS構文検査も通過しました。HUD試験の値の差し替えはテスト内の `addInitScript` でWorkerのpresentationを送る方式で、本番の状態を書き換える処理やfixture分岐を追加しません。過去のWasmアーカイブ比較とWindows実IMEの手動操作は今回の自動化の対象外です。

## UI / HUD の Rust 化（2026-10-10）

UI共通部品は `rust/crates/display/src/widgets.rs`、再利用するHUDは `browser_ui/hud.rs`、画面構成と操作判定は `browser_ui/screens.rs` / `interaction.rs` へ移しました。`rogue-browser-display` の `build/browser-ui.wasm` がメインスレッドで動き、`canvas-ui.js` は描画命令とブラウザーAPIを接続します。旧JavaScriptの部品とHUDは削除しました。Rustの画面診断には `uiOwner: "rust"` を記録し、HUD検査でも確認します。

Playwright/Chromeで `canvas.mjs` 31/31、`hud-widgets.mjs` 22/22、`save-export.mjs` 6/6が成功しました。開始・名前/シード編集・全画面・設定・表示3方式・倍率・地図クリック/タッチドラッグ・持ち物/品物選択/検出/識別・ヘルプ/発見・IME入力途中の保存復元・死亡/勝利/トップ復帰を含みます。書き出しはPC/モバイル・日英で実ファイルを計6回保存し、IndexedDBの保存データとバイト単位で一致し、新しいWorkerへ復元して次のターンまで動作しました。ブラウザー例外は0です。

PC・スマホ縦横・HUD・設定・ウインドウのスクリーンショットも確認しました。スマホはPlaywrightのモバイル/タッチエミュレーションです。以前のCanvas移行前の比較用アーカイブは既存の整理で削除されているため、今回の総合検証ではそのアーカイブとの比較は実行していません。UI操作中のC状態・乱数・入力回数の不変と、保存復元前後の一致は実際に検査しています。

Rust表示層は13/13の単体テスト、clippyは警告をエラーにして通過しました。HUDをブラウザー画面なしで呼ぶ再利用、押下取消、IME変換中、キーの修飾フラグ、設定を開いてから次の再描画までの入力遮断を含みます。Nodeのホスト/翻訳検査13/13も成功しました。検証の保存先は `output/canvas/`、`output/hud-widgets/`、`output/save-export/chrome/` です。検証結果を保持するときは `ROGUE_KEEP_ARTIFACTS=1` を指定します。

通常の実行は、結果JSON・画像・ログ・ブラウザープロファイルを実行専用の `.local/tasks/` 内へ保存し、成功・例外終了のどちらでも終了時に削除します。結果を目視確認・集約する場合だけ `$env:ROGUE_KEEP_ARTIFACTS='1'` を設定すると、以下に記載した従来の出力先へ保持します。確認後は `Remove-Item Env:ROGUE_KEEP_ARTIFACTS` で自動削除に戻してください。fixtureビルドを後続の検証で使う場合は `build.ps1` に `-KeepArtifacts` を指定します。

中断した登録済みの一時領域は、検証ツールまたは手動の `./tools/artifact-registry.ps1 -Mode Recover -ProjectPath .` で回収します。ゲームの起動・配信・通常ビルドから回収処理は呼びません。実行中の領域・保持指定・所有者不明・ジャンクションを含む領域は保持します。回収の検証は `node --test tests/artifact-recovery.test.mjs`、本番からの独立性は `node tests/browser-smoke/production-boundary.mjs` で確認できます。

2026-10-10の整理で過去の `output/`、`output-ja/` 内の検証結果、画像、動画、一時プロファイル、比較用コピーを削除しました。この文書の結果は実行当時の記録で、出力リンクは再実行時の保存先です。現在のビルドの確認には各スクリプトを再実行してください。fixtureを使う検査にはテスト用ビルドの再生成が必要です。

## 保存の書き出しがキャンセルされる原因と修正（2026-10-10）

今回の `download.path: canceled` は、Windowsの制限付き検証環境が提供する既定の一時フォルダーで、Chromeのプロファイル内のファイル名変更がアクセス拒否になるために起きました。製品と同じJSON Blob、バイナリBlob、HTTP添付ファイルがすべてキャンセルされ、Chromeのログには `Could not rename file: Access denied` が残っています。ダウンロード先だけをプロジェクト内へ変更しても失敗し、検証プロセスの `TEMP` / `TMP` もプロジェクト内へ変更すると、同じ3経路が成功しました。制限付き検証環境の外で実行した比較でも3経路とも成功しています。

`browser-runtime.mjs` が `.local/playwright/run-*` に実行ごとの一時フォルダーとダウンロード先を作り、Playwrightの起動前に検証プロセスの一時フォルダーを設定します。終了時には環境変数を戻し、削除するパスがプロジェクト内の専用領域にあることを検査して、その実行のファイルだけを片付けます。`canvas.mjs`、`context-controls.mjs`、`save-export.mjs` はこの共通処理を使用します。ゲームの書き出し処理・保存形式はそのままで、書き出し検査の省略やダウンロードの代替処理はありません。

`node tests/browser-smoke/save-export.mjs` はChromeで6/6項目、`ROGUE_CHROME` にBraveを指定した実行でも6/6項目成功しました。日本語PC、日本語スマホ、英語スマホで各2回、合計12回の実ファイル書き出しを確認しました。ファイル名、保存済みのIndexedDBデータとのバイト単位の一致、書き出しでC状態・乱数・入力回数が変わらないことを検査しています。ファイルから読んだ保存データを新しいWorkerへ復元し、持ち物とC状態が復帰して次のターンを実行できることも確認しました。スマホはPlaywrightのタッチ対応エミュレーションです。

省略なしの `node tests/browser-smoke/canvas.mjs` は31/31成功し、実際の76,003バイトの `rogue-save.json` を [書き出しファイル](output/canvas/exported-save.json) として保存しています。スマホの設定・保存・書き出し・全画面・トップ復帰・ロードは `ROGUE_CONTEXT_FILTER='^Settings'` の `context-controls.mjs` でも成功しました。ブラウザー例外は0件で、設定画面のスクリーンショットも目視確認済みです。

証拠は [Chrome](output/save-export/chrome/evidence.json)、[Brave](output/save-export/brave/evidence.json)、[総合確認](output/canvas/evidence.json)、[スマホ設定経路](output/context-controls/chrome-focused/evidence.json) にあります。初回の再現結果とChromeのログは `output/save-export/probe.json` と `chrome-download.log`、一時フォルダーを変更した比較は `output/save-export/workspace-temp/`、制限環境外の比較は `output/save-export/outside-terminal-sandbox/` です。`save-export-probe.mjs` で診断を再実行でき、`ROGUE_PROBE_LOCAL_TEMP=1` を指定するとプロジェクト内の一時フォルダーを使用します。

参考: [Nodeの一時フォルダー](https://nodejs.org/api/os.html#ostmpdir)、[Playwrightのダウンロード](https://playwright.dev/docs/downloads)。

## UI / HUD 部品とステータス1行表示（2026-10-10）

`node tests/browser-smoke/hud-widgets.mjs` はPlaywright/Chromeで22項目成功しました。実ゲームの日英、PC幅1240/700px、タッチ対応の幅320/360/390pxと横向き844×390px、DPR 2で、アイコンと数値が1行に収まり、設定・閉じるアイコンがボタン中央に来ることを確認しました。長い名前、大きな数値、空腹4状態、詳細のマウス・タップ・Tab/Enter・Escape、持ち物と待機操作を含みます。短縮した値の詳細には正確な値を表示し、HUDと詳細が方向・操作ボタンに重ならないことも検査します。詳細・設定・リサイズではC状態・乱数・入力回数が変化しません。

結果・変更ファイルのSHA-256と30枚のスクリーンショットは [HUD証拠](output/hud-widgets/evidence.json) に保存しました。PC・スマホ縦横・設定・詳細・大きな数値の画面は目視でも確認しています。スマホはPlaywrightによるモバイル・タッチの再現で、実機の手操作ではありません。

初回の `canvas.mjs` はChrome/Braveとも15項目成功後、保存を書き出す際の `download.path: canceled` で停止しました。その時点ではダウンロードだけを分離した一時ランナーで31項目を確認し、[履歴の証拠](output/canvas-widgets-regression/evidence.json) に `partial` を記録しました。同日の追加調査で検証用の一時フォルダーが原因と分かり、上記の修正後は書き出しを含めた [総合確認](output/canvas/evidence.json) が31/31成功しています。

Nodeのカタログ・入力キュー・ホスト・ログ検査は17/17成功しました。共通部品の使い方は [Webの説明](../../web/README.md#再利用する-ui--hud-部品) を参照してください。

## ニンフの盗難後に停止する問題（2026-10-09）

固定シード17の地下14階で、ニンフが複数個の手裏剣から1個を盗む際、残りのスタックが持ち物リストに残ったまま解放され、自動保存が停止する問題を修正した。盗まれる1個を `leave_pack(steal, TRUE, FALSE)` で分離してから破棄する。乱数の呼び出しは変更していない。

Playwright/Chrome で通常製品のセーブから同じ81入力を再現し、修正前は停止、修正後は手裏剣13個の持ち物表示・通常保存・次のターンまで成功した。盗難直前までの80入力は乱数を含む全トレースが修正前と一致した。証拠と画面は `output/fixed-seed-17-clear/crash-nymph/`、前後のWasmハッシュと検証結果は同フォルダーの親にある `bugfix-audit.json` に保存している。動画は生成していない。

継続的な回帰確認は fixture 版をビルドして `node --test tests/nymph-theft.test.mjs` を実行する。実際のニンフの攻撃・盗難・残り個数の表示・保存・別モジュールでの復元と次のターンを確認する。fixture は製品ビルドに含めない。

## 固定シード攻略で発見した不具合の修正（2026-10-08）

シード17の攻略中に発見した次の不具合を修正しました。

- 種類別の鑑定の巻物を読んだ後、対象がなくても空の選択画面に閉じ込められる問題。対象がないときは通知してマップへ戻り、対象があるときもキャンセルまたは Esc で閉じられます。巻物は読んだ時点で消費されます。対象なしの終了は、元の C で `*` により空の一覧から戻った場合と同じターン・乱数になります。
- 空腹、解呪、該当する持ち物がない通知などの日本語が翻訳エラーになる問題。複数行の C メッセージ呼び出しについて、マクロ開始位置と終了位置の両方から ID と引数数を引けるようにしました。鑑定対象の種類名も日本語で表示します。
- 使用後の任意の命名欄に、最後に一覧表示した別の品物名が入る問題。新しい命名は空欄から始まり、空欄の確定と Esc は名前を登録しません。明示した名前、命名途中の保存・復元は維持します。
- 死亡ウインドウの背景に生存時の HP・所持金が残る問題。表示へ HP 0 と死亡時の所持金を渡し、元の C の体力・減額・得点計算は変更しません。

`node tests/browser-smoke/playthrough-fixes.mjs` は Chrome と Brave でそれぞれ33項目成功しました。PC とスマホ表示で、5種類の鑑定対象なし、鑑定のキャンセル・誤選択後の再選択、任意の命名3経路、日英の通知、実戦での死亡と墓なしの死亡、スコアからトップへの復帰、通常製品版の開始・持ち物・移動を検証しています。命名の草稿保存・ロードも確認しました。各ブラウザーで22件の修正前 C 比較を行い、指定した入力区間の全20状態値（乱数を含む）が一致しました。対象なしの鑑定だけは、旧版の余分な `*` 入力を省くため、終了後の状態を旧版の `*` 経路と比較しています。

結果とスクリーンショットは [Chrome](output/playthrough-fixes/chrome/evidence.json)、[Brave](output/playthrough-fixes/brave/evidence.json) に保存しています。命名欄、鑑定、通知、死亡、トップ復帰の Canvas 画像も目視で確認しました。スマホは Playwright のタッチ対応モバイル表示による検証で、実機の手操作ではありません。

既存の `inventory-actions.mjs` も Chrome で158項目成功しました。元のヘルプ表にある63コマンドを方向・品物・命名・確認などの後続入力まで実行し、持ち物操作、8方向の投擲と杖、旧一覧セーブ3形式、現在の保存・ロード、Shift/Ctrl の移動、回数指定、終了後のスコアまで確認しました。[全コマンドの記録](output/inventory-actions/chrome/evidence.json) に156件の入力列と各チェックポイントの比較結果を保存しています。

この広域比較には、修正直前の C ソースをそのまま残し、生成済みのメッセージ位置表だけを再生成した独立ビルドを用いました。旧版の `@` は複数行呼び出しの引数を認識せず、C の英語画面に `%d` などをそのまま残していたためです。修正版は数値を表示するので、その画面ハッシュの差は意図した修正です。比較値をマスクせず、位置表だけを修正した参照版との全20状態値・乱数・入力位置を厳密に比較します。旧一覧セーブの検証には元の `inventory-before.js` を使用します。

`node tests/playthrough-reference-audit.mjs` で、独立参照版のソース差が `message_catalog.inc` だけであること、`@` の修正前後で乱数を含む残り19状態値とメッセージ行以外の C 画面が一致することを検証しました。修正前の対象なし鑑定・対象あり鑑定・使用後命名のセーブを読み込み、その後の移動まで実行しています。[参照版・旧セーブの監査記録](output/playthrough-fixes/reference-audit.json) を参照してください。乱数生成や戦闘・アイテム効果の実装は変更していません。上記の比較結果は検証した入力区間についてのものです。

再実行の入口は次のとおりです。修正直前のソースは `output/playthrough-fixes/before/logic`、元の通常版 JS/Wasm は同じ `before` フォルダーへ保存しています。旧版比較のモジュールと記録はこの作業環境の保存物です。

```powershell
.\build.ps1
.\build.ps1 -SkipRust -SkipCatalogGeneration -TestFixtures -OutputName game-fixtures -KeepArtifacts
node tests/browser-smoke/playthrough-fixes.mjs
$env:ROGUE_CHROME = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'
node tests/browser-smoke/playthrough-fixes.mjs
Remove-Item Env:ROGUE_CHROME
$env:ROGUE_INVENTORY_REFERENCE = (Resolve-Path 'build/playthrough-catalog-reference.js').Path
node tests/browser-smoke/inventory-actions.mjs
node tests/playthrough-reference-audit.mjs
```

独立参照版は保存済みの `before/logic` を `catalog-reference/logic` にコピーし、現行 `locales/en.json` を `catalog-reference/locales/en.json` に置いてから、次のコマンドで生成・ビルドします。元の修正前ビルド `playthrough-before.js` は上書きしません。

```powershell
& 'C:/Users/kit/emsdk/python/3.13.3_64bit/python.exe' tools/generate_catalog.py --root tests/browser-smoke/output/playthrough-fixes/catalog-reference
.\build.ps1 -SkipRust -SkipCatalogGeneration -TestFixtures -OutputName playthrough-catalog-reference -LogicDirectory tests/browser-smoke/output/playthrough-fixes/catalog-reference/logic -KeepArtifacts
```

Node の関連検証46項目と、変更前の通常版・8固定シードによる追加比較1項目、カタログ生成の Python 5項目も成功しました。配信中の `https://192.168.11.4:4173/` に対する Playwright 検証は8項目成功し、配信 JS/Wasm が今回の製品ビルドと一致すること、スマホ表示での開始・持ち物・装備・投擲・保存とロードを確認しました。[LAN の記録](output/lan/evidence.json) に保存しています。

## 投げる方向を通常の移動入力で指定（2026-10-08）

`node tests/browser-smoke/throw-direction.mjs` は実 C/Rust/Wasm を Playwright で操作し、投げる方向の専用ウインドウがなく、普段のゲーム画面と方向ボタンが表示されることを検証します。Chrome/Brave の実行ファイルは `ROGUE_CHROME` で切り替えます。通常版と game-fixtures をビルドして実行します。

スマホのタッチ8方向とPCの矢印・Home/End/PageUp/PageDown 8方向を、持ち物メニューからの投擲と t コマンドの両方で実行します。h j k l y u b n、Shift/Ctrl付き16通り、キャンセル後の通常移動、幅320/390/844と全画面、英語、現行・旧版の方向指定途中の保存とロード、回数指定と直前の投擲を繰り返す a も確認します。方向入力がプレイヤーを動かさないこと、待機・持ち物等のタッチ操作が方向待ち中は無効であることを検査します。杖などの方向ウインドウも回帰確認します。

比較元は `output/throw-direction/before/build/game-fixtures.js` と同名の Wasm、または `ROGUE_THROW_BASELINE` で指定します。今回の変更直前の独立したビルドへ、確認した方向を元の C キーとして渡し、全20状態値・乱数・入力位置の全チェックポイントを比較します。過去ビルドがない環境では現行 C に対するキー列比較を行い、`historical: false` と記録します。旧版の保存をロードする検査は比較元がある場合に実行します。

結果・画面・ファイルハッシュは [Chrome](output/throw-direction/chrome/evidence.json) と [Brave](output/throw-direction/brave/evidence.json) に保存します。画面は実際の Canvas のスクリーンショットで確認し、スマホは Playwright のタッチ・画面サイズのエミュレーションです。実機スマートフォンでの手操作は含みません。

2026-10-08 の最終実行は Chrome/Brave 各65項目成功、変更前の C キー列との71シナリオ比較が一致しました。翻訳 fallback・未登録ID・ブラウザー例外は0でした。画像を目視し、方向指定中に専用ウインドウや地図を覆う案内を描かず、通常の方向ボタン・キャンセルとログの入力案内で操作できることを確認しました。関連する Canvas 31項目、タッチ入力 Chrome/Brave 各13項目、ルール・保存・翻訳・ログ34項目、Bevy 46項目、LAN製品ビルド8項目も成功しています。

## 持ち物の操作メニューと全コマンド（2026-10-08）

`i` の一覧でアイテムをクリック・タップ、または元のアイテムキーで選ぶと、Rust/Bevy が種類と装備状態に応じた操作メニューを作ります。詳細と戻るは表示だけを変更し、C の入力履歴・ターン・乱数には入りません。決定した操作は元の C コマンドへ渡し、投げる方向は通常の移動入力、杖の方向、指輪を着ける手、命名、識別の追加対象は C の入力ウインドウで選びます。

```powershell
.\build.ps1
.\build.ps1 -SkipRust -SkipCatalogGeneration -TestFixtures -OutputName game-fixtures -KeepArtifacts
node tests/browser-smoke/inventory-actions.mjs
$env:ROGUE_CHROME = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
node tests/browser-smoke/inventory-actions.mjs
```

Playwright で実際の Canvas をマウス・キーボード・タッチで操作します。2026-10-08 の最終ビルドでは Chrome と Brave のそれぞれで158項目が成功しました。原 C のヘルプ表にある通常コマンド63種類の集合とテストの集合を照合し、すべてを実行しています。ヘルプ表の残り2行は修飾キーの説明です。

| 操作 | 実行したキー |
| --- | --- |
| 移動 | h j k l y u b n |
| 大文字の方向操作 | H J K L Y U B N |
| Ctrl付きの方向操作 | Ctrl+h / j / k / l / y / u / b / n |
| 戦闘・探索・移動補助 | f F t m z ^ s > < . , a |
| 持ち物・使用・装備 | i I q r e w W T P R d c |
| 情報表示 | ? / D ) ] = @ v |
| 設定・保存案内・終了・再表示 | o S Q ! Esc Ctrl+r Ctrl+p |

これに加えて、Shift/Ctrl と矢印・Home・End・PageUp・PageDown の16通り、数値による移動回数指定、Q の「はい」と得点表示までを実行しました。`S` は設定ウインドウの保存操作を案内し、`!` はブラウザーではシェルを開けない案内を表示します。実際の IndexedDB 保存とロードは別に操作しています。全キーの動作確認であり、すべてのアイテム効果・地形・敵・乱数分岐を網羅する検査ではありません。

13個の所持品を選択して詳細・戻るを操作し、未知の薬の効果、呪い、未鑑定の強化値を漏らさないことを検査しました。飲む・読む・食べる・装備・脱ぐ・指輪・杖・投げる・落とす・命名、8方向の投射と杖、呪われた装備の失敗、床が塞がった落とす操作、取消後の移動、空と1個の持ち物、識別巻物の追加対象、検出画面を確認しました。PC・スマホ縦横・幅320px・英語・全画面のスクリーンショットも目視確認しています。実機スマートフォンでの手操作は含みません。

各ブラウザーの156操作シナリオで、対応する元の C キー列を変更前の独立した Wasm に渡し、入力位置と全20状態値（乱数を含む）の全チェックポイントが一致しました。比較用は `build/inventory-before.js` と同名の Wasm、または `ROGUE_INVENTORY_BASELINE` で指定します。存在しない環境では現行 fixture に対する C キー列比較を行い、`historical: false` を記録します。旧保存の overlay/slow/clear 一覧からの復元は変更前のビルドがある場合に実行します。新しい保存では、持ち物ウインドウからの再開と、投げる／杖の方向入力中に保存した選択対象の保持を検証します。

結果・実行日時・比較元と現行ファイルの SHA-256・スクリーンショットは [Chrome の記録](output/inventory-actions/chrome/evidence.json) と [Brave の記録](output/inventory-actions/brave/evidence.json)、画像はそれぞれ同じフォルダーです。翻訳 fallback・未登録ID・ブラウザー例外は0でした。関連する Canvas 31項目、タッチ入力 Chrome/Brave 各13項目、Node のルール／保存／翻訳／ログ34項目、Bevy 46項目も成功しました。従来の C 端末へ描いた `i` の1フレームだけは Rust ウインドウに置き換わるため、端末画像の旧版比較からそのフレームだけを除き、以降の C フレームとすべての状態・入力は厳密に比較します。

`node tests/browser-smoke/lan.mjs https://192.168.11.4:4173/` でも通常の製品ビルドを確認し、8項目成功しました。配信中の JS/Wasm がローカルの最終ビルドと同一であること、スマホの詳細表示・戻る・装備・通常の方向ボタンによる投擲、保存して再読み込み後にロードする操作を確認しています。ローカル証明書はこの検証用ブラウザーで許可します。[LAN の記録](output/lan/evidence.json) に結果を保存します。

## 現行 Canvas 版の確認（2026-10-08）

画面全体を単一の Canvas2D に変更しました。現在のブラウザー検証の入口は次のコマンドです。後続の DOM レイアウト用スクリプトと記録は、Canvas 化前の検証履歴です。

```powershell
node tests/browser-smoke/canvas.mjs
node tests/browser-smoke/underfoot.mjs
node tests/browser-smoke/touch-input.mjs
```

Playwright と実 Chrome/Brave を使用し、隔離したプロファイル・空いている loopback ポートで実 C/Rust/Bevy/Wasm を操作します。ROGUE_PLAYWRIGHT_MODULE と ROGUE_CHROME で既存 Playwright のモジュールとブラウザー実行ファイルを指定できます。通常版・game-fixtures の JS/Wasm を先にビルドしてください。

非表示HTMLの操作依存と読み上げ用HTMLを削除しました。Canvasから開始・保存・設定・入力を直接処理します。

非表示HTML削除後も、ChromeとBraveのそれぞれで31項目のPlaywright検証が成功しました。トップの手動・ランダム入力、不正入力、日本語の入力草稿・IMEイベントと保存復元、持ち物の閉じる、11種類の品物選択、識別、方向・記号・確認、ヘルプ・発見一覧・1行ずつの所持品、検出マップ2種類、表示3方式・倍率・全画面、保存とロード、死亡2種類・勝利からトップ復帰、戦闘ログ、幅320/390/844の画面変更、タッチ操作とドラッグ、DPR 2を確認しました。Canvas を隠したスクリーンショットは背景色だけになり、画面へ DOM の画素が出ないことを検証します。実行中のDOMにも非表示のボタン・フォーム・ログ・読み上げ用情報がないこと、Canvasの配布元・ライセンスリンクと保存ダウンロードも確認します。Windows の実 IME 製品による手操作は含みません。

結果・ファイルハッシュは output/canvas/evidence.json、実行全体は verification.json、Chrome/Brave別の結果は chrome-evidence.json / brave-evidence.json、スクリーンショットは同じフォルダーです。Canvas の当たり判定から座標を読み、Playwright の実マウス・キーボード・タッチ入力で操作します。製品のコールバックを直接呼んで操作を代用しません。

Canvas 化直前の game.js/game.wasm と fixture の組を output/canvas/before/build に保存した環境では、開始・終了・幻覚の C 状態を追加比較します。ROGUE_CANVAS_BASELINE で場所を指定できます。アーカイブがない環境では画面操作を検証し、比較未実行を evidence に明記します。

移行直前との完全比較は、同じ検証器の出力先を分けて実行しました。

```powershell
$env:ROGUE_PRE_BEVY = Join-Path $PWD 'tests/browser-smoke/output/canvas/before/build'
$env:ROGUE_MIGRATION_OUTPUT = Join-Path $PWD 'tests/browser-smoke/output/canvas/logic'
node tests/bevy-migration.mjs
```

35ケース・502入力地点・1,400回のキャッシュ再描画が一致し、保存バイト列3ケースと移行前保存3ケースも一致しました。診断用 engine メタデータと JSON 転送ハッシュだけを比較から除外し、ゲーム状態、乱数、入力記録、翻訳済み表示、マップ、結果、保存は比較します。会話全体の乱数監査62ケース・666地点も成功しています。C/Rustの回帰50件、入力・ホスト・カタログ・ログ・画像29件も成功しました。


移動ボタンの押下解除は `touch-input.mjs` で検証します。Playwright のスマホ設定と実 Chrome/Brave を使い、8方向と待機のタップ、長押し、ボタン外へのスライド、タッチ中断、ポインター取得の解除、二本指の両方の解除順、画面サイズ変更、実際のタブ移動によるフォーカス喪失、持ち物ウインドウへの切替、地図のドラッグと隣接マスのタップを確認します。タッチ後の Space/Enter が前の移動を繰り返さないこと、離したボタンの画素が通常状態へ戻ることも検査します。既存の実 C `plain` fixture を使用し、受理したキー列を直接 C に渡した結果と19地点の全20状態値・乱数を照合します。製品のコールバックを直接呼んで入力を代用しません。2026-10-08 は Chrome/Brave のそれぞれで13項目成功し、関連する `canvas.mjs` 31項目と `underfoot.mjs` 10項目も成功しました。引数に `https://192.168.11.4:4173/` などを指定すると起動済みLANサーバーへ接続します。記録と押下中・解除後の画像は `output/touch-input/chrome/` と `output/touch-input/brave/` に保存します。実機スマートフォンの手操作は含みません。


全画面ではタイトル・バージョン・配布元・ライセンス欄を描画せず、その上下の124pxも地図とログの領域に使用します。`canvas.mjs` の全画面検査は、全域への拡張、文字とリンク当たり判定の除去、Escapeでの元の配置への復帰とC入力・乱数の不変を確認します。長押しはCanvasのtouchstartを非passiveでキャンセルし、contextmenuと選択・calloutも抑止します。Pointer Eventsによるゲーム入力と、別のHTML入力欄による編集を維持します。

2026-10-08 の追加Playwright検証では、Chrome/Braveそれぞれ10項目が成功しました。1.3秒の長押しと実TouchEventの既定動作抑止、実contextmenuの抑止、タッチでの全画面切替、幅390/844/320の表示、拡張後の地図座標での移動、持ち物と設定、解除後の表示復帰を確認し、受理したキー列と原Cの全状態・乱数が各地点で一致しました。結果と画面は `output/fullscreen-touch/evidence.json` と同じフォルダーに保存しています。既存のタッチ操作13項目も両ブラウザーで、Canvas全体の31項目も再実行して成功しています。Android実機の振動モーターとソフトウェアキーボードの動作は、このデスクトップ環境では測定していません。


ログは「ゲーム」「システム」の分類見出しを省き、システム項目だけ文頭に ⓘ を付けます。従来のゲーム・システム・エラーの文字色を保ち、1行の項目は50pxから28pxへ詰めました。隣接マス以外やプレイヤー自身のマスをタップした場合は、警告やC入力を追加せず無視します。

2026-10-08 のPlaywright追加検証はChrome/Braveそれぞれ5項目が成功しました。変更前との同じ実C戦闘ログで、日英の分類見出しの除去、システムだけのアイコン、縮んだスクロール内容、描画画素の色とC/RNG全地点の一致を確認しています。保存APIの失敗を注入した検証でエラーの赤も確認し、離れた壁・自身・遠方の床のタップでログとC状態が増えないこと、移動ボタンからの壁衝突が原Cで処理されることを確認しました。結果と比較画像は `output/compact-log/evidence.json` と同じフォルダーに保存しています。Chromeの既存Canvas31項目・タッチ13項目、Nodeのログ・画面文言10項目も成功しました。

## Canvas化前の検証履歴

以下はCanvas化前のDOM画面とスクリプトの記録です。

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

原画面の `frame.cells` は論理回帰の観測用です。表示には文字領域を取り除いた ASCII の `frame.map_cells` と、Rust が翻訳した `frame.ui` を使います。日本語の状態・メッセージ・ヘルプ・一覧は DOM の文字列として描画し、一覧を縦スクロール・折り返しします。一覧・ヘルプ・ゲーム内設定は、Rust が定義するゲームウインドウを表示します。Rust は直前のマップを保持し、Canvas は背後に表示し続けます。操作ボタン・キー入力は Rust 入力から C 本体へ渡します。

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

## ゲーム操作ウインドウ（2026-10-08）

持ち物・ヘルプ・ゲーム内設定・品物選択・方向指定・文字入力・発見一覧・記号確認・終了確認は、`rust/crates/display/src/game_window.rs` が作る表示データをゲーム画面内のウインドウへ描画します。マップは直前の観測済みセルとタイルを Rust が保持します。入力は `Rust ゲームウインドウ → Rust 入力 → C 本体 → Rust 表示` の順で処理し、品物ボタンも C が公開した descriptor と選択キーを使います。表示と入力待ちの同期、Space 待ちの Enter/Esc、入力欄の Esc、フォーカスとスクロールを確認します。

`node tests/browser-smoke/game-windows.mjs` で実 Playwright/Brave を起動し、隔離したブラウザーと loopback origin で実 C/Rust/Wasm を操作します。結果・現行ファイルの SHA-256・PC/スマホ/英語 ASCII のスクリーンショットは `tests/browser-smoke/output/windows/evidence.json` と同じフォルダーに保存します。持ち物表示中の保存・新しい Worker への復元、C の装備処理、入力待ちの取消、変更中にマップと Canvas の画素が保持されることを検査します。

## Space 待ちの全経路確認（2026-10-08）

`node tests/browser-smoke/space-waits.mjs` は、通常の C/Rust/Wasm とテスト用の実 C 状態を Playwright で操作する。一覧の閉じる、複数ページ、1行ずつの所持品、薬と巻物の検出、勝利から精算、通常ログと旧形式の More 待ちを確認する。条件・呼び出し元・現在の表示は `docs/SPACE-WAITS-ja.md` に記載した。検出画面は C が描いた記号と既知のマップをウインドウ内に表示し、背景マップも保持する。証拠と画像は `output/space-waits/evidence.json` と同じフォルダーに保存する。


## この会話の乱数影響調査（2026-10-08）

`node tests/session-rng-audit.mjs` の後に `node tests/browser-smoke/session-rng.mjs` を実行する。Git HEAD の製品 Wasm と独立した元の C 再現状態に対し、乱数を含む全20項目・入力位置・C フレームを照合し、変更前の保存も再開する。Playwright では変更前の画面と現行版、幻覚中の表示操作と各閉じる方法を比較する。調査範囲・入力の意図した変更・制限は [乱数影響調査](../../docs/SESSION-RNG-AUDIT-ja.md) に記録する。

## 品物選択の整理（2026-10-08）

通常版と fixture 版をビルドした後、node tests/browser-smoke/item-selection.mjs を実行します。Playwright/Chrome の隔離したプロファイルで、日本語PCと英語スマホの q / w / r / e / W / P / d / c / t / z / I を操作し、候補と取消だけが表示されることを検証します。方向入力が先に必要な t / z も実際に入力します。

i の持ち物ウインドウ、品物選択中のキーボード *、ヘルプ・発見一覧の「すべて表示」を確認します。item-identify fixture は実際の武器識別の巻物を所持品へ加え、r から対象をクリックして C の識別処理とターン更新まで確認します。この fixture は製品 Wasm にリンクしません。

2026-10-08 の実行は22経路と識別処理が成功し、ブラウザー例外と翻訳 fallback は0です。output/item-selection/evidence.json にファイルハッシュ・結果を、同じフォルダーにPC・スマホ・識別の画像を保存しました。キーボード * による従来の一覧は game-windows.mjs / space-waits.mjs / session-rng.mjs でも再確認しました。

## トップ画面と復帰（2026-10-08）

node tests/browser-smoke/top-screen.mjs を実行します。通常版・fixture版のビルド済み Wasm、Playwright、Chromeを使い、隔離したブラウザーと loopback origin で確認します。名前・シードの各ランダムボタン、手動開始、境界値0/4294967295と不正入力、英語とスマホ幅390/320、保存してトップへ戻る操作、ロード・再読み込みによる持ち物ウインドウの復元、終了画面からの復帰を検査します。

変更前の画面はローカルの output/top-screen/before/ を使います。アーカイブがない環境では Git HEAD のHTML・JS・CSS・画面カタログを読み込みます。どちらも同じビルド済みゲームに同じ入力を渡し、開始状態と死亡2種類・勝利の全20項目の C 状態・トレースを比較します。保存データの形式や C の乱数処理は変更していません。

2026-10-08 の結果は11項目成功、終了3経路の比較が一致、ブラウザー例外・翻訳 fallback・未登録UI IDは0でした。output/top-screen/evidence.json に結果とファイルハッシュ、同じフォルダーにトップPC/スマホ・設定・ロード後・死亡・勝利・スコアの画像を保存しています。関連する layout.mjs（11項目）、game-windows.mjs（15項目）、space-waits.mjs（14項目）、item-selection.mjs（22選択経路＋識別）、pixels-v2.mjs、combat-log.mjs、run.mjs の日本語20項目も、新しいトップ経由の開始・ロードで再確認しました。

## Bevy 0.19.1（2026-10-08）

Rust 側の App/ECS・入力・表示・保存を Bevy に移行した。`game-windows.mjs` は実際の Worker が出す `frame.engine` を確認する項目を追加し、16項目になった。移行前を読み込む `session-rng.mjs` は、対応する game.js と game.wasm を必ず組で使用する。

Web用ゲーム、fixture、投射物fixtureをビルドする。fixture は製品にリンクしない。

```powershell
.\build.ps1 -SkipCatalogGeneration
.\build.ps1 -SkipRust -SkipCatalogGeneration -TestFixtures -OutputName game-fixtures -KeepArtifacts
.\build.ps1 -SkipRust -SkipCatalogGeneration -TestFixtures -OutputName graphics-fixtures -KeepArtifacts
.\tools\check-rust-layers.ps1 -Binary engine-check
node tests/bevy-migration.mjs # ローカルの移行直前アーカイブが必要
node tests/session-rng-audit.mjs
node tests/browser-smoke/top-screen.mjs
node tests/browser-smoke/game-windows.mjs
node tests/browser-smoke/space-waits.mjs
node tests/browser-smoke/item-selection.mjs
node tests/browser-smoke/layout.mjs
node tests/browser-smoke/pixels-v2.mjs
node tests/browser-smoke/session-rng.mjs
$env:ROGUE_JA_SCENARIO='1'
node tests/browser-smoke/run.mjs
```

直接比較の内容と実測記録は [乱数調査](../../docs/SESSION-RNG-AUDIT-ja.md)、Bevyの構成は [実装資料](../../docs/IMPLEMENTATION-ja.md) を参照する。依存はCargo.lockで固定し、ライセンス原文と一括配布用ZIPも更新した。トップ画面のみを追加した時点とは異なり、Bevy移行では製品JS/Wasmも再ビルドしている。

## プレイヤーと敵の足元の回帰確認

縦横共通の正方形石壁は `node tests/browser-smoke/wall-blocks.mjs` で確認する。両方の本番アセットセットの読み込み、全倍率、PC・スマホ幅390px／DPR 2の画素比較、実Cの壁との衝突と扉への移動を実行する。表示操作ではC/RNG・プレイヤー位置・入力回数・表示済みマップが変わらないことを確認する。2026-10-11は16項目成功、ブラウザー例外0。スクリーンショットと記録は `output/wall-blocks/`、アセット・再梱包手順は [壁の資料](../../docs/WALL-BLOCKS-ja.md) を参照する。

underfoot.mjs は実際のC入力で扉・通路へ移動し、プレイヤー画像の透明部分について、乗る前の地形と表示画素が一致することを確認します。ドット絵・イラスト・スマホのタッチ操作、持ち物中の地図、保存後にページを再読込みしてロードした足元、階段と降りた先の階を検証します。階段だけは既存の plain fixture を使用し、通常の扉・通路はシード17の製品ビルドです。引数にLANのHTTPS URLを渡すと、起動済みサーバーへ接続します。ローカル証明書の警告はこの検証用ブラウザーで許可します。記録とスクリーンショットは tests/browser-smoke/output/underfoot/fixed/ に出力します。

敵は actor-underfoot の制御された状態で、通路・扉・階段・罠・床の5種類を検査します。期待する地形に敵画像を独立して重ねた参照画像と、実Canvasの全画素を比較します。actor-underfoot-moving では実Cの敵移動を3ターン進め、階段→扉→通路の背景と離れたマスの復帰、古い足元情報の消去を確認します。持ち物と新しいWorkerへの保存復元、盲目での敵検知による未観測地形の非公開も検査します。Chromeはソフトウェア描画で起動し、Canvasの描画完了を待ってから画素を読みます。実機スマートフォンの手操作は含みません。

## 状態別の選択肢と全コマンドの後続処理

`context-controls.mjs` はマップ、階段、投げる方向、品物、装備、名付け、発見一覧、ゲーム内設定、検出、識別、保存・ロード、死亡・勝利・終了について、必要な選択肢だけが表示されることと後続処理を実行する。`inventory-actions.mjs` は原作ヘルプの全63コマンドと16修飾キー入力を照合し、各入力列の後に通常のコマンド待ちへ戻ることを要求する。`ROGUE_INVENTORY_MOBILE=1` では全ケースの既定viewportと操作をスマホのタッチに切り替え、結果を別フォルダーへ保存する。

全ての候補の表示に加え、実際の品物選択、方向、文字の確定・取消、左右の指輪、二段目の識別対象、一覧の全ページ、検出終了、結果・スコア終了、トップへ戻る操作まで確認する。変更前Wasmとの全状態・乱数の比較、スクリーンショット、実行手順と条件は [操作の調査](../../docs/UI-COMMAND-AUDIT-ja.md) を参照する。
