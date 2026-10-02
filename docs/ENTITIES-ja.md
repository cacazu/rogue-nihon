# 動的名称の日本語表示

`rust/src/entities.rs` の `render(&serde_json::Value, language)` は、Cが渡した可視情報だけを使って、アイテム名・外見・モンスター名・罠・死因・戦闘文を組み立てる。Cのゲーム状態や乱数を参照しない。表示を繰り返してもゲームの識別状態、乱数、ターンは進まない。

名称は `locales/entities-en.json` / `entities-ja.json` の同じ408件の意味IDで管理する。例は `item.weapon.mace`、`item.potion.healing`、`appearance.color.amber`、`monster.orc`。数量、強化値、命名、装備状態を35個の語形テンプレートで組み立てる。

## 元データとの照合

`tools/generate_entities.py` はCの静的初期化子を読み取り、作業コピーと保護されたRogue 5.4.4原本の文字列および並び順が一致することを確認してからEN/JAペアを生成する。ゲームコードは実行しない。各表の出典、件数、NULで連結した元英文のSHA-256をJSONの `source_tables` に記録する。

| 元データ表 | 件数 | 出典 |
|---|---:|---|
| 武器 / 防具 | 9 / 8 | `extern.c:weap_info / arm_info` |
| 薬 / 巻物 / 指輪 / 杖の効果 | 14 / 18 / 14 / 14 | `extern.c:pot_info / scr_info / ring_info / ws_info` |
| モンスター / 罠 | 26 / 8 | `extern.c:monsters / tr_name` |
| 薬の色 / 指輪の石 | 27 / 26 | `init.c:rainbow / stones` |
| 木材 / 金属 | 33 / 22 | `init.c:wood / metal` |
| 命中 / 回避の動詞断片 | 8 / 8 | `fight.c:h_names / m_names` |
| ランダム巻物名の音節 | 147 | `init.c:sylls` |

15表すべて原本との一致を確認した。147音節には重複があるため、音節IDは146件になる。生成される巻物名は呪文の固有名として原綴りを保持し、日本語では `「foo bar」と記された巻物` のように表示する。元表の曖昧な木材名 `fall` / `cinnibar` は、植物名を推測せず「フォール材」/「シナバー材」とした。

## Cから受け取る情報

C側の `logic/semantic.c` / `semantic.h` は、`things.c:inv_name / nameit`、`fight.c:prname / set_mname`、`rip.c:killname` などの元の分岐に沿って表示用JSONを作る。`rg_semantic_argument()` は、登録したポインタと現在の英文が一致する場合に記述子を返す。意味のない普通の文字列は文字列のまま渡す。

主なアイテム記述子は次の形を取る。

```json
{
  "type": "item",
  "category": "potion",
  "category_code": 33,
  "which": null,
  "count": 1,
  "known": false,
  "type_known": false,
  "identified": false,
  "appearance": {"kind": "color", "id": 17, "text": "red"},
  "equipped": "none",
  "visible_fields": {"hplus": false, "dplus": false, "ac": false, "charges": false, "ring_bonus": false}
}
```

この例は「赤色の薬」と表示する。薬・巻物・指輪・杖が未識別なら、Rustは `which` が誤って渡されても実種類を使わない。両方ある場合の `known` / `type_known` は、両方が真のときだけ既知として扱う。武器・防具の種類は元から見えるが、命中・威力、防御力、杖の残り回数、指輪の数値は `identified` と元の可視分岐、および `visible_fields` に従う。隠れた呪いは表示に送らない。

防具は元の降順ACから `protection = 10 - ac` を表示する。強化値は `a_class[which] - ac`。金貨は `o_goldval` を使い、部屋の金貨が `o_count == 0` で作られる元の分岐にも対応する（`rooms.c` の金貨生成と `things.c:inv_name` の金貨分岐）。

対応する追加記述子は `item_name`、`item_category`、`appearance`、`trap`、`monster`、`death`、`fruit`、`combat_verb`、`combat`。モンスターの `display: "it" / "something"` は隠れた `index` に関係なく代名詞を表示する。幻覚中はCが元の乱数で選んだ表示モンスターをそのまま訳す。

## 日本語の組み立て

| 可視情報 | 日本語表示例 |
|---|---|
| 識別済み武器、命中+1・威力+1、装備中 | `メイス（命中+1・威力+1）（武器として装備中）` |
| 同じ矢を複数所持 | `矢 ×3` |
| 防具、強化+1、防御力4 | `+1リングメイル［防御力4］` |
| 杖の識別済み残り回数 | `…［残り3回］` |
| 食料2個 / 金貨123枚 | `食料2食分` / `金貨123枚` |
| プレイヤーがオークに命中 | `あなたの攻撃がオークに命中した` |
| オークがプレイヤーをかすめる | `オークの攻撃はあなたのすぐ脇を通り過ぎた` |

戦闘の主語・対象は `monster.role`、動詞は `combat_verb.hit / index` で受け取る。`display.rs` は連結された英語断片からこの意味情報を取り出し、`entities.rs` に戦闘全体を渡す。Cが選んだ動詞の番号は維持し、日本語の助詞と語順を専用テンプレートで決める。

自由命名、任意の果物名、プレイヤー名はUTF-8の入力をそのまま挿入する。 `%` / `{name}` のような入力を再び書式として評価しない。既定の果物 `slime-mold` は意味記述子の既定値として「スライムモールド」にする。明示的に任意名として渡された同じ文字列は原文のまま保持する。

Cの `player_name` 記述子は値を持たず、本番ではRustのSessionにある実際のUnicode名を `literal` に注入する。単体rendererは `player_name.value` がある場合だけその文字列を返し、値がない場合は `None` を返す。C側のASCII別名を表示に漏らさない。

## 実行した検証

2026-10-02、既存のRust 1.98.1、Emscripten 6.0.8、Node 24.19.0を使い、次を実行して **694 checks PASS**。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/check-rust-layers.ps1 -Binary entity-check
```

`rust/src/bin/entity-check.rs` は `entities.rs` と純粋な `display.rs` を直接読み込む。EN/JA IDの一致、408件の非空訳、15表の件数、全77種類の武器・防具・魔法効果、全108種類の外見、26モンスター、8罠、未識別4カテゴリーの実種類非依存、隠れ能力値、数量・装備・残り回数、自由命名、果物、金貨の `o_count == 0`、死因、戦闘文を検査した。表示との接続ではアイテム行、所持品キー、日本語の戦闘語順、Unicodeの実名、および未知断片の `missing_ids` 通知を検査した。

結果は `tests/entity-check-result.json` に記録した。この実行はCゲームループ、ブラウザ描画、ストレージの実動確認を含まない。それらの結果は全体の検証資料を参照する。元の英語ゲームロジック、原本、および乱数選択はこのrendererでは変更しない。
