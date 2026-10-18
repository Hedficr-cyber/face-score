// 髪型・メガネの似合い度（顔の形との相性＋比率をどれだけ整えるか）
import { HAIR, GLASSES } from './catalog.js';
import { SHAPE } from './config.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const gauss = (e, t) => 100 * Math.exp(-Math.LN2 * (e / t) ** 2);

function compat(item, shape) {
  return shape.ranked.reduce((s, r) => s + r.p * item.fit[r.key], 0);
}

// 顔の特徴を −1.5〜1.5 の「どちらに寄っているか」にする
function leanings(m) {
  const R = SHAPE.reference;
  const t = m.thirds;
  return {
    length: t.hairlineSet ? clamp((m.length / m.width / R.length - 1) / 0.06, -1.5, 1.5) : 0,
    jaw: clamp((m.jaw / m.width / R.jaw - 1) / 0.05, -1.5, 1.5),
    forehead: t.hairlineSet ? clamp((t.upper / t.total - 1 / 3) / 0.03, -1.5, 1.5) : 0,
  };
}

export function rankHair(m, shape, score) {
  const lean = leanings(m);
  const R = SHAPE.reference;
  const asym = score.items.symmetry.score;
  const top = shape.main;
  return HAIR.map((h) => {
    const base = compat(h, shape);
    const reasons = [];
    let adj = 0;
    const add = (v, text) => { adj += v; if (Math.abs(v) >= 2) reasons.push({ v, text }); };

    // 見た目の縦横比（前髪でおでこが隠れる分・トップの高さ・サイドの厚み）
    const t = m.thirds;
    const cover = 0.3 * h.bangs;
    const len = t.hairlineSet ? m.length - cover * t.upper : m.length;
    const appR = (len / (m.width * (1 + 0.03 * h.sides))) * (1 + 0.03 * h.top);
    const baseR = t.hairlineSet ? m.length / m.width : appR;
    const balance = t.hairlineSet ? gauss(appR / R.length - 1, 0.08) - gauss(baseR / R.length - 1, 0.08) : 0;
    if (t.hairlineSet) add(clamp(balance * 0.35, -10, 10), balance > 0 ? '縦横の比率を卵型に近づける' : '縦横の比率が卵型から離れる');

    if (lean.forehead > 0.5 && h.bangs >= 1) add(4 * lean.forehead, '広めのおでこを前髪でほどよく隠せる');
    if (lean.forehead > 0.5 && h.bangs === 0) add(-3 * lean.forehead, 'おでこの広さがそのまま出る');
    if (lean.forehead < -0.5 && h.bangs === 0) add(-4 * lean.forehead, '前髪を上げて狭めのおでこを広く見せる');
    if (lean.forehead < -0.5 && h.bangs >= 1.5) add(3 * lean.forehead, '前髪でおでこがさらに狭く見える');

    if (lean.jaw > 0.5 && h.sides <= -1 && h.top <= 0.5) add(-4 * lean.jaw, 'サイドが短く、張ったエラが目立ちやすい');
    if (lean.jaw > 0.5 && h.sides >= 0 && h.top >= 1) add(3 * lean.jaw, '上と横に丸みがあり、エラの張りがやわらぐ');
    if (lean.jaw < -0.5 && h.top >= 2) add(4 * lean.jaw, 'トップが高く、あご先がより細く見える');
    if (lean.jaw < -0.5 && h.sides >= 0.5) add(-3 * lean.jaw, 'サイドの厚みで細いあごとのバランスが取れる');

    if (asym < 70 && h.part === 'side') add(4, '分け目で視線が片側に集まり、左右差が目立ちにくい');
    if (asym < 70 && h.part === 'center') add(-4, '真ん中分けは左右差が目立ちやすい');

    const fitText = `${top.name}${top.p < 0.6 ? '寄り' : ''}の顔と${base >= 80 ? '相性が良い' : base >= 68 ? 'まずまず合う' : '相性はいまひとつ'}`;
    reasons.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    return {
      id: h.id, name: h.name, tip: h.tip,
      score: clamp(base + adj, 0, 100),
      reasons: [fitText, ...reasons.slice(0, 2).map((r) => r.text)],
    };
  }).sort((a, b) => b.score - a.score);
}

export function rankGlasses(m, shape) {
  const lean = leanings(m);
  const top = shape.main;
  return GLASSES.map((g) => {
    const base = compat(g, shape);
    const reasons = [];
    let adj = 0;
    const add = (v, text) => { adj += v; if (Math.abs(v) >= 2) reasons.push({ v, text }); };

    if (lean.length !== 0) {
      const v = 6 * lean.length * g.depth;
      add(v, lean.length > 0
        ? (g.depth > 0 ? 'レンズの天地幅が深く、顔の長さを短く見せる' : '浅いレンズで顔の長さが強調される')
        : (g.depth < 0 ? '横長のレンズで顔の短さとつり合う' : '深いレンズで顔がさらに短く見える'));
    }
    if (lean.jaw > 0) add(6 * lean.jaw * g.curve, g.curve > 0 ? '丸みがエラの角をやわらげる' : '直線的な形がエラの角を強める');
    if (lean.jaw < 0) {
      add(4 * -lean.jaw * -g.weight, g.weight < 0 ? '下側に重心があり、細いあごとつり合う' : '上側が重く、あごの細さが目立つ');
    }

    const fitText = `${top.name}${top.p < 0.6 ? '寄り' : ''}の顔と${base >= 80 ? '相性が良い' : base >= 68 ? 'まずまず合う' : '相性はいまひとつ'}`;
    reasons.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    return {
      id: g.id, name: g.name, kind: g.kind, tip: g.tip,
      score: clamp(base + adj, 0, 100),
      reasons: [fitText, ...reasons.slice(0, 2).map((r) => r.text)],
    };
  }).sort((a, b) => b.score - a.score);
}

// メガネのサイズの目安（黒目の大きさから推定した瞳孔間距離をもとにする）
// 顔の幅からフレーム幅を出すのは、輪郭の点が実際の顔幅より内側に出るため使わない（2026-10-18 実測で確認）
export function frameSize(m) {
  const pd = m.mm.pd;
  const ratio = m.inner / m.eyeW;
  const lpb = [Math.round(pd + 2), Math.round(pd + 8)];
  return {
    pd: Math.round(pd),
    lensPlusBridge: lpb,
    lens: [lpb[0] - 20, lpb[1] - 18],
    bridge: ratio > 1.12 ? '目の間がやや広め。ブリッジは太め・濃い色だと間が締まって見える。'
      : ratio < 0.9 ? '目の間がやや狭め。ブリッジは細い・透明だと間が広く見える。'
        : '目の間は標準的。ブリッジはどれでも合わせやすい。',
  };
}
