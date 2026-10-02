# 原作の周期・視認・対話を確認する回帰ケース

以下は取得原本を静的に確認した **fixture 用の期待契約・当初案**。この表の全分岐を動的実行したという意味ではない。実装後に実行した範囲は末尾と `RESULTS-ja.md` に記録した。

共通 fixture は明るい固定 room、`hero.y=10, hero.x=10`、`food_left=1000`、指輪/Amulet なし。通常は AFTER の stomach のみを有効にし、敵移動/徘徊の影響を除く。部屋・論理 map・画面記憶・oldpos/oldrp は整合して初期化する。食糧、位置、所持品、効果、入力残数など観測可能な結果を検証し、ntimes 等の実装をテストに写さない。

乱数分岐に特定の値が必要なケースでは、採用した LCG/32 bit 方針でその値を与える seed/呼出し位置を確認する。試験専用 RNG transcript を使う場合は両実装で同じものを使い、消費回数を記録する。その結果を実ゲームの固定 seed 同等性テストに代用しない。

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

根拠: `command.c:24–45/71–145/246–256/339–347/441–454`、`potions.c:188–193`、`misc.c:27–113/190–210/383–397/463–514`、`armor.c:20–89`、`things.c:176–194`、`pack.c:385–442/498–503`、`monsters.c:151–194`、`io.c:68–104/247–257`、`daemons.c:128–132/242–284`。

本番 module の20 word snapshot だけではすべての予約/表示/入力残数を直接観測できない。必要な観測点は fixture 専用 trace へ追加し、通常 UI に内部秘密を公開しない。ゲームの通常 Node/browser regression では、同じ原本 baseline と分離版を同 seed/input/options で走らせ、入力待ちごとの trace と純粋な repaint を比較する。

## 実装した fixture の範囲

`game-fixtures.c` と `game-fixtures.test.mjs` は、原本ルール baseline と分離版へ同じ誘導状態を作る。実装した12比較は、壁と無料操作、初期加速、加速薬、二重加速の失神、加速中の睡眠、255回反復、無料操作の数字反復、方向取消と再実行、防具の時間消費、敵の起床、Medusa視線、幻覚時のcommand再描画。入力待ちごとの20 word/input_indexと全英語画面を比較する。実際のMore入力は二重加速の失神ケースで通る。

実装した共通fixtureは初期5品の所持品、薬の入力文字f、HP100、AFTERのrunners/doctor/stomachを使う。徘徊予約は外し、敵起床後の原作AI/戦闘処理も両版で走らせる。さらに加速行動間・加速薬選択・幻覚中command境界のfresh module復元3件と、Ctrl+Pのpercent文字列再表示を追加し、fixture suiteは17/17件通過した。歴史的なraw名 `hallu-more/hallu-midmore` は残すが、両記録のMore画面は0であり、幻覚中Moreの待機・復元は未検証である。

上表の全分岐を網羅したという意味ではない。呪いによる脱衣拒否、着用途中の加速期限切れ、直接呼び出すlook(FALSE)/after=FALSE単独試験、msg_esc=TRUE単独試験は未実装。防具fixtureの `T W b .` は、脱衣2周期＋着用2周期＋休息1周期で食糧1000→995、turn=5。`waste_time()` は通常command末尾のAFTERに追加される。

別に分離版だけで名前付き矢を分割し、残った束を命名し直しても投げる側の名前が保持されることをC内で確認する。原本の文字列共有による未定義動作は比較基準にせず、安全性修正として扱う。
