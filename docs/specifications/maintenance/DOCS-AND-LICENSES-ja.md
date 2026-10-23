# 文書とライセンスの管理

## 文書と作業資料

READMEは起動・操作と索引、testsのREADMEは検証手順を扱う。実装資料の正本は [IMPLEMENTATION](../../IMPLEMENTATION-ja.md)、[ORIGINAL-SPEC](../../ORIGINAL-SPEC-ja.md)、[LOCALIZATION](../../LOCALIZATION-ja.md)、[MAP-DISPLAY](../../MAP-DISPLAY-ja.md) の4文書とし、仕様を複製しない。利用者向けの [ライセンス案内](../../LICENSES-ja.md) と、この保守方針は別に置く。

現在の判断に必要な仕様・変更理由・回帰条件を残し、終了した計画・作業日誌・過去のPASS件数は残さない。文書や試験を削除する場合は固有の条件を正本へ移し、索引と参照元を更新する。文書だけの変更では本文・リンク・アンカーを確認し、無関係な製品buildを行わない。

SDK、原典取得cache、現在のbuildで使うtarget・em-cache、比較試験の固定入力とhash証明、採用済み実行記録、配布物と対応ソース・通知を保持する。診断結果や一時バックアップはGit管理から外す。削除は対象・参照元・所有プロセスの終了を確認したものだけに行い、リンク先や稼働領域を再帰削除しない。

## 通知の範囲と導線

[logic/LICENSE.TXT](../../../logic/LICENSE.TXT) と原作ソースの著作権・条件・免責文をそのまま残す。採用する第三者コード・字体・素材・ランタイムも、対応する通知原文を保持する。

収録対象は `rogue-layers / wasm32-unknown-emscripten` と `rogue-browser-display / wasm32-unknown-unknown` の `normal,build` 依存。生成コードを取りこぼさないためbuild依存も含めるが、全件が実行時にリンクされるという意味ではない。Cargo.lockの全件、他OS・未使用機能・試験専用依存や、使用しただけのSDK一式は収録しない。Rustのstd依存は使用版のrust-srcからターゲット別に抽出する。

選択可能なMITを優先する。AND条件、追加の著作権表示、Unicodeのデータライセンス、第三者通知、例外条項は独立に保持する。同一本文を共有しても、各構成要素の版・採用条件・出典・本文hashと対応を失わせない。通知を要約で置き換えず、取得元の個人絶対パスを配布用対応表へ入れない。

ゲーム画面の外部リンクはGitHubへの1つとし、そのREADMEから案内・通知原文・ZIPへ辿れるようにする。通知の保持と配布物への添付は、独立したライセンスボタンの有無とは別に満たす。ZIPは通知一式の取得手段であり、ソース・ゲームを配るときにはその配布物にも必要な通知を含める。

## 更新手順

正本は [licenses/THIRD-PARTY.txt](../../../licenses/THIRD-PARTY.txt) と [licenses/manifest.json](../../../licenses/manifest.json)。本文は原文を共有し、対応表は構成要素ごとの採用条件・ターゲット・出典・本文のハッシュと位置を持つ。[THIRD-PARTY-NOTICES.md](../../../THIRD-PARTY-NOTICES.md) は説明と索引、[docs/LICENSES-ja.md](../../../docs/LICENSES-ja.md) は利用者向け案内とする。

依存・機能・ターゲット、ツールチェーン、素材を変更したら、次の順で更新する。上記のビルド対象を使い、ビルド根や機能を変える場合は収集処理も変更する。

1. 配布物と再配布ソースを確認し、[tools/collect-licenses.py](../../../tools/collect-licenses.py) で通知を再生成する。Python 3.11以上、使用版のRustと `rust-src`、Emscripten SDKが必要。作品のルートから `python tools/collect-licenses.py --sdk-root <SDKの場所>` を実行する。
2. 素材の出典が変わったときは原文を取得し、`--asset-notice <Lucideのライセンス原文>` で更新する。通常は既存の検証済み本文を再利用する。Rustの版が変わった場合は対応する版のMIT原文を取得する。
3. 再生成差分で対象、版、採用条件、追加通知を照合する。新しい例外・ライセンス形式や取得できない原文は出典を確認して収集処理へ追加する。無関係と確認できた旧文書・旧通知を削除する。
4. `python tools/collect-licenses.py --sdk-root <SDKの場所> --check` が成功することを確認する。[tools/pack-licenses.ps1](../../../tools/pack-licenses.ps1) でZIPを更新する。この処理は指定された5文書だけを収録し、本文のハッシュと対応を検証する。
5. 案内と全ローカル参照、ZIPの中身・原文の一致を確認する。PlaywrightでゲームのGitHubリンクを確認し、リンク先の作品READMEからライセンス案内・ZIPへ辿れることを照合する。案内・ZIPを変更した場合はローカル版の取得も確認し、結果を完了報告へ記載する。

完了条件は、対象の全構成要素が通知へ対応し、原文の内容が保持され、対象外の文書がなく、案内・索引・ZIPが同じ構成を参照していること。
