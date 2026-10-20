# 目安の顔の画像（cg-minus3.jpg・cg-0.jpg・cg-plus3.jpg）

- 出典：Nakamura, K., & Watanabe, K. (2020). A new data-driven mathematical model dissociates attractiveness from sexual dimorphism of human faces. *Scientific Reports*, 10, 16588. https://doi.org/10.1038/s41598-020-73472-8
- データ：Dryad doi:10.5061/dryad.pg4f4qrmp「Attractiveness(male_face).mp4」（ライセンス CC0 1.0）。Zenodo の写し（6422437）から取得し、Dryad が公表する SHA-256 と一致を確認。
- 中身：FaceGen で作った東アジア人男性の CG の顔（実在の人ではない）。日本人の評価者の評定から作られた「魅力」の向きに、−3 SD・0（平均）・+3 SD 動かした顔。動画のコマ 112・0・44 を切り抜き、左上の数値の表示を除いて縮小した。
- このアプリでの点数（10段階）は research-reference.js の `anchors`（_work/human-ratings/research-score/build.mjs で計算）。

# メガネ・サングラス

v0.8.0 の生成見本（`eyewear-showcase-2026-10-20.png`）は、本人の指示（2026-10-20「わざわざここまできて見ないからいらない」）で v0.9.0 から削除した。代わりに「アクセサリー」のタブで、カメラ映像の自分の顔にフレームの形（js/eyewear-visuals.js の12種類）を重ねる試着（js/tryon.js、端末の中だけで処理）を使う。
