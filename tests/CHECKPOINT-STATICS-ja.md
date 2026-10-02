# fresh module 復元で保存すべき関数 static

原本 C 全33ファイルの static 宣言を走査し、command 開始直前の checkpoint と入力 journal 再生という契約で読んだ。実行再現ではなく静的根拠。原本・コア実装はこの担当では変更していない。

| 対象 | 境界を跨ぐ意味 | 推奨 |
|---|---|---|
| `command.c:30 countch/direction/newcount` | countch は数値反復の次 command、direction は CTRL方向の反復に再利用。fresh module の初期0では同じ count/running を処理できない。newcount は通常入力 branch で上書きされるが同じ契約に含める | file-static へ移して getter/setter を追加し、原処理を変えず runtime checkpoint に記録 |
| `misc.c:467 get_dir last_delt` | again && last_dir の経路（469–473）は saved last_dir の値を解釈せず last_delt を再利用。last_dirだけ復元すると delta=(0,0)になり得る | x/y を明示保存。固定キーから再計算するなら、原コードが混乱前の方向を last_delt に入れる順序を保持する |
| `io.c:19–20 msgbuf/newpos` | C メッセージ蓄積と More。mpos/huh は旧serializerに含まれるが msgbuf/newpos は含まれない | message/paging runtime section として保存。language変更によるページ送りはこの状態と分ける |
| `io.c:174–181 hpwidth/s_hungry/s_lvl/s_pur/s_hp/s_arm/s_str/s_exp` | status の再描画 skip と書式幅。fresh module 初期値は保存画面と対応せず、描画/メッセージの順が変わり得る | 厳密な raw画面/メッセージ再現を要求するなら保存。純粋 Rust status表示へ置換する場合もCの読取り/pagingへの影響を別検証 |
| `things.c:335/337/339 line_cnt/newpage/lastfmt/lastarg` | inventory/discovered の途中ページ、1行だけの場合の msg 再表示。outer command の正常境界では end_line が line_cnt=0/newpage=FALSE（580–581） | mid-commandの状態は journal で再構成。outer boundary invariant を検査。lastfmt/lastarg の生ポインタを保存せず、必要なら意味/bytesへ変換 |
| `things.c:478 add_line maxlen` | 一覧の窓幅。end_lineはmaxlenを必ず初期値へ戻すわけではなく、commandを跨いで残る。maxlen<0の初期化、ページ更新、最大幅更新は495–496/547/553–554 | 厳密な legacy frame 比較なら整数保存。line_cnt/newpageのinvariantと併せて扱う |
| `state.c:69–71 error flags` | 失敗状態が同instanceの将来I/Oを止める。ゲーム状態とは別のI/O実行状態 | 新しいsave/import開始で明示resetし、失敗を返す。成功checkpointのゲーム状態としてsticky errorを保存しない |

## 初期化される作業用 static と定数

- `rooms.c:208/210/218/248–251`: maze.used/nexits は220–224で毎maze初期化、Max*/Start*/起点は226–233で設定、digの方向 del[] は変更されない。生成終了後の checkpoint で前の作業値を復元する必要はない。
- `passages.c:28` の graph conn は定数、isconn/ingraphは48–53でreset。`pnum/newpnum` は369–370でreset。connのcoord作業値はその生成呼出しで設定される。
- `chase.c` の ch_ret/orig_pos/this/tryp/tp、`monsters.c`のwanderer cp、`move.c`のrndmove ret、`new_level.c`のtreasure mp、`weapons.c`のfall/hit座標、`wizard.c`のteleport座標は正常な map/room 制約下で使う前に設定される作業値。checkpointを処理途中へ置くなら journal で同じ呼出しを再生する。特にdo_chaseの「別roomなのに有効exitがない」異常状態では this が以前の値に依存し得るため、不正map fixtureを通常の互換根拠に使わない。
- `sticks.c` の drainee/spotpos/pos は呼出しで構築し、使う範囲を限定する。WS_MISSILE の static boltは175–184で必要な属性を設定し、o_launchが以前の値を残すのはcur_weapon==NULLの経路。通常のweapon whichが非負の前提では、この残値が fresh zero と異なっても有効launcherを持たず、roll_emの選択を変えない（fight.c:427–435）。異常なweapon whichをfixtureで追加しない。
- `init.c:233/323` の used/metusedはinit_colors/stones/materialsの冒頭でreset（244–245/301–302/325–328）。新module初期化後、保存外見/確率/値のserializer復元を行う。
- `fight.c:353/487`、`pack.c:250`、`rings.c:189`、`sticks.c:422`、`weapons.c:212` 等の表示文字バッファは読まれる内容を各callで構築する。set_mnameの初期 `the ` prefixは変更されない。things print_discのorderはset_order455–456で毎call初期化する。
- `options.c:383 get_num` のbufはMASTER専用経路で、空入力時に過去の数字へ依存する可能性がある。MASTERを本版で無効にするなら対象外。有効化するときは再監査する。通常get_strの編集途中bufはjournalで同じ入力を再生する。
- xcryptのDES tables/cache、immutable名前配列、MDのlogin/home/shell/password/standout、score lock FILE/stat、CHECKTIME count、death日時は、ここで対象とする無shell/無MASTER/無OSscoreのhost構成におけるゲーム規則の持続stateにはしない。

## 復元単位で確認するケース

1. `m l` を完了した checkpoint をfresh moduleへ復元し、次の `a` が同じ右移動を行う。last_deltの不足を検出する。
2. 数値 `3.` またはCTRL方向反復の途中outer boundaryを復元し、未入力で残り反復が同じだけ進む。countch/directionの不足を検出する。
3. hasteの1回目行動後の入力待ちで保存し、checkpoint＋journal再生が同じ2回目入力待ちへ戻る。BEFORE/1回目移動の重複と入力indexのずれを検出する。
4. More、item、direction、text、inventory pagingの途中で保存し、同じ待機/入力index/seed/観測画面へ戻る。journalはすべてのCread_keyへ渡したイベントを順序保存し、UI専用save/repaintイベントは混ぜない。
5. core担当が指摘した `playit` 冒頭oldpos/oldrp再代入を復元時に避け、移動直後checkpointから次lookで元のlamp消去が起きることを確認する。新ゲームでは従来の初期設定を維持する。

比較は画面とsnapshotの両方で行う。20wordのworld/entity/knowledge/effects hashだけでは、削除されたCstaticが次の操作まで表れない場合があるので、復元直後のsnapshot一致だけで合格にしない。
