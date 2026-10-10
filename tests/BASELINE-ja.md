# 原本規則を使う比較用ビルド

`baseline-src/` は取得済み Rogue 5.4.4 の原本33 C・3 Hから再作成する比較用ソースです。`prepare-baseline.py` が原本を読み、Wasmで動かすための接続と観測を加えます。取得原本と既存Brogueは変更しません。`baseline-provenance.json` に原本と比較版のSHA-256・変更目的・共有範囲を記録し、`baseline-diffs/` に全差分を保存します。

比較版の21/33 Cは原本とバイト単位で同一です。マップ生成・移動・戦闘・AI・アイテム処理などの規則を取得原本からコンパイルします。`command.c`、`misc.c`、`things.c`、`armor.c` には永続static状態へのアクセスとターンの観測を加えます。`audit-baseline.py` はこれらの接続・観測部分を逆適用した本文が原本に一致することを確認します。IOの純粋なホスト通知・状態アクセスも同様に照合し、計34 checksを `baseline-source-audit.json` に保存します。

比較版の `extern.h` は原本の `RN` 式を保ちます。両ビルドを32 bit intと `-fwrapv` でコンパイルし、加算・乗算の符号付きラップを定義します。分離版の明示的ラップ関数と原本式の一致を、実行したseed・入力・状態で確認します。

`io.c` の `msg/addmsg/doadd` と `--More--` は原本の本文を使います。原本の `vsprintf/strcat`、文字数判定、`look(FALSE)`、入力待ち、refresh順を保ちます。比較版は短いASCII英文と選定した安全なfixtureの基準です。任意の長文入力に対する原本バッファの安全性は保証しません。分離版のbounded formatting、typed message ID、日本語表示は別に検証します。

daemon呼出しはWasmの関数signatureに合わせ、登録13 callbackのうち `turn_see(bool)` だけに引数を渡し、他の12関数は無引数で呼びます。登録・順序・daemon/fuseの規則は保ちます。未知のcallbackは不正状態として拒否します。

この比較では次を共有するため、独立したnative curses版全体との互換性までは証明できません。

- C startup、virtual cursesのknowledge buffer、OS接続、Rust表示・入力・platform、20 word状態観測とhash。
- 新しい保存container、検証を追加したstate serializer、checkpoint/runtime状態の保存。原本raw save形式との比較ではありません。
- Wasm用の接続部。原本同梱configureやshell script、native TTY、実OSのshell/processやscoreファイルは実行しません。

判定対象は同じseed・名前・入力列での全20 u32、persistent input_index、最終状態・outcome、および全英文画面の `cells/width/height/player/stats` です。比較版は `message.legacy` 通知のため、翻訳IDや日本語UI metadataを含むframe全体のhashは原作同一性の判定に使いません。生の追加metadataはraw JSONに保持します。

日本語向けの表示observerは比較版から除きます。`options.c` は原本ASCIIエディタを使うため、UTF-8名前入力・Unicode scalar Backspace・日本語名aliasは分離版の追加機能として試験します。分離版 `pack.c` のlabel深いコピーとCtrl+Pの `msg("%s", huh)` は安全修正です。原本の浅いlabel共有やユーザー文字列のformat再解釈を同一性の基準にしません。`%s%n%%` を含む任意の果物名も分離版EN/JA比較だけに使い、原本の未定義printf入力を実行しません。

実ゲーム試験は通常7件、fixture17件、日本語UI5件、日本語戦闘・終了・薬6件、日本語More中保存・復元1件です。原規則の比較は通常8組、誘導fixture12組、戦闘・終了・標準薬の5組と、実More入力1組で行います。日本語UI5件はlocaleによるC状態不変、Unicode名前編集、途中保存のfresh-module再生を検証します。任意果物名の薬1件は分離版EN/JA比較です。過去の実測範囲と実行binaryのSHA-256の説明は `RESULTS-ja.md` を参照してください。詳細出力と集約JSONは2026-10-10の整理で削除済みで、再検証時に生成します。

誘導状態は `RG_TEST_FIXTURES` ビルドの `game-fixtures.c` でのみ用意します。MEMFS `/fixture.id` を読み、原本setup APIで状態を作り、seedを揃えます。productionにfixture codeを含めず、fixture専用のexportも追加しません。この方法は自然なseedから各効果へ至る経路を証明しません。幻覚のraw名 `hallu-more/hallu-midmore` は実際にはcommand再描画・command境界復元で、幻覚中Moreの待機・保存は未検証です。呪われた防具の脱衣、着用途中のhaste失効、直接呼ぶ `look(FALSE)/after=FALSE`、`msg_esc=TRUE` の単独分岐など、未実行の組合せも残ります。`REGRESSION-CASES-ja.md` の設計上の期待値を実行済みcoverageとして扱いません。

再作成には既存SDK Pythonで `tests/prepare-baseline.py`、`tests/audit-baseline.py` を実行し、通常の `build.ps1` に `-LogicDirectory tests/baseline-src` と別 `-OutputName`、`-KeepArtifacts` を指定します。fixtureは同じscriptの `-TestFixtures` を使います。元ディレクトリは読取り専用です。
