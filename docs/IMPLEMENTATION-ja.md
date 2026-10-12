# 実装の判断と境界

原作のルール・乱数・入力待ちをCに残し、表示・入力変換・保存をRustで担当する。原作との差分と周期は [原作仕様との対応](ORIGINAL-SPEC-ja.md)、意味データと名称は [日本語化の契約](LOCALIZATION-ja.md)、地図の観測と画像は [地図表示の契約](MAP-DISPLAY-ja.md) を参照する。

## 状態の所有者

| 担当 | 実装 | 所有する状態・判断 |
|---|---|---|
| Cロジック | `logic/core.c`、`command.c`、原作の各ルール、`knowledge.c` | 生成・戦闘・移動・ターン・RNG・探索記憶・同期入力待ち |
| 表示 | `rust/crates/display/` | 翻訳、ゲームウインドウ、公開済み所持品の描画、観測地図・足元・効果、不変フレーム |
| 入力 | `rust/crates/input/` | 物理入力から原作キーへの変換、UTF-8編集、持ち物メニューの選択と操作予約 |
| プラットフォーム | `rust/crates/platform/` | checkpoint、消費済み入力journal、再生位置、保存envelopeと検証 |
| ゲーム側の接続 | `rust/src/lib.rs`、`session.rs`、`engine.rs` | C/JS FFI、Bevy Appの組立て、各層への状態投影と実行順 |
| ブラウザー側の判断 | `rust/crates/browser-display/src/controller.rs`、`policies.rs`、`display/src/browser_ui/`、`widgets.rs` | 開始・終了・保存の状態、Worker世代、IME制限、入力検証、表示設定、履歴、配置・フォーカス・カメラ・タイル計画 |
| ブラウザーAPI接続 | `web/` | Rustの命令をCanvas2D、ネイティブ文字入力、Worker/SAB、IndexedDB等へ接続 |

入力は表示の公開descriptorを参照する。表示から入力への依存はなく、プラットフォームは表示・入力に依存しない。3層のクレートではunsafeを禁止し、FFIは接続用クレートに限定する。

## 実行とABI

契約の正本は [contract/rogue_abi.h](../contract/rogue_abi.h)。固定幅整数と借用byte列を渡し、CのWINDOW・THING・FILE・生の関数ポインターは公開しない。ABI定数は同じヘッダーからRustの `rogue-contract` と `web/abi.js` へ生成する。Cが確保した保存bufferは `rg_core_save_free` で解放する。

CゲームスタックはWorker内で同期実行し、入力キューが空ならAtomics.waitで待つ。空キューをEscや仮の入力として扱わない。Asyncifyは使わず、新規ゲームと復元には新しいWorker/Wasm instanceを作る。

`rogue-layers` のBevy Appには表示・入力・プラットフォームのPluginを登録し、CのFFI呼出しに合わせて `App.update()` を行う。SystemSetの順序は **Presentation → Input → Journal → AcceptedInput → Frame → Save**。時間経過やブラウザーの再描画だけでCのcommand・look・RNGを呼ばない。

メインスレッド用の `build/browser-ui.wasm` は停止中のゲームWorkerとは別instanceである。ゲーム画面の上のタイトルはHTMLの `header.heading` に置き、Rustのdocument命令で言語を反映する。HTMLタイトルは「元祖 ローグ · 5.4.4」を表示する。トップの開始フォーム、地図、HUD、ログ、設定、ゲームウインドウはCanvas2Dへ描く。PC・スマホともトップ右上は全画面ボタンだけにし、設定ボタンはゲーム中に表示する。トップの再開操作は `resume.rs` が「前回の続き」と「セーブファイル」を横並びに描き、GitHubリンクをその次にだけ置く。透明なネイティブinputはIME・文字編集・選択範囲・クリップボードの受取りに使う。

