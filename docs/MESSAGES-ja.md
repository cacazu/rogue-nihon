# メッセージと日本語表示の境界

Cは元の英語メッセージとゲーム内のページ送りを維持し、Rustは意味ID・型付き引数・可視情報から日本語の表示文を作る。`logic/rogue.h` の `msg` / `addmsg` マクロが呼出元と引数を `rg_msg` / `rg_addmsg` に渡し、`logic/io.c:endmsg()` が `rg_host_message(id, arguments_json, legacy_english)` を呼ぶ。元の英文と乱数選択を翻訳結果から逆算しない。

## 意味IDとカタログ

`tools/generate_catalog.py` は `logic/message_catalog.inc`、`locales/en.json`、`coverage.json` を生成する。ファイル名・行番号は呼出箇所の照合に使い、IDは関数と内容に基づく。例えば `armor.take_off.you_arent_wearing_any_armor`。既存カタログを参照し、行の挿入などで同じ内容のIDを変えない。元のprintf書式、ソース位置、関数も記録する。

カタログは表示の種類ごとにEN/JAペアを持つ。

| ファイル | 内容 | 現時点の各言語の件数 |
|---|---|---:|
| `en.json` / `ja.json` | 元のmsg/addmsg書式、意味を明示した動的メッセージ | 277 |
| `ui-game-en.json` / `ui-game-ja.json` | 操作説明、選択、直接画面に出るゲーム文 | 137 |
| `runtime-en.json` / `runtime-ja.json` | 所持品行、能力表示、More、表示用の意味ID | 41 |
| `endings-en.json` / `endings-ja.json` | 死亡、勝利、ランキング、売却表示 | 27 |
| `ui-web-en.json` / `ui-web-ja.json` | ブラウザの操作、保存、エラー案内 | 83 |
| `entities-en.json` / `entities-ja.json` | アイテム、モンスター、外見、罠などの動的名称 | 408 |

Rustのゲームメッセージカタログ4群を合わせたIDの重複なし件数は480。ブラウザUIと動的名称は別のrendererで扱う。詳細な名称生成は [ENTITIES-ja.md](ENTITIES-ja.md) に記録した。

`coverage.json` の静的集計は、296箇所、274個のリテラル書式ID、277箇所のリテラルまたは選択式、19箇所の動的書式。debugと無効化された旧OSコードも含む。この「動的」はCソースの分類であり、19箇所すべてが翻訳不能という意味ではない。登録された名称、罠、戦闘動詞、生成メッセージは `semantic.c` の記述子へ変換する。カタログ件数は追加の意味IDも含むため、静的リテラルID数とは異なる。

## 型付き引数と動的名称

通常の引数はJSON配列。printfの `*` で幅や精度を指定する場合も、その整数を元の順序で含める。

```json
[{"kind":"signed","value":3},{"kind":"string","value":"user label"}]
```

アイテムなどの `%s` 引数には、Cの元の可視分岐に沿った意味記述子を渡す。

```json
[{"kind":"entity","value":{"type":"item","category":"potion","which":null,"known":false,"identified":false,"appearance":{"kind":"color","id":17,"text":"red"}}}]
```

Rustはこれを「赤色の薬」として使う。未識別の実種類、呪い、能力値を表示に送らない。Cで組み立てたアイテム名を英単語検索で再解釈せず、ポインタと現在の英文の一致を確認した登録情報を使う。自由命名は単なる文字列として保持する。

複数の `addmsg` がつながる場合は `message.sequence` と断片の配列を送る。Cがページを区切った場合も、区切り後の断片を次のメッセージへ正しい順序で残す。

```json
[{"kind":"message_part","value":{"id":"armor.wear.you_are_now","args":[],"fallback":"you are now "}}]
```

戦闘断片には主語・対象の役割と、Cの乱数で選んだ動詞の番号を持たせる。Rustはこの情報から「あなたの攻撃がオークに命中した」のように文全体を組み立てる。訳の `{0}` / `{1}` による引数の並べ替えに対応し、英語の断片順に日本語を並べるだけにはしない。元の幻覚・動詞選択で消費した乱数はCだけが管理する。

