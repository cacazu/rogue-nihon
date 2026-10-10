# 原典・取得記録とGit管理範囲

## 対象と取得元

対象は古典Rogueの **Roguelike Restoration Project Rogue 5.4.4** です。Brogueとは別作品で、Brogueは同じリポジトリの `brogue-nihon/` で保持します。

- 原配布URL: http://rogue.rogueforge.net/files/rogue5.4/rogue5.4.4-src.tar.gz
- 実際の取得URL（MacPortsミラー）: https://distfiles.macports.org/rogue/rogue5.4.4-src.tar.gz
- 取得日: 2026-10-02 UTC
- アーカイブ: `rogue5.4.4-src.tar.gz`、209,839 bytes
- SHA-256: `7d37a61fc098bda0e6fac30799da347294067e8e079e4b40d6c781468e08e8a1`
- Gitコミットを持つ取得物ではなく、版番号とアーカイブハッシュで識別します。

初回取得は `investigation-20261002-original-rogue/` に隔離し、原本55ファイルと取得アーカイブを保持しました。この調査資料はGit管理対象外のローカル資料です。現在のリポジトリ直下にそのフォルダが存在することを前提にしません。Web版の起動・製品ビルドには不要です。

`logic/` は原典を基にWeb対応・4層化・日本語表示接続を追加した派生ソースです。原文の著作権表示、3つのBSD形式ライセンス本文は [logic/LICENSE.TXT](../logic/LICENSE.TXT) とCファイルのヘッダーに保持しています。依存物の通知は [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md) と `licenses/` にあります。

比較用ソース `tests/baseline-src/` と、原典との差分・ハッシュを記録した `tests/baseline-provenance.json`、`tests/split-provenance.json`、`tests/baseline-diffs/`、`tests/split-diffs/` をGitで管理します。比較用ソースはWasmの接続・観測を含み、無変更の原本そのものではありません。[比較範囲と限界](../tests/BASELINE-ja.md)を参照してください。

比較用ソースを原典から再作成する場合は、上記ハッシュを確認したアーカイブを安全なローカルフォルダへ展開し、`tests/prepare-baseline.py --original <展開したrogue5.4.4>` を使います。原典を参照する監査・検証にも原典パスを指定してください。取得コードのconfigure/installは実行しません。

## 検証出力の扱い

各説明資料には実行当時の検証結果、ビルドハッシュ、制約を履歴として残しています。2026-10-10の整理で `verification.json`、画像版・ドット絵版の検証JSON、`tests/game-results-summary.json`、詳細トレース、ブラウザ画面画像、動画、比較用コピーを削除しました。過去の説明に記載した出力パスは保存済み成果物の存在を保証しません。

詳細トレース、ブラウザ画面画像、fixture用Wasm、補助テストバイナリ、ローカル配達manifestはGit管理対象外です。これらの不要なローカル成果物、Rustのビルドキャッシュ、Emscriptenのプロジェクト内キャッシュ、ログ、Pythonキャッシュを削除しました。ライセンス通知、翻訳の編集入力、継続的な検証用のソースとスクリプト、LAN起動用証明書は保持します。

Rogueの起動に必要な `build/game.js`、`game.wasm`、`browser-ui.wasm`、`build-manifest.json` と、翻訳生成に使うPython・JSON入力はGitで管理します。再ビルドと試験の手順は [README.md](../README.md)、[tests/BASELINE-ja.md](../tests/BASELINE-ja.md)、[tests/browser-smoke/README-ja.md](../tests/browser-smoke/README-ja.md) にあります。通常のビルド・検証は専用の一時領域を使い、終了時に自動で削除します。詳細出力を保存する場合だけ `-KeepArtifacts` または `ROGUE_KEEP_ARTIFACTS=1` を指定します。