設定はPC・スマホ共通の `browser_ui/settings.rs` で描く。先頭行は全画面アイコンボタン、操作ボタンの表示切替アイコンボタン、マップ表示プルダウン。空白行を挟み、保存と書き出しを同じ行、その下にセーブファイルから再開を置く。次の空白行の下はトップへの復帰と「冒険を終える」を同じ行、さらに空白行の下へ原作設定を置く。倍率の部品とセンタリングは設定に置かない。表示言語はトップで選ぶ。名前・シード・ランダム選択・新規開始・前回の続きはトップだけに置き、GitHubは再開ボタンの下に置く。設定には保存・再開の結果とエラーだけを出し、ゲームのメッセージや常設の説明文を出さない。

## スマホの操作部品

幅700 CSS px未満またはcoarse pointerでは、独立ファイル `display/src/browser_ui/mobile.rs` が画面を構成する。ゲームWorkerはBevy Appを使うが、ブラウザーの画面遷移は `browser-display::Controller` の `topOpen`・`starting`・`running` 等で管理する。スマホのトップは独立部品 `mobile_top.rs` がこの状態に従って描き、タイトル・名前・シード・新規開始・ロードを表示する。保存がない場合はロードを無効にし、入力エラーだけを表示し、通常の通知や説明文は出さない。狭い横画面ではトップ内をスクロールできる。開始中は読み込み表示を出す。

スマホではゲーム開始・ロード時からHTMLタイトルの下にゲーム領域・全画面・設定・操作パッドを出す。設定から操作パッドを隠しても、次の開始・ロードでは再び表示する。PCの操作パッドは表示切替で開く。保存・書き出し・セーブファイルから再開・表示設定・原作の設定は設定内から使える。再描画・直前のメッセージ表示・シェル起動・版表示は操作項目に出さない。原作のQは `main.c:quit` が終了結果と金額を確定して得点画面へ進むため、「冒険を終える」として残し、原作の確認を使う。新規開始と前回の続きは設定の「トップ画面に戻る」からトップへ移って行う。

この部品は既存のcontroller actionと公開済み `frame.ui.map_controls` にキーを渡す。`crates/input` とCのcommand経路は変更しない。持ち物・投げる・アイテムのアクション等は既存 `draw_dialog` と同じdescriptorを使い、アイテムの内容と入力候補を変更しない。スマホの案内文・ボタンのキー注記は `mobile_dialog.rs` が公開済みの入力kind・window kindからタップ用の文言へ差し替え、PCのキー操作案内と分ける。トップの「前回の続き」はIndexedDBの保存読み出し、「セーブファイル」はファイル選択を使い、いずれも検証後に新Workerへ復元する。