生成される巻物の呪文名と自由命名文字列は固有名として原綴りを保持する。Unicodeのプレイヤー名はRustのSessionから注入し、Cの論理処理用ASCII別名を表示に使わない。果物の既定名だけは意味記述子で「スライムモールド」に訳し、任意入力を一般的な文字列置換で変更しない。

オプションの文字入力には、一般の文字列・プレイヤー名・果物の役割をそれぞれモード1/2/3で明示する。名前編集の初期値はSessionのUnicode実名。果物の元の既定値 `slime-mold` は空の編集欄と日本語の `input.default_fruit` placeholderで示す。入力された任意の果物名はそのまま扱い、翻訳した既定表示をCの値へ書き戻さない。

## 英語のページ送りと保存

`--More--` 判定、`look(FALSE)`、入力待ち、先頭文字の大文字化、`huh` の記録順序はC側で保つ。日本語の表示幅や文の長さをCのページ送り判定に使わない。通常の英語ページ区切りは元どおり71文字の境界、英語バッファは143バイト。旧 `vsprintf` / `strcat` は容量を確認する処理に置き換え、長い入力などはバッファ内に収める。

`io_state.h` の `rg_message_state_export` / `validate` / `import` は成功0・失敗-1を返す。exportしたバッファは呼出元が `free` する。151バイトのペイロードはlittle endianの版1、`newpos`、143バイトの `msgbuf`。版、長さ、範囲、先頭NUL位置と `newpos` の一致を検証し、importは検証後のコピーだけを行う。`mpos`、`huh`、`prbuf` はCのロジック保存にも含める。

翻訳用のC断片キューは一時情報であり、復元時に破棄する。一方、Rustの保存エンベロープはIDと引数を持つpresentationを保存し、復元後の日本語の画面・メッセージ再表示に使う。英語バッファとページ送りの状態を復元することで、Moreによる `look(FALSE)` と乱数進行を保つ。

ゲーム終了時は `rg_host_outcome` が死亡・勝利・終了・復元エラーなどの意味IDを使う。日本語の終了画面から古いMoreと再開待ちを取り除き、`input.kind = "ended"` を持つpresentation更新だけを送る。終了後に新しいCフレーム、入力待ち、ターンや乱数イベントを作らない。

## 未登録・不正な入力の扱い

`message.clear` は表示の消去。未登録書式、未対応書式、JSON容量超過、32断片を超える連結は `message.legacy` などの原文fallbackにする。Rustは日本語表示で `missing_ids` と `fallback_used` を出力し、未登録の断片や不正な記述子を空文字として黙って捨てない。表示の検査は、ラテン文字の有無だけでなく、この監査情報を使う。自由命名や巻物の固有名が英字を含むことは翻訳漏れではない。

`message.c` は既存書式の `%s`、`%c`、`%d`、`%ld`、符号指定、`*`、`%%` に加え、符号なし整数や浮動小数点の型付き捕捉に対応する。JSONは引用符、バックスラッシュ、制御文字をエスケープし、UTF-8バイトを保持する。`%n` や不正な長さ指定は拒否し、捕捉処理がメモリへ書き込むことを防ぐ。`CTRL(P)` の再表示は `msg("%s", huh)` で入力由来の `%` を再評価しない。Rustの日本語テンプレートも、挿入した `%` や波括弧を再び書式として読まない。

## 検証資料

- `tests/catalog.test.py` は呼出箇所の解析、選択式、隣接文字列、行変更時のID安定性を検査する。
- `tests/message-capture.c` / `.test.mjs` は型付き引数、UTF-8、JSON、書式と断片捕捉を検査する。
- `tests/message-paging.c` は実際の `io.c` を使い、ページ送り、Cメッセージ状態の保存復元、More時のlook/入力回数、容量境界を検査する。
- `rust/src/bin/entity-check.rs` は名称とRustの日本語メッセージ接続を独立実行し、2026-10-02に **694 checks PASS**。アイテム、所持品キー、戦闘語順、自由命名、未識別の情報保護、未知断片の監査も含む。結果は `tests/entity-check-result.json`。
- 全体のCゲーム・ブラウザ・保存の実動結果は `tests/RESULTS-ja.md` などの全体検証資料を参照する。上のRust単体実行はCゲームループやブラウザを実行していない。
