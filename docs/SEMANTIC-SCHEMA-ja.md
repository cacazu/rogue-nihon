# 動的名称の意味データ

`logic/semantic.c` は、ゲームが既に選んだ名前・外見・数量を JSON として観測する。原本の英語 `inv_name`、戦闘処理、画面記憶、乱数呼出しは維持する。Rust はこの意味データから日本語を組み立てる。英語の完成文を逆翻訳して種類を推測しない。

## 境界と登録の寿命

`semantic.h` の `rg_semantic_argument(text,json,capacity)` は成功 `1`、普通の文字列 `0`、容量不足等 `-1` を返す。呼出し元 `message.c` は成功時のみ `{kind:"entity",value:<descriptor>}` として送る。未登録の文字列は元の文字列として扱い、欠落監査は表示側へ委ねる。

共有 `prbuf` や `set_mname` / `prname` の静的バッファは再利用されるため、登録時に英語値と JSON を両方コピーする。取得時は同じポインタで、現在の英語値も一致する場合だけ登録を使う（`semantic.c:66–74,225–235`）。登録は64枠、英語2048バイト未満、JSON8192バイト未満。通常の自由名が原表の英単語と同じでも、文字列一致から敵やアイテムに変換しない。

原表の直接ポインタだけは種類を判定できる。保存復元で別割当になった外見は、`p_colors` 等の正式な割当配列のポインタから取得し、閉じた原外見表内で外見IDを調べる。これはユーザー文の逆変換ではない。

## アイテム

`things.c:26 inv_name` の元の組立と大小文字変更・切詰めが終わった後（134行）に `rg_semantic_item(prbuf,obj,drop)` を置いた。`prbuf[MAXSTR-1]='\0'` は原本にもある。`things.c:665 nameit` の known / called / 外見分岐、`rings.c:187 ring_num`、`sticks.c:420 charge_str` の可視条件を `semantic.c:127` に対応させた。

主な descriptor は次の通り。

```json
{
  "type": "item",
  "category": "ring",
  "category_code": 61,
  "which": null,
  "count": 1,
  "type_known": false,
  "known": false,
  "identified": false,
  "flags": 0,
  "visible_fields": {"hplus": false, "dplus": false, "ac": false,
                     "charges": false, "ring_bonus": false},
  "appearance": {"kind": "stone", "id": 3, "index": 3, "text": "carnelian"},
  "equipped": "none",
  "describe": true,
  "drop": false,
  "brief": false,
  "terse": false
}
```

`category` は potion / scroll / ring / stick / weapon / armor / food / gold / amulet。原本の ASCII 種別は `category_code` として維持する。

ポーション・巻物・指輪・杖の `type_known` は各 `obj_info.oi_know`。未知の場合は効果の `which` を `null` にする。`identified` は個別アイテムの `ISKNOW`。公開 `flags` に呪い等の隠れたフラグを含めず、`ISKNOW` だけを残す。

武器の hplus/dplus と鎧の ac/protection/enchantment は `ISKNOW` 時だけ追加する。protection は元の `10-o_arm`、enchantment は元の `a_class[which]-o_arm`。指輪 bonus は「種類を知る、または命名済み」かつ `ISKNOW`、さらに原本の四つの数値型だけ。杖 charges も同じ known-or-called / `ISKNOW` 条件。数値が不可視なら JSON キー自体を渡さない。

`label` / `called` / 自由設定 `fruit` は UTF-8 の入力値をそのまま保持する。既知に変わった効果には不要な古い `called` を付けない。`gold` は `o_goldval` であり、個数 `o_count` と混同しない。装備は inv_describe 時のみ weapon / armor / left_ring / right_ring とする。

appearance は color / stone / wood / metal / scroll_title。IDは効果番号ではなく原外見表の番号。杖 subtype は元の wand / staff。巻物のランダム呪文タイトルは `text` のまま保持する。

## 名称の全源

