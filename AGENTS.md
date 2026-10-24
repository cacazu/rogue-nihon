# Rogue の変更と検証

根本の原因を調査してからコードを設計、変更する。

## 読む資料

- 起動・基本操作・必要環境は [README](README.md)。
- 状態の所有者、C/Rust/JSの境界、ABIと保存は [実装](docs/IMPLEMENTATION-ja.md)。
- 原典の固定版、原作コマンド、周期・乱数、比較の限界は [原作対応](docs/ORIGINAL-SPEC-ja.md)。
- 意味ID・descriptor・未鑑定情報は [日本語化](docs/LOCALIZATION-ja.md)、公開地図・画像・アニメーションは [地図表示](docs/MAP-DISPLAY-ja.md)。
- 変更に応じた試験の選択は [tests/README](tests/README.md)、実ブラウザーは [Playwright手順](tests/browser-smoke/README-ja.md)。
- 文書、依存・素材、通知や配布内容を変える場合は [文書とライセンスの管理](docs/specifications/maintenance/DOCS-AND-LICENSES-ja.md)。

## 変更の境界

原作Cがルール・RNG・ターン・可視性を所有し、Rustが入力変換・公開情報の表示・保存を担当する。JSへゲームやUIの判断を重複実装しない。未公開の地形・敵・罠・未鑑定の正体を表示や操作候補へ使わない。

UIに未依頼の説明・案内・注釈を追加せず、ボタンの操作やキーを本文へ重複表示しない。削除を求められた説明を別の場所へ移して残さない。

関連する既存試験で、実際の入力から後続選択・取消・次の操作まで確かめる。Cの保持条件は同じ消費済み入力の状態・RNGで比較する。UIは影響する端末・利用サイズと入力経路を、実入力・画像で確認し、Rust単体の成功を実ゲームの成功へ言い換えない。fixtureと操作用exportを配布buildへ混ぜない。

既存の変更、固定比較入力、原典・SDK、ビルドcache、稼働中の配信、プレイヤー保存を保護する。origin・ポートの変更はブラウザーの保存枠を変える。作業用の一時スクリプトは完了前に片付け、正式なツール・回帰試験や再利用するcacheは保持する。
