# Cの画面文言と日本語入力

`locales/ui-game-en.json` と `ui-game-ja.json` に137個の意味IDを記録した。原作のヘルプ65項目すべて、記号の説明18種類、設定10項目・値・操作ヒント、品物選択の目的12種類、現在の装備の表現、未発見の品物の案内を含む。`tools/generate_game_ui.py` は原作の英語ヘルプ表とC側ID対照の件数・順序を照合して辞書を生成する。原作の `extern.c helpstr[]` は変更していない。

`command.c help/identify/current`、`options.c option/put_*/get_*`、`pack.c get_item`、`misc.c get_dir`、`things.c print_disc/add_line/end_line` から表示用の意味データを通知する。Cの英語画面、元の選択キー、行数、ページ送り、待機、ゲーム状態を変える関数の呼出しは保持する。新しいページと終了時には表示scopeを消去する。所持品の名前は `inv_name` が既に選んだ情報のdescriptorを使い、名前を得るために `inv_name` や乱数を再度呼ばない。日本語の文字幅や折り返しはRust/DOM側で扱う。

`options.c get_str/strucpy` はWeb版でUTF-8の文字列を受け付ける。上限は原作の50バイトを保持し、保存する文字列に不完全なUTF-8、過長符号化、サロゲート、不正なUnicode値を残さない。BackspaceはUnicode scalar全体を消す。ASCIIの消去・行消去・`-`・Esc・空入力の動作を保持する。原作のEscは途中入力を文字列へ反映してからQUITを返す。日本語を受け付ける拡張は原作のASCII実装と同一動作であるという主張には含めない。

検証は次の範囲で行った。

- 担当の5 C単位を既存Emscriptenでコンパイルした。
- `options-utf8.c` はproductionの `get_str/strucpy` を直接リンクし、日本語・絵文字のBackspace、50バイト境界、不正UTF-8、ASCII編集、プレイヤー名通知、name mode2・fruit mode3・空Enterで果物原値保持の165項目に成功した。消去キーは実virtual screenと同じ8を使う。画面と入力は決定的なstubであり、ブラウザのIME動作そのものはこの試験に含まない。実測結果は `options-utf8-result.json`。
- `ui-game-catalog.test.py` は137 IDのEN/JA一致、元のヘルプ65説明との英語一致、日本語のUTF-8・置換文字混入なし、placeholder一致、使用IDの辞書存在を確認した。
- 原作比較用のrule bodyから新しい意味通知を外す処理を `prepare-baseline.py` に追加し、`audit-baseline.py` の34項目が成功した。21/33 Cは原本とバイト単位で一致する。取得原本は読取りのみで使った。

ゲーム回帰では全20word状態・入力位置・乱数と、元の英語 `cells/width/height/player/stats` を比較する。翻訳用 `ui/map_cells` は追加データなので、この原作同一性比較とは別に確認する。各raw JSONには追加表示データも残す。最新製品の実ゲーム・ブラウザ試験は統合後の結果を参照する。

`generate-split-audit.py` は原33 CのSHA-256、製品側SHA-256、変更理由、差分を `split-provenance.json` と `split-diffs/` に保存する。差分の記録と実行済みケースの同一性は区別する。native curses、OSのshell/process、原作のscore/saveファイル動作は実行検証していない。
