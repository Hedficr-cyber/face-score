// ブランド公式の実商品への案内。画像を転載せず、本人の写真や測定値をURLへ含めない。
// 出典：_work/eyewear-products-research_2026-10-20.json（Codex、公式の個別商品ページ）と、
// _work/eyewear-products-research-claude_2026-10-20.json（Claude Code、サーモントとスクエア型サングラスを追加確認）。
// 価格・在庫は変わるので載せない。Zoff・OWNDAYS はリンク設置に事前連絡が要る規約のため載せない。
// frames：この商品を例として出す形（catalog.js の id）。spec：公式ページの表記（形・色・サイズ）
export const PRODUCTS_CHECKED = '2026-10-20';
export const PRODUCTS = [
  { brand: 'JINS', sku: 'UCF-22A-165', name: 'STANDARD Acetate', frames: ['wellington'], url: 'https://www.jins.com/jp/item/UCF-22A-165.html',
    spec: 'ウェリントン・ブラック・47□24-145', note: '黒いセルの定番ウェリントン。対応レンズに薄い色のレンズ（ライトブルー・ライトラベンダーなど）がある。' },
  { brand: 'JINS', sku: 'UCF-22A-181', name: 'STANDARD Acetate', frames: ['boston'], url: 'https://www.jins.com/jp/item/UCF-22A-181_94.html',
    spec: 'ボストン・ブラック・47.0□21.5-144.0', note: '黒いセルのボストン。対応レンズに薄い色のレンズがある。' },
  { brand: 'JINS', sku: 'UCF-22A-184', name: 'STANDARD Acetate', frames: ['boston'], url: 'https://www.jins.com/jp/item/UCF-22A-184.html',
    spec: 'クラウンパント・ブラック・48□23-144', note: 'ボストンの上辺を角ばらせたクラウンパント（公式の仕様は多角形）。' },
  { brand: 'JINS', sku: 'UMF-22A-202', name: 'Authentic Rim Metal', frames: ['round'], url: 'https://www.jins.com/jp/item/UMF-22A-202.html',
    spec: 'ラウンド・ブラウン', note: '細いメタルの丸メガネ。対応レンズに薄い色のレンズがある。' },
  { brand: 'JINS', sku: 'MMF-22A-262', name: 'Rim Metal', frames: ['square'], url: 'https://www.jins.com/jp/item/MMF-22A-262_96.html',
    spec: 'スクエア・シルバー・54□17-143', note: '細いメタルの横長スクエア。対応レンズに薄い色のレンズがある。' },
  { brand: 'JINS', sku: 'MMF-22A-260', name: 'Rim Metal', frames: ['oval'], url: 'https://www.jins.com/jp/item/MMF-22A-260_84.html',
    spec: 'オーバル・ブラウン・52□18-143', note: '細いメタルのオーバル。対応レンズに薄い色のレンズがある。' },
  { brand: 'JINS', sku: 'UTF-25A-223', name: 'NEW CLASSIC No.03', frames: ['browline'], url: 'https://www.jins.com/jp/item/UTF-25A-223_294.html',
    spec: 'サーモント・ブラック/グレー・49□21-150', note: '前はチタン、つるはアセテート。眉の位置に太いライン。対応レンズにライトカラーがある。' },
  { brand: 'JINS', sku: 'MTP-26S-149', name: '26SS STANDARD Rimless', frames: ['rimless'], url: 'https://www.jins.com/jp/item/MTP-26S-149_96.html',
    spec: 'リムレス・シルバー・56□18-144', note: '対応レンズにライトアッシュ・ライトブルー・ライトラベンダーなどの薄い色がある（度数などの条件あり）。' },
  { brand: 'Ray-Ban', sku: 'RB3025', name: 'AVIATOR CLASSIC', frames: ['teardrop'], url: 'https://www.ray-ban.com/japan/sunglasses/RB3025aviator%20classic-%E3%82%A2%E3%83%AA%E3%82%B9%E3%82%BF%E3%82%B4%E3%83%BC%E3%83%AB%E3%83%89/805289602057',
    spec: 'アビエーター・アリスタゴールド・G-15グリーン・58-14', note: 'パイロット型の元祖。金のメタルに緑のG-15レンズ。' },
  { brand: 'JINS', sku: 'UTF-25A-242', name: 'JINS TODAY 2025-26FW', frames: ['teardrop'], url: 'https://www.jins.com/jp/item/UTF-25A-242_396.html',
    spec: 'ティアドロップ・シルバー', note: 'メガネとして売られているティアドロップ（サングラスではない）。対応レンズに薄い色のレンズがある。' },
  { brand: 'Ray-Ban', sku: 'RB2140F', name: 'ORIGINAL WAYFARER CLASSIC', frames: ['wellington-sun'], url: 'https://www.ray-ban.com/japan/sunglasses/0RB2140F-ORIGINAL%20WAYFARER%20CLASSIC-%E3%83%96%E3%83%A9%E3%83%83%E3%82%AF/8053672054682',
    spec: 'ウェイファーラー・ブラック・G-15グリーン・52-22', note: 'ウェリントン型サングラスの定番。公式にレンズのカスタマイズの入口がある。' },
  { brand: 'Ray-Ban', sku: 'RB3447', name: 'ROUND METAL', frames: ['round-sun'], url: 'https://www.ray-ban.com/japan/sunglasses/RB3447round%20metal-%E3%82%B4%E3%83%BC%E3%83%AB%E3%83%89/8056597858236',
    spec: 'ラウンド・ゴールド・グレーのグラデーション・53-21', note: '丸いメタルのサングラス。公式にレンズのカスタマイズの入口がある。' },
  { brand: 'JINS', sku: 'URF-26S-097', name: '26SS SUNGLASSES Bold', frames: ['square-sun'], url: 'https://www.jins.com/jp/item/URF-26S-097_192.html',
    spec: 'スクエア・グレー（クリアミラー）・54.5□18.0-145.0', note: '太い樹脂の直線的なサングラス。レンズの交換は店舗のみ。' },
  { brand: 'JINS', sku: 'UMF-26S-081', name: '26SS SUNGLASSES Metal', frames: ['boston-sun'], url: 'https://www.jins.com/jp/item/UMF-26S-081.html',
    spec: 'ボストン・マットブラック・ブラウンのレンズ・54□20-149', note: 'メタルのボストン型サングラス。レンズの交換は店舗のみ。' },
  { brand: 'JINS', sku: 'URF-26S-089', name: '26SS SUNGLASSES Combination', frames: ['boston-sun'], url: 'https://www.jins.com/jp/item/URF-26S-089_100.html',
    spec: 'ボストン・クリア・ブルーのレンズ・51□20-150', note: '透明なフレームにブルーのレンズ。レンズの交換は店舗のみ。' },
];
