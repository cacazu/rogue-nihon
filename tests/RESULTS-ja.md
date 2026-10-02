# 日本語4層版の実ゲーム検証結果

最終成果物で **36/36件通過、失敗0、skip0**。通常7件、fixture17件、日本語UI5件、戦闘・終了・薬6件、実More中の日本語保存・復元1件を実行した。計測日時は 2026-10-02T11:40:21.473311+00:00。ゲームC/Rustの最終版と同じRust libraryで比較版・試験専用版も再リンクした。ここで数える36件はコンパイルした実ゲームの試験で、harness自身のunit試験とは合算していない。

| 検証 | 結果 |
|---|---|
| 比較ソース監査 | 34 checks通過。比較版の21/33 Cが取得原本とbyte一致。原本RN、英文msg/addmsg/doadd/More本文を保持 |
| 製品ソース差分記録 | 原33 Cのhash・製品hash・変更目的・全差分を保存。製品の17/33 Cが原本とbyte一致、追加Cは5単位 |
| 通常 `game-regression.test.mjs` | 7/7。原規則比較8組、入力待ちsnapshot 310、英文frame 219一致 |
| 誘導状態 `game-fixtures.test.mjs` | 17/17。原規則比較12組、入力待ちsnapshot 55、英文frame 339一致 |
| 日本語UI `game-ui.test.mjs` | 5/5。ヘルプ・設定・所持品のEN/JAでC状態と英文frame一致、日本語item名のscalar Backspace・途中保存復元、日本語player名編集・空Enter維持 |
| 日本語戦闘・終了・薬 `game-localization.test.mjs` | 6/6。墓碑・墓碑なし死亡・勝利・戦闘・標準薬の5組で原規則一致。任意Unicode果物名とpercent文字は分離版EN/JAだけで比較 |
| 実More `game-more-localization.test.mjs` | 1/1。二重加速の実More待ちで保存し、fresh moduleへ復元。EN/JA/原規則のC状態・英文frame一致、継続frameと最終日本語UI一致 |
| 日本語エディタ直接リンク | 165 checks通過。UTF-8境界・不正符号化・scalar Backspace・ASCII操作・name mode2/fruit mode3・空Enterで果物原値保持 |
| C画面辞書 | 137 IDのEN/JA・placeholder・参照IDを照合。原作ヘルプ65説明と英語を照合 |
| 純粋な再描画 | Rustに保存されたframeを100回再提示してもC全20 wordとread数が変わらない |
| 壊れたenvelope | checksum変更を開始前に拒否。入力消費0、trace0 |

原規則の各比較は全20 u32、persistent input_index、全英文frameの `cells/width/height/player/stats`、最終状態・outcome codeを照合する。日本語の `ui/map_cells` は追加表示情報として別に検査し、raw JSONにも残す。日本語の各message/UIで翻訳fallback・missing IDがないことを実行した経路で確認した。user入力の日本語や `%s%n%%` は自由文字列として保持する。

保存・復元は品物選択、食糧装備、方向再実行、所持品表示、加速の行動間、加速薬選択、幻覚中command境界、日本語文字入力、実More待ちの9ケースを記録する。実Moreの保存時にはC画面の `--More--`、日本語 `ui.more`、Space入力context、pending=1、input_index=2を確認した。直前の自動sleep後に新checkpointが作られるため、その保存journalは空であり、保存済みC状態からMoreを再構築してlive Spaceを受け付ける。復元では全20 word/乱数/入力位置、継続する全英文frame、最終日本語UIが一致した。

12誘導比較は壁・無料操作、初期加速、加速薬、二重加速、加速中睡眠、255回反復、無料操作の数字反復、方向取消と再実行、防具時間消費、敵の起床、Medusa視線、幻覚のcommand再描画である。防具の `T W b .` は脱衣2周期＋着用2周期＋休息1周期で食糧1000→995、turn5となり、`waste_time()` の追加更新も両版で一致した。label分割後の独立所有とCtrl+Pのpercent文字再表示は分離版の安全性試験で、原本の未定義動作を基準にしない。

実行した全91 raw JSONを現在の4 moduleへ照合し、各JSONのbytes・SHA-256と使用したJS/WasmのSHA-256を [game-results-summary.json](game-results-summary.json) の `all_raw_results` に結合した。通常・fixture・日本語ケースの明細、3実行logのhashも同ファイルに保存した。rawは `actual-results/`、`fixture-results/`、`ui-results/`、`localization-results/`、`more-localization-results/` にある。

| 最終実行module | Wasm SHA-256 |
|---|---|
| `build/game.wasm` | `d4e4f53f7e3b5c6e1a86c1fa185f41d172893afa3d269a101e10bbbd3ee2fb56` |
| `build/baseline.wasm` | `2bf1a2093e7ad3be98cce39e3a507cbf201ad8c9402539e4895448106cf5e0dd` |
| `build/game-fixtures.wasm` | `c78dc9b8b19cf181aff74f885d291e2614e85a9019cac2d83e989dbafc5144f7` |
| `build/baseline-fixtures.wasm` | `d471fa5eea69d3796aa3aae8b351a63ad0a2dc527ca5939f2b5c3c1aed3b5763` |

JSのSHA-256もsummaryと各build manifestに保存した。再実行は最新catalog/Rust libraryと4 moduleを揃え、project rootで行う。

```powershell
$env:ROGUE_BASELINE_MODULE = Join-Path $PWD 'build\baseline.js'
node --test tests/game-regression.test.mjs tests/game-fixtures.test.mjs tests/game-ui.test.mjs
node --test tests/game-localization.test.mjs
node --test tests/game-more-localization.test.mjs
```

この比較はstartup・knowledge/virtual curses・OS接続・Rust層・新保存codecを共有する。native curses、TTY、実OSのshell/process、旧raw保存形式全体との互換性は独立検証していない。共通部とブラウザの検証結果は別担当の記録を参照する。誘導状態は自然なseedから各効果へ至る経路を証明せず、全組合せを網羅しない。

歴史的raw名 `hallu-more/hallu-midmore` は残すが、その記録はMore画面0で、幻覚中の通常command再描画・境界復元である。幻覚中Moreの保存は未検証。呪われた防具の脱衣拒否、着用途中のhaste失効、直接呼ぶ `look(FALSE)/after=FALSE`、`msg_esc=TRUE` の単独分岐もこのfixture suiteの対象外である。未実行項目を成功として数えていない。今回の実行済み範囲に残る失敗・skip・実行許可の拒否はない。
