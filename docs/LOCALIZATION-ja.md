# 日本語化と意味データの契約

Cが元の表示経路で選んだ意味ID・引数・可視情報をRustへ渡し、Rustが日本語を組み立てる。英語完成文の逆解析、翻訳のための乱数再実行、未鑑定の効果・隠れた能力の読取りを行わない。原作のページ送りとの差分は [原作仕様との対応](ORIGINAL-SPEC-ja.md)、状態の所有者と保存は [実装の判断](IMPLEMENTATION-ja.md) に定義する。

## カタログと生成元

| EN/JAペア（locales/） | 用途 | 生成・利用箇所 |
|---|---|---|
| `en.json / ja.json` | msg/addmsgの意味IDと書式 | `tools/generate_catalog.py`、`logic/message_catalog.inc`、display |
| `ui-game-en.json / ui-game-ja.json` | 操作説明・選択・Cが直接描く画面文 | `tools/generate_game_ui.py`、Cのrg_ui通知 |
| `runtime-en.json / runtime-ja.json` | 所持品行・能力表示・入力待ち | presentation/display |
| `endings-en.json / endings-ja.json` | 死亡・勝利・得点・売却 | `rip.c:rg_ending_line` |
| `ui-web-en.json / ui-web-ja.json` | ブラウザー操作・保存・エラー | browser-displayのpolicies |
| `entities-en.json / entities-ja.json` | 動的名称・外見・語形 | `tools/generate_entities.py`、`display/src/entities.rs` |

ファイル名と行番号は呼出箇所の照合に使う。意味IDは関数と内容に基づき、再生成時は既存IDを維持する。英語のprintf書式・関数・ソース位置をmetadataとして持つ。EN/JAのIDとplaceholderを一致させる。カタログ件数はJSONを正本とし、文書へ複製しない。`coverage.json` のdynamic分類は未訳件数ではない。

名称生成はCの静的初期化子を読む。原作との件数・文字列・並び順を照合し、各表の元英文をNULで連結したSHA-256を `source_tables` へ記録する。

| 元データ | 原作の表・処理 |
|---|---|
| 武器・鎧・薬・巻物・指輪・杖 | `extern.c:weap_info / arm_info / pot_info / scr_info / ring_info / ws_info` |
| モンスター・罠 | `extern.c:monsters / tr_name` |
| 薬の色・指輪の石・木材・金属 | `init.c:rainbow / stones / wood / metal` |
| 外見と効果の割当 | `init_colors / init_names / init_stones / init_materials` |
| 戦闘動詞 | `fight.c:h_names / m_names` |
| ランダム巻物名 | `init.c:sylls`。生成済み表題は原綴りの固有名として保持 |

曖昧な原木材名fall/cinnibarは植物を推測せずフォール材/シナバー材とする。音節に重複があるため元表の項目数と意味ID数を同一視しない。FLAMEは魔法投射物の偽武器エントリーで、通常所持武器とは分ける。

## Cの捕捉と登録の寿命

`rogue.h` のmsg/addmsgマクロが呼出元と可変引数を `rg_msg / rg_addmsg` へ渡し、`io.c:endmsg` が `rg_host_message(id, arguments_json, legacy_english)` を通知する。printfの幅・精度に使う `*` も元の順序の整数引数として捕捉する。

`semantic.h:rg_semantic_argument(text,json,capacity)` は成功1、普通の文字列0、容量不足等-1。成功時だけ `{kind:"entity",value:descriptor}` を渡し、通常の文字列はデータのまま扱う。

prbuf、set_mname、prname等の再利用bufferは登録時に英語値とJSONの両方をコピーする。同じポインターで現在の英語値も一致する場合だけ登録を使う。登録は64枠、英語2048 byte未満、JSON8192 byte未満。原表への直接ポインターと正式な割当配列から外見IDを得るが、自由名が元表の英単語と同じという理由ではentity化しない。

| 表示源 | 通知する意味 |
|---|---|
| `things.c:inv_name / nameit` | 元の名称組立後のitem descriptor |
| `fight.c:set_mname / prname` | 可視・不可視・幻覚の表示名、主語/目的語 |
| `fight.c:hit / miss` | 元の乱数が選んだcombat_verb番号 |
| `rip.c:killname / rg_ending_line` | 死因、墓碑・勝利・精算・得点の型付き引数 |
| `pack.c:get_item / misc.c:get_dir / wizard.c:type_name` | 選択目的、方向、品物categoryのterm |
| `potions.c` の感覚語・ジュース | termまたは意味ID付き生成message |
| `sticks.c` のbolt/flame/ice | 正式なtable pointerからprojectile term |
| `whoami / fruit` | player_name marker、自由果物名と既定値の区別 |

