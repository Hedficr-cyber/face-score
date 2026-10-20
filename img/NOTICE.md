# 目安の顔の画像（cg-minus3.jpg・cg-0.jpg・cg-plus3.jpg）

- 出典：Nakamura, K., & Watanabe, K. (2020). A new data-driven mathematical model dissociates attractiveness from sexual dimorphism of human faces. *Scientific Reports*, 10, 16588. https://doi.org/10.1038/s41598-020-73472-8
- データ：Dryad doi:10.5061/dryad.pg4f4qrmp「Attractiveness(male_face).mp4」（ライセンス CC0 1.0）。Zenodo の写し（6422437）から取得し、Dryad が公表する SHA-256 と一致を確認。
- 中身：FaceGen で作った東アジア人男性の CG の顔（実在の人ではない）。日本人の評価者の評定から作られた「魅力」の向きに、−3 SD・0（平均）・+3 SD 動かした顔。動画のコマ 112・0・44 を切り抜き、左上の数値の表示を除いて縮小した。
- このアプリでの点数（10段階）は research-reference.js の `anchors`（_work/human-ratings/research-score/build.mjs で計算）。

# メガネ・サングラス

- `eyewear/*.webp`（96枚）：v0.14.0 の形と色の見本。12種類の形 × レンズ8色を、制作時にだけ独自の汎用3Dモデル（Three.js r160、MIT）で描いた静止画。特定の商品写真・ブランド・実際の装用寸法を示すものではない。制作のコードは `_work/v013-archive/eyewear-static-production`（公開しない）。
- 実際の商品の写真は転載しない。アプリには商品名・品番・公式の仕様だけを書き、写真はブランド公式の商品ページを別タブで開いて見る（`js/eyewear-products.js`）。
- これまでの経過：v0.8.0 の生成見本は v0.9.0 で削除（本人の指示）。v0.9.0〜v0.13.0 のカメラ・写真・CG の顔での試着と3D描画は、本人の「試着機能は撤廃（アプリが重くなりすぎ）」により v0.14.0 で公開アプリから外した（部品は `_work/v013-archive` に保管）。