|源|元データ・処理|descriptor / 登録|
|---|---|---|
|武器・鎧・薬・巻物・指輪・杖の基本名/効果名|`extern.c:233,243,259,275,295,307` の6つの obj_info 表|同じ `oi_name` ポインタ→item_name(category,which,form)|
|アイテム全体の表示名|`things.c:26 inv_name` / `665 nameit`|item。英語完成後、表示済みの条件だけ観測|
|色27・石26・木33・金属22|`init.c:81,133,165,204`|appearance(kind,id,text)|
|効果と外見の割当|`init.c:240 init_colors`, `263 init_names`, `297 init_stones`, `319 init_materials`|p_colors / s_names / r_stones / ws_made / ws_type の実ポインタを追跡。追加乱数なし|
|敵26種類|`extern.c:188 monsters`|monster(index)。元表ポインタのみ|
|可視/不可視/幻覚の敵名|`fight.c:350 set_mname`|monster(display,index,article,upper,hallucinated)。幻覚では元コードが選んだ偽名の番号だけ、不可視では実敵番号を省く|
|戦闘の主語・目的語|`fight.c:492 prname`|上の敵/代名詞をコピーして role=subject/object。youは敵番号を持たない|
|命中・失敗の各8表現|`fight.c:22 h_names`, `33 m_names`, `531 hit`, `565 miss`|combat_verb(hit,index)。元の rnd / actor別 +4 の結果を記録。短文 hit は表1。翻訳が乱数を選び直さない|
|メデューサの凝視|`monsters.c:190` の既存 set_mname 呼出し|同じ敵descriptorへ到達、monsters.c自体は変更なし|
|罠8種類|`extern.c:77 tr_name`|同じポインタ→trap(index)|
|死因|`rip.c:501 killname` の敵A–Z・arrow/bolt/dart/hypothermia/starvation・その他|death(code,article,index?)。元killname結果に登録|
|魔法の投射物|`sticks.c:315` が fake `weap_info[FLAME].oi_name` に選んだ bolt/flame/ice を設定し、fight thunk/bounceにも渡す|同じ正式table pointerだけ term(projectile.bolt/flame/ice)へ。任意の英語値からは推測しない|
|プレイヤー名|`extern.c whoami`、scoreへのコピー|player_name marker。Rust Sessionが実Unicode名を表示時注入|
|食べ物名|`extern.c fruit`|fruit(value,default)。既定名だけ辞書化し、自由名は変えない|
|呼出し元が選ぶ静的語句|`rg_semantic_register_term`|term(id)。get_item目的・方向質問等は各担当の呼出し元で登録|
|組立済みの動的メッセージ|`rg_semantic_register_message`, `rg_semantic_copy`|message(id,args)。薬のジュース文や直前メッセージ履歴で利用|

武器の FLAME は魔法/ドラゴンの投射物用の偽エントリーであり、通常の所持武器9種類の名前ではない。`wizard.c:100 type_name` の category 登録、`misc.c` の方向語、`pack.c` の操作目的、`potions.c` の感覚語/ジュースは root 担当。`vowelstr` の英語冠詞、`num` の英語書式は C に維持し、日本語は上の数値/文法から組み立てる。

## 終了画面

`rip.c` の private `rg_ending_line` は型付き引数を取り、score / death / tombstone / victory に UI ID を送る。scoreの `killname` と勝利の `inv_name` は元の一回の呼出し結果を利用する。ASCII墓石・勝利文字絵・元表示位置・得点・識別変更・乱数を変えず、日本語画面は Rust/DOM の表示で置換する。`locales/endings-en.json` と `endings-ja.json` に27 IDを追加した。

このメタデータは論理保存や20語の検査ハッシュに含めない。Cの静的登録は復元用状態ではなく、表示履歴の保存・再生は Rust presentation checkpoint が担う。

## 検証

`tests/semantic-capture.c` と `semantic-capture.test.mjs` を Emscripten/Node で実行済み。未知効果の番号非公開、可視の数値条件、呪いフラグ非公開、日本語と `%s%n%%` を含む自由名の保持、元バッファ変更後のコピーの保持、再利用ポインタの不一致拒否、容量不足、幻覚の偽名、player_name のコピー、seed不変を検証した。最終 syntax検証は semantic.c / things.c / fight.c / rip.c の4ファイルを通過。

実ゲームの死亡・勝利・戦闘・SEEINVISは `tests/game-localization.test.mjs` が担当し、追加6件すべて通過した（skip0 / exit0）。5件は EN/JA間と原本ルールbaseline間の20語・入力位置・全英語Cフレーム・最終状態が一致。自由名の `%s%n%%` を含むSEEINVISの1件は EN/JA間で比較した。すべての実測JAメッセージとUIは欠落ID/fallbackなし、Unicodeプレイヤー名と果物を保持し、通常死亡の英語C画面の全面マスクも確認した。

実行ログは `tests/final-localization-run.txt`、17ファイルの実行記録は `tests/localization-results/` にartifact SHA256付きで保存した。これらは今回実行した枝の証拠であり、全コマンド・全魔法・全死因の組合せを網羅したと読み替えない。

ただし自由fruitに `%s%n%%` が含まれる場合、原本の `msg(動的fmt)` は存在しない可変引数を読む未定義動作となる。その入力の原本は実行せず、分離版の EN/JA 同一性と文字列の保持を検証する。SEEINVISの原本比較には既定fruitを使う。

実More保存・復元の追加1件も `tests/game-more-localization.test.mjs` で通過した。二重加速fixtureに `qf` を入力し、Cの `--More--` が実際に出ているSpace待ちで保存した。読み取り専用の `run-game.mjs` 観測で、その瞬間の画面・typed `ui.more`・`input.wait_space`・pending=1・input_index=2を記録して検証する。自動睡眠が既に次のcommand checkpointへ進んでいるので保存journalは空であり、復元はその保存済みcommandからMore画面を再構築する。

新しいWasmインスタンスの復元は全20語・乱数・入力位置・最終C状態・Spaceを受け取ってからの全C画面・最終日本語UIが一致し、英語表示と独立原本baselineにも全C画面と状態が一致した。すべての実測JA UI/messageの欠落IDはゼロ。ログ `tests/final-more-localization-run.txt` と `tests/more-localization-results/` の4記録にSHA付き証拠を保存した。ゲームC/Rust/生成Wasmは変更せず、テストの観測とこの追加検証だけを加えた。
