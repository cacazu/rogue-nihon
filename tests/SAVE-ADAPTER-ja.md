# 保存 adapter の実装と実行検証

`logic/save_adapter.c` が canonical ABI の `rg_core_save_bytes` / `rg_core_load_bytes` / `rg_core_save_free` を実装する。作業コピーの C ロジックを直接 byte buffer へ変換し、FILE、XOR、OS の保存先を利用しない。呼出しは初期化済みのゲームの command 外側境界で行う。入力待ち途中への復帰は、Rust 側の直前 checkpoint と入力 journal の再生で扱う。

取得原本 55 ファイルと既存 Brogue は変更せず、ここでビルドしたのは `rogue-four-layer/logic` の改変コピーである。

## Container

整数は little endian、全体の上限は 4 MiB。歴史的な Rogue save との互換性は提供しない。未対応版を拒否する。

| byte offset | 内容 |
|---:|---|
| 0 | `RG4SAVE\0` (8 bytes) |
| 8 | container version 1 (u32) |
| 12 | logic schema 2 (u32) |
| 16 | knowledge schema 1 (u32) |
| 20 | runtime schema 1 (u32) |
| 24 / 28 / 32 | logic / knowledge / runtime の各 byte 長 (u32) |
| 36 | 完了 turn 数 (u32) |
| 40 | IEEE CRC32 (u32) |
| 44 | logic、knowledge、runtime の順の payload |

CRC は 0–39 byte と全 payload を対象にする。破損検出であり、署名・認証ではない。各長さの和は入力長と完全一致しなければならない。

logic schema 2 は元の明示 serializer を補強し、WINDOW を含めない。rooms と passages の参照空間を区別し、13 種の daemon/fuse callback、monster/object/gold/hero の対象参照、実際の seed、dnum、max_hit を保存する。英語 C buffer の huh/prbuf/mpos はページ送り等の元の挙動に関わるため保存する。

knowledge は `RGKN` version 1、24×80 の glyph/standout、cursor と属性からなる 3,856 bytes。Rust の日本語 HUD と curses の構造体は含めない。

runtime は `RGRT`、u32 version 1 / core word 数 / message byte 数、core の 17 words、message state の順。turn、command の countch/direction/newcount、last_delt、status cache、menu cache、msgbuf/newpos を含む。初期版の message state は 151 bytes。

## 読み込みと所有権

container、CRC、knowledge、core runtime、message state を先に検証する。logic decoder は更新対象 global を退避し、新規 node/string を別の割り当てとして追跡する。count、index、callback、room extent、文字列終端、配列境界、正確な読み込み長、割り当て上限を確認し、失敗時は globals と参照先を復元して新しい割り当てを解放する。

正常状態では、GOLD の count=0、食糧や杖の wield、f/F/^ の絶対 target、境界移動に失敗した nh、gone room の負の extent、passages[12] の暗黙ゼロ初期化を許容する。rooms と passages は別の条件で検証する。

成功時のみ以前の graph を解放する。元の `leave_pack(newobj=TRUE)` は o_label を共有するため、旧 pack / floor / monster pack / 名前 / guess の string address を事前収集し、重複を除いて各割り当てを一度だけ解放する。補助 array の割り当て失敗も更新前に拒否する。検証済みの knowledge/runtime/message import は割り当てを行わない。

Web の S command はブラウザ保存 UI の案内を返し、after=FALSE とする。旧 terminal save_game/restore と OS file policy は `ROGUE_LAYERED` build から除外される。scoreboard=NULL の早期 return は維持する。

## 2026-10-02 の実行結果

`tests/build-save-adapter.ps1` で既存 Emscripten SDK を使用し、38 C sources (semantic.c を含む) と `tests/save-adapter.c` を C-only Node/Wasm module へビルドした。ROGUE_LAYERED、ASSERTIONS=2、SAFE_HEAP=1、32-bit wrapping の設定で実行した。malloc/calloc/realloc/free の linker wrap によって live allocation 数・要求 byte 数を計測し、割り当て失敗を注入した。

11 seed: 0, 1, 2, 3, 7, 42, 1024, 123456789, 2147483647, 2147483648, 4294967295。

- 合計 6,176 checks に合格。初期化前の save/load API の安全な拒否も確認。
- 初期 command 境界の snapshot と保存 byte が往復で完全一致。
- 13 callback、passage pointer、wielded food、絶対 target、境界 nh、monster→object/monster target を往復。
- pack と floor が同じ label allocation を持つ fixture の解放・復元に合格。
- CRC を正しく更新した不正 count / callback / room index / null room / logic 切り詰め / knowledge glyph・属性 / runtime count / message position / turn 不一致を拒否し、失敗後の全保存 byte が一致。
- 合計 770 箇所の allocation 失敗注入で拒否・byte rollback・live allocation 安定を確認。
- 各 seed 128 回、合計 1,408 回の繰り返し load に合格し、warmup 後の live allocation 数と byte 数が増えないことを確認。seed 1 は 38 allocations / 78,413 requested bytes。

証拠は `build/save-adapter-result.txt` (seed 1) と `build/save-adapter-seeds.json` (その他 10 seed)。再実行は `tests/build-save-adapter.ps1`。詳細 decoder 診断は `-Diagnostics` で有効にする。

この検証は保存 codec と初期境界 fixture の検証であり、ブラウザ IndexedDB の書き込み完了、任意入力待ちへの journal 再生、全階層・全ゲーム展開の互換性は別の統合検証で扱う。SAFE_HEAP と allocation 監査は、全種類の C 未定義動作を検出するものではない。
