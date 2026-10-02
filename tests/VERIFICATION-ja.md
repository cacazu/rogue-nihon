# 4 層分離の検証契約

取得原本・既存 Brogue を保持し、最終成果物で実ゲーム比較36件（日本語12件）、復元9ケース、日本語ブラウザ19件、補助試験11系統を検証した。全91個のゲーム実行記録と4種類の実行moduleをSHA-256で結び付けている。実Moreの途中での保存・復元も含む。結果・現在のartifact hash・残る限界は `RESULTS-ja.md`、機械記録は `../verification.json` に保存する。以下には静的レビューの根拠と検証契約も含み、未実行の計画項目は実行証拠のある結果と区別する。

## 実行前に隔離する OS 処理

| 原本の入口 | 外部操作 | native baseline / Web の扱い |
|---|---|---|
| `main.c:28/49–79` | md_init の signal、home/name/environment、time+PID、open_score、uid/gid の変更 | 起動 seed/options/name を固定。host adapter を起動前から使用する。score を compile 時無効または専用 sandbox に限定し、実ユーザー/home/共有 score を使わない |
| `command.c:180 → main.c:356 → mdport.c:547` | shell 起動。fork/execl/wait、Windows の spawn、SHELL/COMSPEC | shell adapter を明示的に無効化し、OS プロセスを起動しない。原作の無料操作扱いと必要な continue 応答は別途保持する |
| `mach_dep.c:100/114–119` | score file の r+/w+ 作成と chmod | score 用メモリまたは専用 temp のみ。ユーザーの既存ファイルを開かない |
| `rip.c:112/212–217 → mach_dep.c:374–445` | score 読書き、lockfile 作成/削除、stat、sleep、fgets | test 用 host score。実時間待機なし。入出力 queue を共有し、fgets を取り残さない |
| `save.c:35–111/121–154/163–264` | 保存パス入力、stat、unlink、fopen(w/r)、chmod、exit、復元ファイル消費 | 任意パスを受け付けず test 専用 slot に限定。Web は byte snapshot と host storage。restore の unlink は成功検証後の方針へ分離 |
| `mdport.c:141–254/1373–1428`、`mach_dep.c:137` | signal、自動保存、alarm、process-group kill、tty 切替 | 実シグナル/kill/alarm/tty は呼ばない。lifecycle は host event とする。DUMP/CHECKTIME/SIGTSTP の経路も明示無効 |
| `mach_dep.c:78/347`、`mdport.c:1333–1364` | 条件付き MAXLOAD/MAXUSERS、utmp、/dev/kmem、getloadavg | runtime environment 制限は試験と Web では無効化。ゲーム turn/fuse と混同しない |
| `main.c:391` 等、`command.c:52`、`chase.c:442`、`monsters.c:163` | exit/abort | GameOver/Exit/Error を明示記録。native は試験専用 child process の終了で検出し、ブラウザでは host の終了結果へ |

上記は静的レビュー済みの原本経路。`system/popen` の直接呼出しは C/H 走査では見つからなかったが、shell escape は fork/exec/spawn を使用する。外部セットアップスクリプトのレビュー結果ではない。

`main` は score file を開いてからユーザー権限を落とす。`restore` は serializer 結果を未検証のまま保存ファイルを消費する。実行前の host 置換とパス限定を必要とする根拠はこの実コードにある。

## baseline の独立性と乱数

baseline は原本の command/look/ゲーム処理を維持し、差分を仮想 curses、host I/O、計測 hook、固定 seed に限定する。分離版の変更済み logic をそのまま baseline に使うと、両方に入った誤りを見逃す。

- 両方を同じ integer/overflow 方針（例: 32 bit int と `-fwrapv`）でビルドし、compiler/flags を記録する。原本の signed LCG と異なる RNG に置き換えない。
- seed だけでなく options、寸法、ROGUEOPTS、入力列、fixture、source hash を記録する。main と playit は ROGUEOPTS を各 1 回読む。
- `rip.c:95–100` の score 初期化もゲーム RNG を消費する。GameOver の比較点は score 呼出し前か後かを揃える。score の host 置換で seed の差を黙って除外しない。
- UI の入力 queue が空のとき ESC を返さない。正しい待機を維持し、試験 host が NeedInput と inputIndex を記録する。C call stack は同期待機/Asyncify 等の契約に従って維持し、待機のために乱数や BEFORE を再実行しない。

## trace の比較点と公開データ

各 `readchar` 待機直前、BEFORE/AFTER の境界、終了結果に順序付き checkpoint を作る。比較対象は seed/RNG 消費、phase/inputIndex、player/stats/flags、food/level、rooms/passages、places、list 順序と装備参照、識別/外見/銘、daemon/fuse 残時間、仮想 ASCII 画面/oldch、イベント ID/variant/引数、Outcome。

生ポインタは出力せず、list の相対 index や安定した fixture ID に変換する。map は `(x<<5)+y` の論理座標から同じ順序へ正規化する。符号付き seed と unsigned bit pattern の変換方針も揃える。タイムスタンプ、実ユーザーの home/path、DOM pixel、描画時間は比較用状態に含めない。seed、turn、視認、knowledge の不一致を filter で隠さない。

一般 UI 用 view は未探索 map や未識別の真名を含めない。内部完全 trace は試験専用であり、通常 UI の観測 API へ流用しない。

`compare-traces.mjs` は JSON 配列または NDJSON の比較対象 checkpoint を読み、最初の相違パスを返す。順序・項目欠落・seed・イベント variant 等を比較する。両方の adapter は上記の同じ schema を出力する必要があり、現行 engine ABI は担当者の契約決定後に接続する。

```text
node --test tests/compare-traces.test.mjs
node tests/compare-traces.mjs BASELINE.jsonl SEPARATED.jsonl
```

比較器のテスト成功は engine の互換性成功を意味しない。実ゲームの trace が得られたら、複数 seed と source-specific fixture で両実装を実行して比較する。

## browser 側の契約試験

1. input 待機で C 所有 snapshot を取得し、Rust repaint/resize/language change/focus を 100 回行って同じ snapshot を比較する。seed/turn/knowledge/可視画面の C 更新が発生してはいけない。
2. keyboard と対応する mouse action の結果を比較する。ブラウザ key repeat と数字 prefix/run を別入力として扱い、IME composition 中の keydown はゲームへ渡さない。
3. 方向/item/hand/More/text の待機から正しい応答で再開し、二重 advance と queue 空時の偽 ESC が発生しないことを確認する。
4. 仮想 ASCII 記憶画面と日本語文章を分離する。長い日本語、結合文字、UTF-8 を描画しても C が日本語の画面文字を inch として逆読取りしない。
5. 保存は storage transaction 完了後に成功を表示する。page reload で復元、破損 bytes の拒否、異なる slot、拒否された storage、別 tab の競合、fresh instance と再開始を確認する。
6. 原 save の既知 serializer 修正が入る場合、旧 byte 出力の完全一致を要求しない。修正理由/version を記録し、保存前後の論理状態と継続入力列を比較する。

engine export/host 契約確定後、`run-game.mjs`、`game-regression.test.mjs`、`game-fixtures.test.mjs` を接続して実ゲーム比較を実行した。browser adapterの検証は別担当。実行結果は `RESULTS-ja.md`、未実行分岐は `REGRESSION-CASES-ja.md` 末尾を参照する。
