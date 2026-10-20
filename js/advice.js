// 髪型・メガネの似合い度（顔の形との相性＋比率をどれだけ整えるか＋部位の強みを見せ弱みを目立たせないか）
import { HAIR, GLASSES } from './catalog.js';
import { SHAPE, NORM } from './config.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const gauss = (e, t) => 100 * Math.exp(-Math.LN2 * (e / t) ** 2);

function compat(item, shape) {
  return shape.ranked.reduce((s, r) => s + r.p * item.fit[r.key], 0);
}

// 顔の特徴を −1.5〜1.5 の「どちらに寄っているか」にする。
// 縦横比・あご幅は平均顔の標準偏差で測る（1 ＝ 平均から標準偏差 1 つ分）。顔の縦横比は額を平均的な高さとみなした値（lengthK1）で比べる。
function leanings(m) {
  const t = m.thirds;
  return {
    length: clamp((m.lengthK1 / m.width - NORM.length.mean) / NORM.length.sd, -1.5, 1.5),
    jaw: clamp((m.jaw / m.width - NORM.jaw.mean) / NORM.jaw.sd, -1.5, 1.5),
    forehead: t.hairlineSet ? clamp((t.upper / t.total - 1 / 3) / 0.03, -1.5, 1.5) : 0,
  };
}

// 部位の測定（research-score の features：日本人男性 98 人の基準で標準化。1＝平均から標準偏差 1 つ分）。
// 日本人の評価者が好む向き（Nakamura & Watanabe 2020。撮影条件をそろえた SCUT でも同じ向き）：目は大きい方・眉と目は近い方。
// 強みは見せ、弱みは目立たせない髪型・メガネに点を足す（足し方はスタイリングの定番の考え方。向きの根拠は上の研究）
function partLeanings(f) {
  if (!f) return null;
  return { eyes: (f.eyeOpen + f.eyeWidth) / 2, browEye: f.browEye };
}
const sdText = (z) => `平均より ${z >= 0 ? "+" : "−"}${Math.abs(z).toFixed(1)} SD`;

export function rankHair(m, shape, score, features = null) {
  const parts = partLeanings(features);
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
    const sdL = NORM.length.sd;
    const balance = t.hairlineSet ? gauss((appR - R.length) / sdL, 1.2) - gauss((baseR - R.length) / sdL, 1.2) : 0;
    const ratioText = `見た目の縦横比 ${baseR.toFixed(2)} → ${appR.toFixed(2)}（平均顔 ${R.length.toFixed(2)}）`;
    if (t.hairlineSet) add(clamp(balance * 0.35, -10, 10), balance > 0 ? `${ratioText}に近づく` : `${ratioText}から離れる`);

    const upperPct = t.hairlineSet ? Math.round((t.upper / t.total) * 100) : null;
    const upperShown = t.hairlineSet ? Math.round(((t.upper * (1 - cover)) / (t.total - cover * t.upper)) * 100) : null;
    if (lean.forehead > 0.5 && h.bangs >= 1) add(4 * lean.forehead, `おでこ ${upperPct}% を前髪で ${upperShown}% ほどに見せられる（理想 33%）`);
    if (lean.forehead > 0.5 && h.bangs === 0) add(-3 * lean.forehead, `おでこ ${upperPct}% がそのまま出る（理想 33%）`);
    if (lean.forehead < -0.5 && h.bangs === 0) add(-4 * lean.forehead, `前髪を上げ、狭めのおでこ（${upperPct}%）を広く見せる`);
    if (lean.forehead < -0.5 && h.bangs >= 1.5) add(3 * lean.forehead, `前髪でおでこ（${upperPct}%）がさらに狭く見える`);

    const jawPct = Math.round((m.jaw / m.width) * 100), jawRef = Math.round(R.jaw * 100);
    if (lean.jaw > 0.5 && h.sides <= -1 && h.top <= 0.5) add(-4 * lean.jaw, `サイドが短く、張ったエラ（あご幅 ${jawPct}%・平均 ${jawRef}%）が目立ちやすい`);
    if (lean.jaw > 0.5 && h.sides >= 0 && h.top >= 1) add(3 * lean.jaw, `上と横の丸みで、エラの張り（あご幅 ${jawPct}%・平均 ${jawRef}%）がやわらぐ`);
    if (lean.jaw < -0.5 && h.top >= 2) add(4 * lean.jaw, `トップが高く、細いあご（あご幅 ${jawPct}%・平均 ${jawRef}%）がより細く見える`);
    if (lean.jaw < -0.5 && h.sides >= 0.5) add(-3 * lean.jaw, `サイドの厚みで、細いあご（あご幅 ${jawPct}%・平均 ${jawRef}%）とつり合う`);

    if (parts) {
      if (parts.eyes >= 0.5 && h.bangs <= 0.5) add(2 + 2 * Math.min(parts.eyes, 1.5), `目元が強み（目の大きさ ${sdText(parts.eyes)}）。前髪で隠さずに見せられる`);
      if (parts.eyes >= 0.5 && h.bangs >= 2) add(-3, `重い前髪で、強みの目元（${sdText(parts.eyes)}）が隠れる`);
      if (parts.browEye >= 0.6 && h.bangs >= 1.5) add(3, `眉と目の距離（${sdText(parts.browEye)}。好まれるのは近い方）が、眉にかかる前髪で目立ちにくい`);
      if (parts.browEye >= 0.6 && h.bangs === 0) add(-2, `前髪を上げると、離れぎみの眉と目（${sdText(parts.browEye)}）が目立つ`);
      if (parts.browEye <= -0.6 && h.bangs === 0) add(2, `眉と目が近い（${sdText(parts.browEye)}。強み）。前髪を上げると引き立つ`);
    }
    if (asym < 70 && h.part === 'side') add(4, '分け目で視線が片側に集まり、左右差が目立ちにくい');
    if (asym < 70 && h.part === 'center') add(-4, '真ん中分けは左右差が目立ちやすい');

    const fitText = `${top.name}${top.p < 0.6 ? '寄り' : ''}の顔と${base >= 80 ? '相性が良い' : base >= 68 ? 'まずまず合う' : '相性はいまひとつ'}`;
    reasons.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    return {
      id: h.id, name: h.name, tip: h.tip,
      score: clamp(base + adj, 0, 100),
      reasons: [{ src: 'rule', text: fitText }, ...reasons.slice(0, 3).map((r) => ({ src: 'measure', text: r.text, v: r.v }))],
    };
  }).sort((a, b) => b.score - a.score);
}

