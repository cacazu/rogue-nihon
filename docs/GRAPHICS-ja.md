# Rogue 5.4.4 画像マップ版

2026-10-02。`start.ps1` で起動すると、マップは画像表示になります。「地図の表示」で文字表示に切り替えられます。拡大率は50・75・100・150・200%、基本セルは32pxです。「自分の位置へ」で表示位置を戻し、「全画面」でゲームパネルを拡大します。スマホではマップ内をドラッグして移動できます。隣接セルのクリック／タップは従来の移動入力です。

## 画像の範囲と出典

原作の `logic/extern.c` のモンスター表、`logic/rogue.h` の地形・アイテム記号、`logic/sticks.c` の `fire_bolt`、実際のC画面から、49個の表示IDを整理しました。[全対応表](TILE-INVENTORY.md)に記号・意味・画像位置を記載しています。

| 対象 | ID数 | 描画 |
|---|---:|---|
| 暗闇、床、通路、扉、横壁、縦壁、階段、見える罠 | 8 | 地形画像 |
| プレイヤー | 1 | 冒険者 |
| 金貨、薬、巻物、食料、武器、鎧、指輪、杖、魔除け | 9 | 種別画像 |
| 魔法検出記号 | 1 | 光の印 |
| 魔法の弾道 | 4 | 横・縦・斜め2方向 |
| A〜Zのモンスター | 26 | 種別画像 |

実ファイルは **96×96のPNG 46枚**です。弾道の4方向は1枚の回転で表します。太く濃い輪郭、簡潔なファンタジー画、透明背景の画像を組み込みImageGenで新規生成しました。外部の既存ゲーム画像は使っていません。

`web/assets/tiles/` にPNG・[対応manifest](../web/assets/tiles/manifest.json)・[画像一覧](../web/assets/tiles/contact-sheet.png)を保存しました。`source/` の5枚が生成された元アトラス、`generation-prompts.json` が生成指示、`generation.json` が切り出し範囲と最終PNGのSHA-256です。画像の元作品・版・依存ライセンスの記録は従来の `docs/PROVENANCE-ja.md`、`logic/LICENSE.TXT`、`THIRD-PARTY-NOTICES.md` に保持しています。

## ゲーム知識を増やさない表示

Rustの `rust/src/map_tiles.rs` は、Cがすでに表示した文字だけを表示IDへ変換します。Cの未表示マップ、内部アイテム種別、敵の実体、乱数にはアクセスしません。幻覚や擬態も、その時に原作が見せた記号で画像を選びます。8種類の罠は原作が `^` で示す共通の罠画像です。未鑑定の薬・杖等は種別だけを示し、隠された効果は画像や日本語ラベルへ出しません。

`-`・`|`・`/` は壁・杖と弾道で重複するため、`logic/sticks.c` の実際の `fire_bolt` 描画に、読み取り用の `rg_host_map_effect` コールバックを追加しました。Cが描いた座標・記号を一時的にRustへ渡し、実画面の文字が一致する時だけ弾道へ置換します。描画終了でタグを消します。既存の移動・攻撃・反射・ダメージ・待機・画面復元の順序は維持しています。弾道の画像は原作記号の軸を示し、移動方向の矢印を新たに判定する仕組みは追加していません。

透明なキャラクターとアイテムは、表示済みセルの中で中立的な床画像に重ねます。内部の本当の床や通路を逆引きしません。空白は暗闇の画像だけです。通常の画像モードでASCIIを描く経路はなく、未対応記号や不足画像は明示的なエラーになります。HUD・説明・メニューは日本語DOMのまま、セルの意味には日本語の読み上げラベルもあります。

## ブラウザ側

`web/tiles.js` がPNGを読み込み、`map_tile_ids` と `map_tiles` を検証して描画します。大きいマップ全体を高DPIのCanvasへ展開せず、スクロール位置に応じて見えるセルだけを描画します。DPRは2まで、画像補間は無効、セル境界は整数のデバイス画素へ丸めます。重ね順は床→そのセルの画像です。

`web/app.js` は画像／文字・拡大・センタリング・全画面操作を描画にのみ使います。クリックの座標は拡大率・スクロール位置・CSS表示サイズを通して元の80×24画面へ戻します。画像にはゲームループや保存形式を持たせません。IndexedDB、Worker、Rust保存envelopeとC checkpointは既存の仕組みです。

## 検証と再実行

[graphics-verification.json](../graphics-verification.json) はこの画像版の実ビルド・PNG・検証の記録です。旧 `verification.json` は画像追加前の検証履歴として残しています。

- Nodeの20項目が成功。49 ID・46 PNG・26種の敵、暗闇、重ね順、座標、実C弾道4方向、入力キュー、翻訳UIを確認。
- 画像追加前のビルドと3 seedの20状態word・全trace・元の文字画面が一致。別の日本語saveケースで保存envelopeの全文が一致し、再開状態も一致。
- Rustの独立した表示変換テスト4項目、`cargo fmt` と `cargo clippy --lib -- -D warnings` が成功。
- 実Chromeの画像専用7項目が成功。50〜200%表示、390×844／844×390のモバイル画面、全画面とEscape、原作状態とRNGの不変、実Cへの隣接画像クリックを確認。
- 実Chromeの既存日本語19項目が成功。日本語本文・持ち物・ヘルプ・設定・IME・UTF-8入力・IndexedDB保存・新Workerでの再開・翻訳欠落なしを確認。

`tests/graphics-output/` に6枚の実ブラウザ／レンダラー検証画像と `evidence.json`、`tests/browser-smoke/output-ja/` に日本語検証記録を保存しています。全49 IDの画像一覧は合成された表示用ギャラリーです。26種すべてを通常プレイで遭遇したという記録ではありません。モバイル画面はChromeの画面サイズ・DPRエミュレーションであり、実機全機種の検証ではありません。

```powershell
# ゲームを実行
.\start.ps1

# 弾道fixtureを含むテスト用ビルド（通常版は置換しない）
.\build.ps1 -SkipCatalogGeneration -OutputName graphics-fixtures -TestFixtures

# 旧版との比較には、画像追加前のgame.jsと隣のgame.wasmが必要
$env:ROGUE_GRAPHICS_BASELINE='C:\path\to\pre-graphics\game.js'
node --test tests/tiles.test.mjs tests/graphics-logic.test.mjs tests/graphics-beams.test.mjs tests/browser-smoke/host.test.mjs tests/browser-smoke/localization.test.mjs
node tests/graphics-browser.mjs
$env:ROGUE_JA_SCENARIO='1'
node tests/browser-smoke/run.mjs

# 元画像の技術的な切り出し・再梱包
.\tools\pack-tiles.ps1
python .\tools\localize-tiles.py
.\tools\tile-contact-sheet.ps1
```

旧版を指定しない場合、比較テストは理由付きでskipします。今回の比較は `39469d7b4509037aa2b206f47b561133b5d02dc6` の配布ビルドを別の作業ディレクトリへ保存して実施しました。新旧どちらのハッシュも検証JSONに記録しています。Gitへのコミット・プッシュや外部公開は、この作業では行っていません。