新規操作部品の下限を48×48 CSS px、頻用の方向パッドを52×52 CSS px、文字を17 CSS pxにする。[WCAGの44×44 CSS px](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) と [Androidの48dpタッチ領域](https://support.google.com/accessibility/android/answer/7101858?device=c&hl=en) を踏まえ、連続して押す方向には余裕を追加する。文字は [Appleの標準本文17pt](https://developer.apple.com/videos/play/wwdc2020/10175/) を参考にした本UIの読みやすさの設計下限であり、CSS pxとpt/dpを物理寸法として同一視せず、万人共通の医学的下限とは扱わない。既存ゲームウインドウの内容・部品はこの追加UIで作り替えない。

パッドは地図に重ねず下部へ置く。移動と待機を同じ3×3内に置き、右側は二列三段で「移動形式・持ち物」「状況別操作・全体図」「リスト・繰返し」を固定配置する。移動形式は「歩く→走る1→走る2→歩く」と切り替わり、原作の通常移動・Shift走行・Ctrl走行を送る。繰返しの初期回数は1で、ボタン下段には「長押し」を表示する。500msの長押しではC入力を送らず回数入力を開き、1〜255の整数を設定すると下段へその数値を表示する。短いタップは原作の数値接頭辞と再実行キーaを一括で送り、1回ではaだけを送る。新規ゲーム・ロードの開始時は1回へ戻す。回数ウィンドウの×・Escは変更を破棄し、入力エラーだけ表示する。すべての原作get_dir待ちは同じ8方向と取消を使う。スマホは上部に二段のステータスを右横の設定ボタンと同じ48pxの高さで表示し、上段を階層・HPゲージ・腕力・空腹度、下段を空白・経験値ゲージ・防御・所持金の4列にする。HPと経験値は同じ開始位置・長さのゲージにし、右端を防御・腕力の列の直前まで伸ばす。HPアイコンとレベルアイコンはそれぞれゲージの左横に配置する。HPには現在値/最大値、経験値にはレベルの数値を重ね、経験値そのものの数値は表示しない。防御と腕力、空腹度と所持金はそれぞれアイコンと値の開始位置を上下で揃える。レベル境界はビルド時に原作の `extern.c:e_levels` から生成する。背景は透明で地図に重ね、文字・アイコンには黒い縁を付ける。地図の下には空でないゲームメッセージを折り返した末尾2行を時系列で表示する。短いメッセージが続く場合は直近2件が並ぶ。`status.rs` は既存 `HudWidget` の公開ステータスから同じ値を作り、金額は必要に応じて短縮し、腕力は現在値だけを表示する。ステータス欄をタップすると、名前と全ステータスをアイコン・名前・値の行で示すウィンドウを開く。この表示操作ではC入力を送らない。「現在の能力値を表示」とキーボードの@も同じウィンドウを開き、原作の@入力は維持する。PCの通常HUDは既存の表示・横スクロール・詳細を使う。PC・スマホともメッセージ欄のクリック・タップで `history.rs` の履歴画面を開く。リストは「移動・探索」「戦闘」の順に見出し付きで整理し、持ち物欄や現在のゲーム画面上のボタンで実行できる操作を除いた原作コマンドを表示する。1ターン休息、反復・取消の分類全体、記号調査は表示しない。持ち物ウィンドウは、タイトルの文字サイズと同じ20px高の「アイテム履歴」ボタンをタイトル横に置く。その下のタブは「すべて・装備中・杖・食べ物・薬・巻物・武器・防具・指輪・護符・金貨」の順とし、所持品の公開descriptorに一致する項目があるタブだけ表示する（すべては常設）。タブ行は横スワイプ・ドラッグ・ホイールでスクロールする。絞り込みはBrowserUiの描画だけで行い、入力層が参照する全所持品の装備枠情報を維持する。選択タブとタブごとの縦位置・タブ行の横位置をrogue-inventory-view-v1のlocalStorageに保存し、閉じて再表示・詳細から戻る・再読み込み後も復元する。選択した種類がなくなった場合はすべてへ戻し、位置は現在の表示範囲内に収める。「アイテム履歴」は一覧のC待ちを閉じてから原作の発見一覧Dを開き、入力kindがdiscoveryのときだけ全件選択の*を自動で渡す。種類選択の中継を省くが、Cのdiscovered→print_disc→set_orderと乱数による順序決定を維持する。Dと*は通常と同じキーとしてjournalに記録し、復元時には記録済み入力を再生する。ゲーム画面からのキーボードDは原作どおり種類選択を開く。Web固有のマップ表示操作と固定50ターン休息は一覧に置かない。システム用コマンドは設定へ置く。

投げる・杖の使用・消耗品の使用・装備変更・名付け・詳細確認は持ち物欄から行う。

「全体図」はパッド右側のボタンで開閉する確認用の独立部品 `mobile_map.rs`。現在の公開地図を幅に合わせて色分けし、タイトルは出さず、17pxの凡例を一行で付ける。同じボタンをもう一度押すと通常表示へ戻り、入力decoderやゲームウインドウを変更しない。詳細は地図表示の契約に定義する。

状況別操作は通常「探す」で、公開された足元と現在の入力状態から、階段上では「下りる」（護符取得後は「上る」）、足元のアイテムには「拾う」、足元または隣接する観測済みの罠には「罠調査」へ切り替える。罠調査は原作の方向選択を移動パッド上で開く。階段の可否と浮遊中の拾得不可は読み取り専用のplayer_stateを使い、品名やログから推測しない。リストでは状況別ボタンと同じ操作を非表示にし、階段を離れた場合や浮遊中の階段操作は無効にする。六つのボタンの配置は保つ。

一覧・設定はボタン上からのタッチスワイプでスクロールでき、移動した押下は実行しない。倍率は地図上のピンチ・ホイールで変え、表示方式に共通の連続した8〜128 CSS px/セルを使う。Rustの `gestures.rs` がピンチの比率とホイールの連続アニメーションを計算し、JSはrequestAnimationFrameを実行する。原作に拡大縮小処理を追加しない。操作中心の地図位置を維持する。スマホの移動・待機パッドは押下時に既存キーを一度送り、350msの長押し後は100msごとに、前の入力が処理され新しいcommand待ちになった場合だけ同じキーを送る。解放・取消・指の移動・ウィンドウ表示で反復を止める。方向待ちは解放時の一回だけを使う。投げるt・杖z・自動戦闘f/F・拾わずに移動m・罠調査^の全6操作で方向ウィンドウを出さず、同じ移動パッドを強調表示する。原作get_dirは8方向とEscだけを受け付け、自分方向を受け付けないため中央キーは出さない。修飾キーは方向待ちで単一の通常方向へ正規化し、走行を開始しない。操作一覧・履歴・ステータスウィンドウ中は背景のゲーム入力を遮断する。PC幅へ切り替わる場合は操作一覧を閉じる。表示・一覧・倍率・全画面・resizeでC状態、RNG、入力回数を変えないことをPlaywrightで検証する。原作の@では端末画面のメッセージhashは変わるが、ターン・ルール状態は維持する。

配置の導入理由はシード123の390×844・DPR2の実プレイから得た。1歩目の地図タップで指用の独立方向部品が必要になり、26ターン目に部屋の両端が32px表示で同時に見えず広域切替を追加した。46ターン目の行き止まり探索で「探す」をパッドへ追加し、186ターン目の投射失敗で履歴を開かず結果を見る表示を追加した。階段操作は原作フラグと足元の観測に従い、前段落の表示規則で出す。攻略とUI導入の詳細な実行記録・画像・到着セーブはローカルのプレイ記録に保持し、仕様の正本はこの文書と地図表示の契約とする。

| C側の入口 | 接続先・目的 |
|---|---|
| `rg_core_start / rg_core_exit` | Rustの `rg_run` と開始・終了結果 |
| `command / do_daemons / do_fuses` | Cのコマンド・周期。表示から追加実行しない |
| `rg_knowledge_present` | `rg_host_present` へ観測済み画面を渡す |
| `rg_message_prepare / rg_message_flush / rg_semantic_argument` | `rg_host_message` へ意味ID・引数・原英文を渡す |
| `rg_ui_line / rg_ui_printf` | `rg_host_ui` へ設定・一覧・選択・結末等を渡す |
| `get_str / strucpy` | `rg_host_text_mode / rg_host_read_key / rg_host_player_name` と文字入力 |
| `rg_core_save_bytes / rg_core_load_bytes` | `rg_host_checkpoint / rg_host_restore_data` と保存・復元 |

## JSに置く処理

| ファイル | 接続の責務 |
|---|---|
| `app.js` | Worker、IndexedDB、localStorage、crypto、全画面、Blob書き出し、リンク等のAPI実行。保存bytesは不透明なbufferとして扱う |
| `canvas-ui.js` | Wasm/JSON接続、イベント・画面寸法・入力値の観測、Canvas描画と文字計測、pointer capture・timer・requestAnimationFrame。フォーカスとイベント取消はRustに従う |
| `tiles.js` | Rust指定画像のデコードと描画、ドット絵の回転ラスタライズ。可視性や地形・役者の判定はRust側 |
| `event-queue.js` | SAB/Atomicsのリング転送・待機・切断・容量検査。一括入力は全公開または全拒否とし、生の整数を解釈しない |
| `worker.js / library.js` | Emscripten、仮想FS、借用メモリーのコピー、入力・フレーム・保存の転送 |
| `abi.js` | 生成済み定数。現在の通常HTML/Workerでは読み込まない |

Worker世代が変わった後の古いcallbackはRust側で無視する。保存成功はIndexedDB transactionの完了後に通知する。文字編集中の保存は草稿をCへ送って保存し、Enterで確定しない。キュー送信に失敗した場合は編集状態を失わない。トップへ戻る操作はWorkerと入力キューを終了し、保存済みデータを保持する。保存中は戻る操作を無効にする。

## checkpointと入力再生

Cは外側command境界の状態を保存する。Rustはそのcheckpointと、以後Cが実際に消費した変換済みbyte/キーをjournalに記録する。表示だけの選択・スクロール・再描画・保存要求はC入力履歴へ混ぜない。

復元は新instanceでcheckpointを読み、journalを同じC経路へ再生して入力待ちを再構築する。Cスタック自体や生ポインターを保存しない。加速の行動間、アイテム・方向・文字・一覧の途中待ちもこの方法で再現する。保存済みキーを物理入力として再変換しない。

| 保存する持続状態 | 理由・担当 |
|---|---|
| `countch / direction / newcount` | 数値反復・Ctrl方向反復を次commandへ引き継ぐ。`command.c` のget/set |
| `last_delt` | 再実行が直前方向を使う。`misc.c` のget/set。混乱前の記録順も維持する |
| statusの幅と値キャッシュ | raw画面の更新順とページ送りに影響する。`io.c` のstatus get/set |
| `line_cnt / newpage / maxlen` | 一覧の境界と窓幅。`things.c` のmenu get/set。外側境界ではline_cnt=0を検証する |
| `msgbuf / newpos`、`huh / prbuf / mpos` | 英語メッセージの蓄積・再表示・Moreによるlookに必要 |
| `oldpos / oldrp`、探索記憶、daemon/fuse | 復元後のlamp消去、可視画面、効果・周期を継続する |
| 各生成・追跡処理の作業用static | 使用前に再初期化されるものは保存しない。途中処理はjournalで再実行する |
| serializerのerror flags | 保存状態に含めず、各save/import開始時にresetする |

名称の静的登録、翻訳断片キュー、一覧の `lastfmt / lastarg` の生ポインターは保存しない。UTF-8編集中のC bufferはjournalで再構築する。MASTER専用数値編集やOSのhome・shell・score lockはWeb構成の保存対象外。

mazeのused/nexits、通路生成のisconn/ingraph、外見割当のused/metusedは各生成・初期化の冒頭でresetする。追跡・移動・投射の作業座標や表示文字bufferは使用前に構築する。正常mapに有効exitがないなど、以前の作業staticへ依存し得る不正fixtureを通常互換の根拠にしない。

WS_MISSILEのstatic boltは呼出しで必要属性を設定する。cur_weaponがない経路で残るo_launchは、通常weapon whichが非負の条件では有効launcherにならない。不正なwhichを追加してこの前提を破らない。復元後のplayitはoldpos/oldrpの初期値再代入を避け、保存済みのlamp消去状態を使う。

## C保存コンテナ

`logic/save_adapter.c` が `rg_core_save_bytes / rg_core_load_bytes / rg_core_save_free` を実装する。整数はlittle endian、上限4 MiB。旧端末版のFILE/XOR保存形式とは別で、未対応版を拒否する。

| byte offset | 内容 |
|---|---|
| 0 | `RG4SAVE\0`、8 bytes |
| 8 / 12 / 16 / 20 | container版1 / logic schema 2 / knowledge schema 1 / runtime schema 1、各u32 |
| 24 / 28 / 32 | logic / knowledge / runtimeのbyte長、各u32 |
| 36 / 40 | 完了turn数 / IEEE CRC32、各u32 |
| 44 | logic、knowledge、runtimeの順のpayload |

CRCは0〜39 byteと全payloadを対象とする破損検出で、認証ではない。各長さの和は入力長と一致させ、headerとruntimeのturnも照合する。

logicにはroomsとpassagesの参照空間、13種類のdaemon/fuse callback、monster/object/gold/hero参照、seed・dnum・max_hit等を保存する。knowledgeは `RGKN` 版1、24×80のglyph/standoutとcursor・属性、3,856 bytes。runtimeは `RGRT` と版・core word数・message byte数の16 byte headerに、17 u32のcore状態とmessage状態を続ける。message状態は版1・newpos・143 byteのmsgbuf、計151 bytes。

読み込みは版・CRC・長さ・参照・範囲・終端・callback・割り当て上限を検証する。logic decoderはglobalを退避し、新規割り当てを追跡する。失敗時は元状態へ戻して新規割り当てを解放し、成功時だけ旧graphを解放する。分割したアイテムのlabel共有が残る旧graphは文字列addressを重複排除して一度だけ解放する。

GOLDのcount=0、食料や杖のwield、方向指定の絶対target、壁移動失敗後のnh、gone roomの負extent、passages[12]のゼロ初期値は原作で到達可能な状態として扱う。roomsとpassagesを同じ制約で検証しない。

## Rust保存envelope

`rogue-platform::Envelope` はformat・版・ABI・原作source hash・seed・名前・checkpoint_hex・inputs・input_index・checksumを持つ。JSON全体は16 MiB、checkpointは4 MiB、journalは65,536入力まで。版2のpresentationは512 KiBまでで、`lines / input / history / last_message` の構造も検証する。

`browser-display/src/save_loading.rs` は同じ `Envelope::parse` でファイル・IndexedDBの保存をゲーム開始前に検証する。拡張子だけでは受け付けず、形式・版・ABI・source・構造・上限・checksumを検査する。無効なファイルと選択取消では現在のセッションを終了せず、保存済みbytesも差し替えない。ファイルのbytesは検証成功の命令後にだけ復元元へ移す。ゲーム内のcheckpoint復元でも失敗した場合はトップへ戻してエラーを表示し、再開・新規開始を可能にする。

版1はASCII入力履歴、版2はUTF-8 byteと意味ID付きpresentationを保存する。旧版1はルール状態を復元できるが、当時の意味付き履歴がないため過去メッセージの日本語を完全には復元できない。checksumは破損検出であり署名ではない。表示モード・倍率と持ち物の選択タブ・スクロール位置は別のlocalStorage設定で、ゲーム保存へ含めない。

## 本番・ビルド・検証の分離

`start.ps1` は作品フォルダー外の開発用 [../tools/server.mjs](../../tools/server.mjs) へ配信対象を渡す。共有入力に必要なCOOP/COEPヘッダーとWasmのContent-Typeは本番の静的配信側でも設定する。同じ配信元の既存サーバーは再利用し、別プロセスの終了や自動ポート変更は行わない。originが変わるとIndexedDB保存枠も変わるためである。

通常Wasmに `RG_TEST_FIXTURES` や `RG_TEST_HOOKS`、Rustの `test-hooks` を含めない。試験用buildには `game` 以外の出力名を要求する。テストアダプターは検証側から注入し、本番JSから読み込まない。

通常ビルドは自分の専用コンパイラー領域だけを終了時に閉じる。他の中断した実行の回収は検証ツール・明示的な開発操作に限定する。配布に必要な `game.js / game.wasm / browser-ui.wasm / build-manifest.json` は保持する。ビルド・検証の実行方法は [README](../README.md) と [tests/README](../tests/README.md) に置く。