export function rankGlasses(m, shape, features = null) {
  const parts = partLeanings(features);
  const lean = leanings(m);
  const top = shape.main;
  return GLASSES.map((g) => {
    const base = compat(g, shape);
    const reasons = [];
    let adj = 0;
    const add = (v, text) => { adj += v; if (Math.abs(v) >= 2) reasons.push({ v, text }); };

    const R = SHAPE.reference;
    const lenText = `縦横比 ${(m.lengthK1 / m.width).toFixed(2)}・平均 ${R.length.toFixed(2)}`;
    const jawText = `あご幅 ${Math.round((m.jaw / m.width) * 100)}%・平均 ${Math.round(R.jaw * 100)}%`;
    if (lean.length !== 0) {
      const v = 6 * lean.length * g.depth;
      add(v, lean.length > 0
        ? (g.depth > 0 ? `レンズの天地幅が深く、長めの顔（${lenText}）を短く見せる` : `浅いレンズで、長めの顔（${lenText}）が強調される`)
        : (g.depth < 0 ? `横長のレンズで、短めの顔（${lenText}）とつり合う` : `深いレンズで、短めの顔（${lenText}）がさらに短く見える`));
    }
    if (lean.jaw > 0) add(6 * lean.jaw * g.curve, g.curve > 0 ? `丸みがエラの角（${jawText}）をやわらげる` : `直線的な形がエラの角（${jawText}）を強める`);
    if (lean.jaw < 0) {
      add(4 * -lean.jaw * -g.weight, g.weight < 0 ? `下側の重心が細いあご（${jawText}）とつり合う` : `上側が重く、あごの細さ（${jawText}）が目立つ`);
    }

    if (parts) {
      if (parts.eyes >= 0.5 && g.kind === 'sunglasses') add(-3, `強みの目元（${sdText(parts.eyes)}）が隠れる。見せたい場面では外すか、薄い色のレンズに`);
      if (parts.browEye >= 0.6 && g.weight >= 1) add(4, `眉の位置の太いラインで、離れぎみの眉と目（${sdText(parts.browEye)}）の間が詰まって見える`);
      if (parts.browEye <= -0.6 && g.weight >= 1) add(-2, `眉の位置の太いラインが、強みの眉と目の近さ（${sdText(parts.browEye)}）を隠す`);
    }
    const fitText = `${top.name}${top.p < 0.6 ? '寄り' : ''}の顔と${base >= 80 ? '相性が良い' : base >= 68 ? 'まずまず合う' : '相性はいまひとつ'}`;
    reasons.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    return {
      id: g.id, name: g.name, kind: g.kind, tip: g.tip,
      score: clamp(base + adj + (g.research?.adj || 0), 0, 100),
      reasons: [{ src: 'rule', text: fitText }, ...(g.research ? [{ src: 'research', text: g.research.text, v: g.research.adj }] : []), ...reasons.slice(0, 3).map((r) => ({ src: 'measure', text: r.text, v: r.v }))],
    };
  }).sort((a, b) => b.score - a.score);
}

// メガネのサイズの目安（黒目の大きさから推定した瞳孔間距離をもとにする）
// 顔の幅からフレーム幅を出すのは、輪郭の点が実際の顔幅より内側に出るため使わない（2026-10-18 実測で確認）
export function frameSize(m) {
  const pd = m.mm?.pd;
  if (!Number.isFinite(pd) || pd <= 0) return null;
  const ratio = m.inner / m.eyeW;
  const lpb = [Math.round(pd + 2), Math.round(pd + 8)];
  return {
    pd: Math.round(pd),
    lensPlusBridge: lpb,
    lens: [lpb[0] - 20, lpb[1] - 18],
    // 平均顔（目の間÷目の幅の平均と標準偏差）から 1 標準偏差を超えたら「広め・狭め」
    bridge: ratio > NORM.innerToEye.mean + NORM.innerToEye.sd ? '目の間がやや広め。ブリッジは太め・濃い色だと間が締まって見える。'
      : ratio < NORM.innerToEye.mean - NORM.innerToEye.sd ? '目の間がやや狭め。ブリッジは細い・透明だと間が広く見える。'
        : '目の間は標準的。ブリッジはどれでも合わせやすい。',
  };
}
