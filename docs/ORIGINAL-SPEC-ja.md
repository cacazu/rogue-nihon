# 原作仕様とWeb版の対応

## 対象と比較元

原作はRoguelike Restoration Project Rogue 5.4.4。原配布は [Rogueforge](http://rogue.rogueforge.net/files/rogue5.4/rogue5.4.4-src.tar.gz)、取得元は [MacPortsミラー](https://distfiles.macports.org/rogue/rogue5.4.4-src.tar.gz)。取得アーカイブは209,839 bytes、SHA-256は `7d37a61fc098bda0e6fac30799da347294067e8e079e4b40d6c781468e08e8a1`。版とarchive hashで原作を識別する。

`logic/` はWeb対応を加えた派生ソース。`tests/baseline-src/` は原作ルールへWasm接続・観測・保存を加えた比較版であり、無変更の原本ではない。根拠は [baseline-provenance.json](../tests/baseline-provenance.json)、[baseline-diffs](../tests/baseline-diffs/)、[baseline-source-audit.json](../tests/baseline-source-audit.json)、[split-provenance.json](../tests/split-provenance.json)、[split-diffs](../tests/split-diffs/)。取得原本はローカルの監査入力で、Web起動に不要である。

## 維持する仕様と変更する仕様

| 原作の仕様・入口 | Web版での対応 | 実装 |
|---|---|---|
| command、BEFORE/AFTER、加速・睡眠、反復、waste_time | Cの呼出し順・行動機会・時間消費を維持 | `command.c / daemon.c / daemons.c / armor.c` |
| 32 bit LCG乱数 | seedのbit patternと消費順を維持。符号付きoverflowを明示的なu32 wrapへ置換 | `core.c:rg_random_next`、`extern.h` |
| 英語ASCII画面、探索記憶、幻覚・擬態 | Cの表示結果を観測し、Rustが翻訳・画像へ変換 | `knowledge.c / semantic.c` |
| 一般メッセージのMore | 通常Web操作はログへ流してSpace確認を省く。look・英語bufferの更新順は保持 | `io.c:rg_wait_message_ack`、platformの `MessagePaging` |
| 一覧・検出・設定・結果の入力待ち | 待つCキーを維持し、RustのボタンとEnter/Esc変換を追加 | `io.c:rg_wait_for`、`input:decode_in_window` |
| 所持品 `i` | 公開済み一覧からRustの操作メニューを追加。確定操作を元のCコマンドへ送る | display/inputの `inventory.rs` |
| ASCII名前・命名編集 | UTF-8とUnicode scalar単位の消去を追加。原作の50 byte上限を保持 | `options.c:get_str/strucpy` |
| 端末save/restore | byte checkpoint＋入力再生＋IndexedDBへ置換。旧端末save互換は提供しない | `save_adapter.c`、platform |
| shell、signal、tty、OS score、環境による実行制限 | shell/process/実ユーザーファイルを使わないhost構成。scoreはセッション内 | `core.c / platform_md.h / platform_system.h`、`mach_dep.c` |
| daemon/fuseのcallback | Wasmの型に適合。`turn_see(bool)` だけ有引数、他の12種類は無引数 | `daemon.c` |
| 動的文字列のprintf、品物label共有 | `msg("%s", huh)`、bounded formatting、labelの深いコピーへ安全修正 | `command.c / message.c / pack.c` |

開始seed・名前・optionsはhostから渡す。時刻/PIDによるseed決定、home探索、権限変更、shell escape、score file/lock、saveの任意パス・unlink、alarm・process-group操作はブラウザーのゲームルールへ持ち込まない。

## コマンドの入口と後続入力

原作コマンドの正本は `logic/extern.c:helpstr` と `logic/command.c:command`。ヘルプのShift/Ctrl説明行を独立コマンドとして数えない。UI操作はキーを入力層へ渡し、Cが受け付ける次の入力待ちで方向・対象・手・文字を送る。

| 操作 | 原作側の処理・後続入力 | Web側の判断 |
|---|---|---|
| h/j/k/l/y/u/b/n、方向キー、Shift/Ctrl、数字、再実行 `a` | move、走行・通路追跡・反復、直前方向の再利用 | 物理キーをCキーへ変換。投げる方向待ちでは修飾キーも一方向に正規化 |
| 投げる `t`、杖 `z` | get_dirの方向入力後にget_itemの品物選択 | 持ち物メニューからの投げる方向は通常地図で選ぶ。失敗・取消で予約を破棄 |
| 飲む `q`、読む `r`、食べる `e`、構える `w`、着る `W`、落とす `d` | get_item、効果・装備・配置のC判定 | 公開済みの種類・装備・鑑定状態から候補を作る |
| 脱ぐ `T`、指輪 `P/R` | 装備確認、左右の手、呪い等の判定 | 装備に合う操作を出す。隠れた呪いによる失敗はCに委ねる |
| 名付け `c`、識別の巻物 | 対象選択、文字入力、識別の二段目の対象入力 | 自由名はUTF-8のデータ。途中取消や追加対象を省略しない |
| 持ち物 `i`、一品確認 `I`、選択中 `*` | inventory、公開済みdescriptor、一覧の閉じる待ち | 一覧・詳細・戻るは表示操作。確定後だけCの操作を実行 |
| 発見一覧 `D`、ヘルプ `?`、記号説明 `/`、設定 `o` | 分類・全件・ページ送り、個別説明、値編集 | 原作の選択キーと待ちを維持。スクロールはC入力にしない |
| 探索・待機・拾う・階段・状態・装備・再表示・直前メッセージ・版 | commandの各分岐 | 無料/時間消費の判定はCが行う |
| 保存 `S`、shell `!` | Webでは案内を返す無料操作 | 保存本体はブラウザー設定から実行。shellを起動しない |
| 終了 `Q`、死亡、勝利 | 確認、精算、得点、終了 | 各Space/Enter待ちを順に完了してからトップへ戻る |

候補の絞り込みは表示済み情報だけを使う。装備済み武器・指輪や埋まった装備枠、鑑定済みで名付け不能な品物を候補から除く。武器と鎧の個別命名は維持する。表示済みの階段・扉・罠の上では「落とす」を出さないが、足元が不明な場合やキーボード直入力の配置判定はCが行う。

スマホの通常地図は8方向・待機・持ち物・操作一覧、表示済みの足元が階段のときだけ階段操作を出す。投げる方向待ちは8方向と取消だけ。品物・文字・手・確認の待ちはゲームウインドウの操作を使う。PCの地図操作はキーボードを使う。

## Space・Enter待ちの対応

| 利用場面 | Cの経路・条件 | UIと入力 |
|---|---|---|
| 所持品・選択中の一覧・発見一覧の最終ページ | `inventory/discovered → add_line` | 閉じる。Space、Enter、EscをCのSpaceへ |
| 長い一覧の途中 | `add_line` の行数境界と残り項目 | 次のページ。Cが取消を受けない待ちなのでEscもSpaceへ |
| 所持品の1行ずつ表示 | `msg_esc=TRUE → endmsg` | 次の品物。EnterはSpace、Esc/閉じるはCの取消へ |
| 全コマンドヘルプ、設定編集の終了後 | `command.c:help / options.c:option` | 閉じる。編集中のEnterは次の項目へ進む |
| 魔法探知の薬・食料探知の巻物 | 検出対象があるときの `show_win` | 検出マップを閉じる。対象なしは通常ログ |
| 勝利の祝福→戦利品精算 | `rip.c:total_winner` | Spaceで結果を見る。次のEnter待ちはスコアを見る |
| 死亡・終了・得点 | 各結果のEnter待ち | スコアを見る/終了する。結果ウインドウのEscはEnterへ |
| 一般メッセージの旧More | `io.c:rg_wait_message_ack` | legacy区間だけSpace待ち。通常Webはlog方針 |

空の所持品と通常形式で一品だけの一覧はメッセージとして戻り、Space待ちはない。所持品は最大23枠。発見一覧の1行表示は所持品と異なりmsg_escを立てない。MASTER専用全体マップ等は通常ビルドの対象外。

Enter/Escの追加受付は原作からの意図した変更である。`i → Enter → .` は原作のSpace待ちを閉じないが、Webでは閉じて休息する。比較する際はWebの変換後Cキー列と原作キー列を揃える。

旧saveのMoreを含む入力履歴はlegacyのまま再生する。`message_paging_legacy_until` で旧記録区間の終端を保持し、その後のライブ入力はlogへ切り替える。再生中に再保存しても境界を引き継ぐ。一般メッセージの確認を省くために、仮のSpace入力をjournalへ追加しない。

## ターン・乱数の対応

RNGは `seed = seed * 11109 + 13849` の32 bit wrap、戻り値は上位16 bit。`rnd` の呼出しを翻訳や画像選択でやり直さない。原式を使うbaselineも32 bit intと `-fwrapv` でビルドする。

原作のlookは単なる再描画とは限らない。敵の起床・メデューサの凝視・幻覚表示が状態やRNGを更新する。`endmsg` の前メッセージがある場合の `look(FALSE)`、取消後に次commandへ戻るlookも維持する。ターン不変だけではRNG不変を意味しない。ブラウザーのキャッシュ再描画とCのlookを区別する。

次の表は原作コードから得た期待仕様であり、実行済みcoverageの一覧ではない。位置・食料等は固定room、hero=(10,10)、food=1000を基準とし、記載した乱数分岐・効果を与えた場合の結果である。

指輪/Amuletを持たず、通常はAFTERのstomachだけを有効にして敵移動・徘徊の影響を除く。論理map・画面記憶・oldpos/oldrpを整合させる。乱数分岐を固定する場合はseedと呼出し位置を揃え、試験専用RNG transcriptを通常の固定seed比較へ代用しない。

| # | 状態と入力 | 期待する結果 |
|---|---|---|
| 1 | 左隣は壁。`v Space Esc h .` | 全入力を消費して食糧999、位置不変。Version 1 回。Space/取消/壁衝突は追加周期を消費しない |
| 2 | 開始時 haste。開けた床で `l v l` | x=12、食糧999、3 キー消費。無料 Version は 2 回の移動機会を減らさない |
| 3 | 通常速度、pack a は haste 薬。`q a l`、期間 rnd(4)=0 | 薬消費/識別、x=11、食糧999、haste 期限3。続く `l l` は x=13、食糧998、期限2。薬を飲んだ command 内の行動機会は即時2へ増えない |
| 4 | haste 中に追加 haste 薬。`q a Space l`、rnd(8)=3 | 最初の command 後は haste 解除/期限予約消去、no_command=1、食糧999、位置不変、Space/l が未消費。次は no_command=0/食糧998、Space を More 応答へ消費して l は残る。次の通常移動で x=11/食糧997 |
| 5 | haste、no_command=3、queue に `l` | 1 周期後 no_command=1、食糧999、l 未消費。次の周期で停止解除と l の移動が起き、x=11/食糧998。停止カウンタは加速の各行動機会で減る |
| 6 | `999.`、後ろに sentinel `l` | 255 休息後は食糧745、位置不変、count=0、入力消費は4文字、l は残る。別ケース `3v.` は Version 1 回/食糧999/count=0 |
| 7 | 1 command は `m l`、次は `m Esc a` | x=11/食糧999 → x=12/食糧998。2 回目は3キーのみ消費し、再実行 a が追加方向入力を要求しない。方向取消は直前の再実行情報を復元する |
| 8 | pack b に通常防具。`W b` または着用済み `T` | 成功時は food998、識別/装備更新。脱衣後も所持品保持。呪いによる T 拒否は food999/装備保持。未装備 `T .` は food999。haste 期限1の着用途中失効でも command の残り移動機会は維持する |
| 9 | 隣接する非起床 mean 敵。`v .`、起床 rnd(3)=0,1 | 1 回目の look では眠ったまま、無料 Version 後の look で起床・hero 追跡。食糧999/位置不変、起床乱数2回。UI 操作を省略して look を減らす実装を検出する |
| 10 | 隣接 M は起床済み/未 ISFOUND/能力有効。`v .`、save 失敗/効果時間 rnd=0 | M ISFOUND、hero 混乱、視線メッセージ1回、解除予約1件/残時間18、food999。別ケースの look(FALSE) では wake/gaze によるこれらの変更はない |
| 11 | 幻覚、上段 potion/既知階段/起床済み K。look(FALSE) を after=TRUE → FALSE | 初回は potion rnd(9)+K rnd(26)、次は K rnd(26) のみ。既知階段は階段表示、原 map/物品/敵種別不変。visuals は after=FALSE または running&&jump のとき表示/RNG変更0 |
| 12 | `msg("alpha")` → `msg("beta")`、queue `l Esc Space .` | 通常 More は l/Esc を無視して Space まで消費、Alpha--More-- → Beta、`.` は残り、移動/時間経過なし。msg_esc=TRUE は Esc 復帰、未表示文破棄、mpos/newpos=0、huh は既に beta。幻覚版では More の look(FALSE) の乱数も比較する |

根拠は原作のcommand、potions、miscのlook/get_dir、armor、things、pack、monstersのwake_monster、ioのendmsg、daemonsのvisuals/stomach。Webの通常log方針では表中のlegacy More応答を要求しない。試験fixtureの具体的な状態・入力列は `tests/game-fixtures.c` と `game-fixtures.test.mjs` で確認する。

## 原作比較の判断基準

比較は同じseed・options・名前・C入力列・fixtureを使い、入力待ちごとの20 u32状態、input_index、原英文画面のcells/width/height/player/stats、最終状態・outcomeを照合する。翻訳metadataやUIの追加情報をraw英文画面の同一性判定へ混ぜない。復元は直後のsnapshotだけでなく、次の反復・再実行・入力待ちまで継続して確認する。

baselineも起動・仮想curses・host I/O・Rust層・保存codec・観測hashを共有する。共通adapterの誤りや独立native curses版全体の互換性はこの比較だけでは分からない。fixtureは到達した効果のルール比較に使い、自然seedからその状態に至る経路の証明には使わない。

原本のlabel浅い共有や任意名のprintf再解釈などの未定義動作を再現目標にしない。Unicode入力はWeb拡張、label深いコピーやpercent再表示は安全修正として別に確認する。未実行の分岐や過去の成功件数を現在の互換保証へ読み替えない。比較buildの作り方は [tests/README](../tests/README.md) を参照する。
