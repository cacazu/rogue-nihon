# 縦壁・横壁の石積み模様

2026-10-11。壁の正方形の形・大きさ・不透明な中央を維持し、石積み模様を方向別に差し替えた。横壁 `-` は横に並ぶ石積み、縦壁 `|` は縦に並ぶ石積み。回転は使わず、原作の既存IDからそれぞれのPNGを参照する。ゲームと描画の処理は変更せず、アセットと参照設定を更新した。

- 横壁: `web/assets/pixels-v2/terrain.wall_horizontal.png`（32×32）、`web/assets/tiles/terrain.wall_horizontal.png`（96×96）
- 縦壁: `web/assets/pixels-v2/terrain.wall_vertical.png`（32×32）、`web/assets/tiles/terrain.wall_vertical.png`（96×96）
- 生成元: `web/assets/walls/terrain.wall_horizontal.source.png`、`web/assets/walls/terrain.wall_vertical.source.png`
- 生成プロンプト・梱包内容・SHA-256: `web/assets/walls/generation.json`

組み込みImageGenで既存の四角い石ブロックを編集し、内側の模様を横3段・縦3列の石積みに変えた。生成指示は、同じ正方形の輪郭・灰色の石・明るい縁・全面不透明・32×32の論理画素・8色以下を保持し、模様だけを変更すること。`node tools/pack-walls.mjs` で2枚の原画像から両サイズを再梱包できる。

49表示ID、各セット46枚のPNG。Cの縦横の壁、弾道との区別、移動・衝突・扉・探索・乱数・セーブ形式は保持している。Rustに埋め込まれるmanifestの参照先を差し替えるため、`build-ui.ps1` でUI配布ファイルも更新する。

Playwrightの `tests/browser-smoke/wall-blocks.mjs` は、両方の壁画像の読み込みと実際の画素、全倍率、PC・スマホ幅390px／DPR 2、壁との衝突・扉への移動を確認する。Nodeの画像検証は模様が異なること、正方形の全面が不透明であることも確認する。

今回の差し替え後はPlaywright 16項目、Node 25項目が成功し、ブラウザー例外は0。PC・スマホ幅のスクリーンショットでも横壁・縦壁の模様と同じブロック幅を確認した。実機スマートフォンでの手動操作は含まない。
