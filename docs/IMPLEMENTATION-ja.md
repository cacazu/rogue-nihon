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

メインスレッド用の `build/browser-ui.wasm` は停止中のゲームWorkerとは別instanceである。単一の可視Canvas2Dへトップ、地図、HUD、ログ、設定、ゲームウインドウ、フッターを描く。透明なネイティブinputはIME・文字編集・選択範囲・クリップボードの受取りに使う。

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

復元は新instanceでcheckpointを読み、journalを同じC経路へ再生して入力待ちを再構築する。Cスタック自体や生ポインターを保存しない。加速の行動間、品物・方向・文字・一覧の途中待ちもこの方法で再現する。保存済みキーを物理入力として再変換しない。

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

読み込みは版・CRC・長さ・参照・範囲・終端・callback・割り当て上限を検証する。logic decoderはglobalを退避し、新規割り当てを追跡する。失敗時は元状態へ戻して新規割り当てを解放し、成功時だけ旧graphを解放する。分割した品物のlabel共有が残る旧graphは文字列addressを重複排除して一度だけ解放する。

GOLDのcount=0、食料や杖のwield、方向指定の絶対target、壁移動失敗後のnh、gone roomの負extent、passages[12]のゼロ初期値は原作で到達可能な状態として扱う。roomsとpassagesを同じ制約で検証しない。

## Rust保存envelope

`rogue-platform::Envelope` はformat・版・ABI・原作source hash・seed・名前・checkpoint_hex・inputs・input_index・checksumを持つ。JSON全体は16 MiB、checkpointは4 MiB、journalは65,536入力まで。版2のpresentationは512 KiBまでで、`lines / input / history / last_message` の構造も検証する。

版1はASCII入力履歴、版2はUTF-8 byteと意味ID付きpresentationを保存する。旧版1はルール状態を復元できるが、当時の意味付き履歴がないため過去メッセージの日本語を完全には復元できない。checksumは破損検出であり署名ではない。表示モード・倍率は別のlocalStorage設定で、ゲーム保存へ含めない。

## 本番・ビルド・検証の分離

`start.ps1` は作品フォルダー外の開発用 [../tools/server.mjs](../../tools/server.mjs) へ配信対象を渡す。共有入力に必要なCOOP/COEPヘッダーとWasmのContent-Typeは本番の静的配信側でも設定する。同じ配信元の既存サーバーは再利用し、別プロセスの終了や自動ポート変更は行わない。originが変わるとIndexedDB保存枠も変わるためである。

通常Wasmに `RG_TEST_FIXTURES` や `RG_TEST_HOOKS`、Rustの `test-hooks` を含めない。試験用buildには `game` 以外の出力名を要求する。テストアダプターは検証側から注入し、本番JSから読み込まない。

通常ビルドは自分の専用コンパイラー領域だけを終了時に閉じる。他の中断した実行の回収は検証ツール・明示的な開発操作に限定する。配布に必要な `game.js / game.wasm / browser-ui.wasm / build-manifest.json` は保持する。ビルド・検証の実行方法は [README](../README.md) と [tests/README](../tests/README.md) に置く。
