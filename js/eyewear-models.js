// メガネ・サングラスの実物の仕様（v0.13・2026-10-20）。すべて mm。
// 形は、レンズの外形（玉型）を「超楕円＋変形（逆台形・鼻側の絞り・外下のふくらみ）」で作り、外接長方形を
// レンズ幅 A × 天地幅 B にそろえる。座標は右側のレンズ（見る人から見て右、+x が外側＝こめかみ側）、y は上、中心は玉型の中心。
// 寸法は市販品で一般的な値（例：ウェリントン 50□20-145）。試着では本人の瞳孔間距離に合わせてレンズ幅を調整する。

export const MATERIALS = {
  black: { label: '黒セル', kind: 'acetate', color: '#0d0d0f' },
  tortoise: { label: 'べっ甲柄セル', kind: 'acetate', color: '#6b3d1c', pattern: 'tortoise' },
  navy: { label: 'ネイビーセル', kind: 'acetate', color: '#141c2e' },
  crystalGray: { label: 'クリアグレーセル', kind: 'acetate', color: '#8d9094', clear: true },
  gold: { label: 'ゴールド', kind: 'metal', color: '#c9a464' },
  silver: { label: 'シルバー', kind: 'metal', color: '#aeb2b8' },
  gunmetal: { label: 'ガンメタル', kind: 'metal', color: '#4b4d52' },
};
export const LENSES = {
  clear: { label: 'クリアレンズ', tint: '#ffffff', darkness: 0 },
  gray: { label: 'グレーレンズ', tint: '#25282b', darkness: 0.86 },
  g15: { label: 'G-15（グリーン）レンズ', tint: '#2c3a2e', darkness: 0.84 },
  brownGradient: { label: 'ブラウンのグラデーションレンズ', tint: '#3a281c', tintBottom: '#9a7a5c', darkness: 0.8 },
  lightGray: { label: 'ライトグレーレンズ', tint: '#5c6166', darkness: 0.55 },
};