## アイテムの可視条件

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
  "visible_fields": {
    "hplus": false, "dplus": false, "ac": false,
    "charges": false, "ring_bonus": false
  }
}
```

この例は「赤色の薬」。薬・巻物・指輪・杖のtype_knownは原作のoi_know、identifiedは個体のISKNOW。未鑑定ならwhichはnullとし、rendererも誤って届いた実種類を使わない。known/type_knownが両方ある場合は両方が真のときだけ既知にする。

| 情報 | 原作と対応する公開条件 |
|---|---|
| 武器hplus/dplus、鎧ac・protection・enchantment | ISKNOW時だけ数値を送る。protection=10-o_arm、enchantment=a_class[which]-o_arm |
| 指輪bonus | 種類既知または命名済み、かつISKNOW、かつ原作の数値型4種 |
| 杖charges | 種類既知または命名済み、かつISKNOW |
| flags | 隠れた呪い等を含めずISKNOWだけ |
| 外見 | color/stone/wood/metal/scroll_title。idは効果番号ではなく外見表の番号 |
| 装備 | inv_describe時だけweapon/armor/left_ring/right_ring |
| 金貨 | o_goldvalを使用。原作のcount=0生成も許容 |
| label/called/fruit | 自由入力をUTF-8で保持。効果既知になった後の不要なcalledは表示しない |

数値が不可視ならJSONキー自体を送らず、Rustもidentified・visible_fieldsに従う。categoryはpotion/scroll/ring/stick/weapon/armor/food/gold/amulet、category_codeは原作のASCII種別。杖のwand/staff subtypeと外見は別情報として持つ。

追加descriptorはitem_name、item_category、appearance、trap、monster、death、fruit、combat_verb、combat、term、message。不可視のmonsterはit/somethingとして実indexを省き、rendererも隠れindexより表示種別を優先する。幻覚ではCが選んだ偽名の番号だけを訳す。

## 文章・名称の組立

`display/src/entities.rs:render` はdescriptorだけから名称を作る。数量・装備・強化値等は語形テンプレートを使う。戦闘はmonster.roleとcombat_verb.hit/indexから主語・対象・助詞を組み直す。英語断片順をそのまま日本語へ連結しない。

複数addmsgはmessage.sequenceとmessage_part配列として順序を保持し、Cのページ区切り後の断片も失わない。訳の `{0}/{1}` は引数順の変更に使う。英語冠詞・複数形・printf幅を日本語で省略する場合はカタログmetadataに理由を残す。

player_nameはCのASCII aliasでなくRust SessionのUnicode実名を表示時に注入する。既定fruitだけスライムモールドに訳す。同じ綴りでも任意名として渡された文字列は原文を保持する。名前や `%s%n%% / {name}` を書式として再評価しない。

## UTF-8入力と画面文

開始名はUTF-8で49 byte、ゲーム内get_strの名前・命名は50 byteまで。途中byteで切らず、不正UTF-8・過長符号化・surrogate・不正Unicode値を保存しない。BackspaceはUnicode scalar単位であり、結合文字や複合絵文字全体を消す書記素編集ではない。DELはCのerasechar()==8へ正規化してjournalへ記録する。

通常commandはASCIIのみ。Cが示した文字入力モードでだけUnicode scalarをUTF-8 byteへ変換する。モード1は一般文字列、2はプレイヤー名、3は果物。IME未確定のkeydownをゲームへ送らない。開始名はRustで保持し、Cの知識画面にはASCII alias/安全なplaceholderを使う。

元のget_strのEscは途中入力を文字列へ反映してQUITを返す。空Enterで名前を保持するときはaliasで実名を上書きしない。果物の既定値は空欄とplaceholderで示し、翻訳した既定表示をCへ書き戻さない。

ブラウザーのネイティブ入力欄にある未送信の草稿はEscで取り消し、Cへ確定しない。すでにCが受け取ったbyteに対するget_strの処理とは区別する。保存時だけは草稿をCへ反映して入力待ちを保存する。

ヘルプ・設定・品物選択・一覧・終了はCの意味通知からRustのゲームウインドウへ変換し、Canvasへ描く。日本語の文字幅・折り返し・スクロールでCの行数判定・ターン・RNGを更新しない。終了後はinput.kind=endedのpresentationだけを更新し、新しいC入力待ちやフレームを作らない。

## 欠落・不正データ

未登録書式、不正descriptor、容量超過、32断片を超える連結は原文fallbackとし、missing_ids/fallback_usedへ記録する。自由名や巻物表題の英字を翻訳漏れと判定しない。日本語検証では監査値を確認する。

CはJSONの引用符・backslash・制御文字をescapeし、UTF-8 byteを保持する。%nと不正な長さ指定は拒否する。通常のsigned/unsigned/float、%s/%c、符号・幅・精度・*・%%は型付きで捕捉する。buffer容量は守り、翻訳失敗を空文字として黙って捨てない。

英語msgbufと論理ページ送り状態はC保存、意味ID・引数付きの表示履歴はRust presentation保存が担当する。Cの一時登録・断片キューを復元状態として扱わない。