// shape：nTop/nBot＝上下の超楕円の指数（2＝楕円、大きいほど角ばる）、ratio＝天地幅÷レンズ幅、
// trap＝上を広げる量（逆台形）、tuck＝鼻側の下を内へ絞る量、drop＝外側の下へふくらませる量、slope＝上辺が外へ下がる量
// rim：セルの幅（上・横・下）と厚み。metal：金属線の太さ（半径）。bridge：saddle（セルの山）・keyhole（鍵穴）・metal（金属の一本）・double（二本）
export const FRAMES = {
  wellington: {
    name: 'ウェリントン', kind: 'glasses', tagline: '上辺の太い逆台形。きちんと感と存在感',
    shape: { nTop: 5.2, nBot: 4.2, ratio: 0.78, trap: 0.1 }, size: { lens: 50, bridge: 20, temple: 145 },
    material: 'black', lens: 'clear', rim: { top: 5.4, side: 4.6, bottom: 3.8, depth: 4.8 }, bridge: 'saddle', rivets: 2,
  },
  boston: {
    name: 'ボストン', kind: 'glasses', tagline: '丸みのある逆三角形。べっ甲で柔らかく知的に',
    shape: { nTop: 3.4, nBot: 2.2, ratio: 0.86, trap: 0.08, tuck: 0.16 }, size: { lens: 48, bridge: 21, temple: 145 },
    material: 'tortoise', lens: 'clear', rim: { top: 4.8, side: 4.2, bottom: 3.6, depth: 4.6 }, bridge: 'keyhole', rivets: 2,
  },
  round: {
    name: 'ラウンド', kind: 'glasses', tagline: '真円の細いメタル。軽くクラシックに',
    shape: { nTop: 2, nBot: 2, ratio: 0.97 }, size: { lens: 46, bridge: 22, temple: 145 },
    material: 'gold', lens: 'clear', metal: { wire: 0.75 }, bridge: 'metal', pads: true,
  },
  square: {
    name: 'スクエア', kind: 'glasses', tagline: '横長の四角。直線で顔を引き締める',
    shape: { nTop: 6, nBot: 5, ratio: 0.6, trap: 0.04 }, size: { lens: 53, bridge: 18, temple: 145 },
    material: 'navy', lens: 'clear', rim: { top: 4.4, side: 4.0, bottom: 3.6, depth: 4.4 }, bridge: 'saddle', rivets: 1,
  },
  oval: {
    name: 'オーバル', kind: 'glasses', tagline: '横長の楕円。角のない柔らかい印象',
    shape: { nTop: 2.4, nBot: 2.2, ratio: 0.66 }, size: { lens: 52, bridge: 18, temple: 145 },
    material: 'silver', lens: 'clear', metal: { wire: 0.7 }, bridge: 'metal', pads: true,
  },
  browline: {
    name: 'サーモント（ブロー）', kind: 'glasses', tagline: '眉の位置に太いライン。大人のクラシック',
    shape: { nTop: 5, nBot: 2.8, ratio: 0.76, trap: 0.08 }, size: { lens: 50, bridge: 21, temple: 145 },
    material: 'gold', browMaterial: 'black', lens: 'clear', metal: { wire: 0.65 }, brow: { top: 6.2, depth: 5 }, bridge: 'metal', pads: true, rivets: 1,
  },
  rimless: {
    name: 'フチなし（リムレス）', kind: 'glasses', tagline: 'レンズを留めるだけ。素顔に近く見せる',
    shape: { nTop: 4.5, nBot: 3.4, ratio: 0.66, trap: 0.05 }, size: { lens: 52, bridge: 17, temple: 145 },
    material: 'silver', lens: 'clear', metal: { wire: 0.6 }, rimless: true, bridge: 'metal', pads: true,
  },
  teardrop: {
    name: 'ティアドロップ', kind: 'sunglasses', tagline: 'パイロットのしずく形。顔の重心を下げる',
    shape: { nTop: 4, nBot: 2.2, ratio: 0.84, tuck: 0.2, drop: 0.12, slope: 0.08 }, size: { lens: 58, bridge: 14, temple: 140 },
    material: 'gold', lens: 'g15', metal: { wire: 0.8 }, bridge: 'double', pads: true,
  },
  'wellington-sun': {
    name: 'ウェリントン型サングラス', kind: 'sunglasses', tagline: '黒セルにグレーのレンズ。いちばんの定番',
    shape: { nTop: 5.2, nBot: 4.2, ratio: 0.78, trap: 0.1 }, size: { lens: 52, bridge: 20, temple: 145 },
    material: 'black', lens: 'gray', rim: { top: 6, side: 5, bottom: 4.2, depth: 5.4 }, bridge: 'saddle', rivets: 2,
  },
  'round-sun': {
    name: 'ラウンド型サングラス', kind: 'sunglasses', tagline: '丸いメタルにブラウンのグラデーション',
    shape: { nTop: 2, nBot: 2, ratio: 0.97 }, size: { lens: 49, bridge: 21, temple: 145 },
    material: 'gold', lens: 'brownGradient', metal: { wire: 0.8 }, bridge: 'metal', pads: true,
  },
  'square-sun': {
    name: 'スクエア型サングラス', kind: 'sunglasses', tagline: '太い直線のセル。強めの印象',
    shape: { nTop: 6, nBot: 5, ratio: 0.64, trap: 0.04 }, size: { lens: 55, bridge: 18, temple: 145 },
    material: 'black', lens: 'gray', rim: { top: 6.4, side: 5.6, bottom: 4.6, depth: 5.8 }, bridge: 'saddle', rivets: 2,
  },
  'boston-sun': {
    name: 'ボストン型サングラス', kind: 'sunglasses', tagline: 'べっ甲にブラウン。柔らかく品よく',
    shape: { nTop: 3.4, nBot: 2.2, ratio: 0.86, trap: 0.08, tuck: 0.16 }, size: { lens: 50, bridge: 21, temple: 145 },
    material: 'tortoise', lens: 'brownGradient', rim: { top: 5.2, side: 4.6, bottom: 4, depth: 5 }, bridge: 'keyhole', rivets: 2,
  },
};

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// 玉型（右側のレンズ）：n 点の [x, y]（mm、反時計回り、+x が外側）。外接長方形が A × A·ratio になる
export function lensOutline(shape, A, n = 128) {
  if (!shape || !finite(A) || A <= 0 || A > 200 || !Number.isInteger(n) || n < 8 || n > 2048
    || ![shape.nTop, shape.nBot, shape.ratio].every((v) => finite(v) && v > 0)
    || shape.nTop > 20 || shape.nBot > 20 || shape.ratio > 2
    || ['trap', 'tuck', 'drop', 'slope'].some((k) => shape[k] !== undefined && (!finite(shape[k]) || Math.abs(shape[k]) > 1))) throw new Error('invalid lens outline input');
  const raw = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const c = Math.cos(t), s = Math.sin(t);
    const e = s >= 0 ? shape.nTop : shape.nBot;
    let x = Math.sign(c) * Math.abs(c) ** (2 / e);
    let y = Math.sign(s) * Math.abs(s) ** (2 / e);
    x *= 1 + (shape.trap || 0) * y; // 逆台形：上を広く
    if (x < 0 && y < 0) x += (shape.tuck || 0) * -x * -y; // 鼻側の下を内へ
    if (x > 0 && y < 0) y -= (shape.drop || 0) * x * -y; // 外側の下へふくらむ
    if (y > 0) y -= (shape.slope || 0) * ((x + 1) / 2) * y; // 上辺が外へ下がる
    raw.push([x, y]);
  }
  const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const B = A * shape.ratio;
  return raw.map(([x, y]) => [((x - x0) / (x1 - x0) - 0.5) * A, ((y - y0) / (y1 - y0) - 0.5) * B]);
}

// 本人の瞳孔間距離（mm）に合わせた寸法。玉型の中心間距離（A＋ブリッジ）が瞳孔間距離＋2〜8mm に入るようにレンズ幅を調整する
// （advice.js の frameSize と同じ考え方）。極端に変えないよう、標準の ±4mm の範囲にとどめる。
export function fittedSize(spec, pdMm = null) {
  const { lens, bridge, temple } = spec.size;
  if (!finite(pdMm) || pdMm < 50 || pdMm > 80) return { lens, bridge, temple, height: lens * spec.shape.ratio, fitted: false };
  const lo = pdMm + 2 - bridge, hi = pdMm + 8 - bridge;
  const A = Math.max(lens - 4, Math.min(lens + 4, Math.max(lo, Math.min(hi, lens))));
  return { lens: Math.round(A), bridge, temple, height: Math.round(A * spec.shape.ratio * 10) / 10, fitted: Math.round(A) !== lens };
}

// 表示用の仕様の一行（例：黒セル・クリアレンズ・50□20-145）
export function specLine(id, pdMm = null) {
  const s = Object.hasOwn(FRAMES, id) ? FRAMES[id] : null;
  if (!s) return '';
  const z = fittedSize(s, pdMm);
  const mat = s.browMaterial ? `${MATERIALS[s.browMaterial].label}×${MATERIALS[s.material].label}` : MATERIALS[s.material].label;
  return `${mat}・${LENSES[s.lens].label}・${z.lens}□${z.bridge}-${z.temple}`;
}
