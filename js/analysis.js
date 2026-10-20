// 計測と採点。入力は正面にそろえた点（geometry.frontalize の points を平均したもの）。
import { PAIRS, MIDLINE } from './mesh-data.js';
import { SCORE, SHAPE, NORM, IRIS_MM } from './config.js';
import { dist2, mean } from './geometry.js';

export const ITEM_NAMES = {
  symmetry: '左右対称',
  thirds: '縦のバランス',
  fifths: '横のバランス',
  parts: 'パーツの配置',
  contour: '輪郭',
};

const BROWS = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46, 300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const REGIONS = {
  brow: new Set(BROWS),
  eye: new Set([33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
    263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]),
  mouth: new Set([61, 146, 91, 181, 84, 314, 405, 321, 375, 291, 185, 40, 39, 37, 267, 269, 270, 409,
    78, 95, 88, 178, 87, 317, 402, 318, 324, 308, 191, 80, 81, 82, 312, 311, 310, 415]),
  jaw: new Set([172, 397, 58, 288, 136, 365, 150, 379, 149, 378, 176, 400, 148, 377, 132, 361, 93, 323]),
};
const REGION_NAMES = { brow: '眉', eye: '目', mouth: '口元', jaw: 'フェイスライン', other: '頬・鼻まわり' };
const REGION_WEIGHTS = { brow: 0.2, eye: 0.25, mouth: 0.2, jaw: 0.2, other: 0.15 };

const gauss = (e, t) => 100 * Math.exp(-Math.LN2 * (e / t) ** 2);
const rms = (arr) => Math.sqrt(mean(arr.map((v) => v * v)));

// 平均顔（config.js の NORM）からのずれ：標準偏差の何倍か
const zOf = (name, v) => (v - NORM[name].mean) / NORM[name].sd;
// 9割の人が入る範囲（平均 ± 1.645 標準偏差）
const range90 = (name, digits = 2) => {
  const { mean: mu, sd } = NORM[name];
  return `${(mu - 1.645 * sd).toFixed(digits)}〜${(mu + 1.645 * sd).toFixed(digits)}`;
};

// 中心線（x = a*y + b）を最小二乗で求め、点を鏡映する
function midlineFit(P) {
  const ys = MIDLINE.map((i) => P[i][1]), xs = MIDLINE.map((i) => P[i][0]);
  const my = mean(ys), mx = mean(xs);
  let num = 0, den = 0;
  for (let k = 0; k < ys.length; k++) { num += (ys[k] - my) * (xs[k] - mx); den += (ys[k] - my) ** 2; }
  const a = den ? num / den : 0;
  return { a, b: mx - a * my };
}
function reflect([x, y], { a, b }) {
  // 直線 x - a*y - b = 0 に対する鏡映
  const d = (x - a * y - b) / (1 + a * a);
  return [x - 2 * d, y + 2 * d * a];
}

// 生え際は「眉〜鼻の下」の長さに対する、眉から生え際までの長さの比 k で持つ。
// 決めていないときは k=1（上の区間＝中の区間）と推定する。
export function browLineY(P) { return mean(BROWS.map((i) => P[i][1])); }
export function hairlineY(P, k) {
  const browY = browLineY(P);
  return browY + k * (browY - P[2][1]);
}
export function hairlineK(P, y) {
  const browY = browLineY(P);
  return (y - browY) / (browY - P[2][1]);
}

export function measure(P, hairline) {
  const x = (i) => P[i][0], y = (i) => P[i][1];
  const browY = browLineY(P);
  const subY = y(2), menY = y(152);
  const hairSet = !!hairline && hairline.source === 'manual' && Number.isFinite(hairline.k);
  const hairY = hairlineY(P, hairSet ? hairline.k : 1);

  const upper = hairY - browY, middle = browY - subY, lower = subY - menY;
  const edges = [127, 33, 133, 362, 263, 356].map(x);
  const fifths = edges.slice(1).map((v, k) => v - edges[k]);
  const width = x(454) - x(234);
  const eyeW = (fifths[1] + fifths[3]) / 2;
  const inner = fifths[2];
  const nose = x(358) - x(129);
  const mouth = x(291) - x(61);
  const stoY = (y(13) + y(14)) / 2;
  const upperLip = subY - stoY, chinH = stoY - menY;
  const jaw = x(397) - x(172), forehead = x(284) - x(54);
  const u = [P[172][0] - P[152][0], P[172][1] - P[152][1]];
  const v = [P[397][0] - P[152][0], P[397][1] - P[152][1]];
  const chinAngle = Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v))) * 180 / Math.PI;

  // 左右差：部位ごとに二乗平均をとり、目立つ部位を重くして合わせる
  const line = midlineFit(P);
  const regionSq = {}, regionCount = {};
  for (const [l, r] of PAIRS) {
    const m = reflect([P[r][0], P[r][1]], line);
    const d = Math.hypot(P[l][0] - m[0], P[l][1] - m[1]) / width;
    const reg = Object.keys(REGIONS).find((k) => REGIONS[k].has(l)) || 'other';
    regionSq[reg] = (regionSq[reg] || 0) + d * d;
    regionCount[reg] = (regionCount[reg] || 0) + 1;
  }
  const asymRegions = Object.fromEntries(Object.keys(regionSq).map((k) => [k, Math.sqrt(regionSq[k] / regionCount[k])]));
  const asymmetry = Object.entries(REGION_WEIGHTS).reduce((s, [k, w]) => s + w * (asymRegions[k] || 0), 0);
  const heightDiff = (leftIdx, rightIdx) => (mean(leftIdx.map(y)) - mean(rightIdx.map(y))) / width;

  // 実寸（黒目の横幅から）。旧468点の記録や黒目の欠損では、形・比率だけを
  // 計測する。目尻などから黒目を補って、実寸や瞳孔間距離を作らない。
  const hasIris = Array.from({ length: 10 }, (_, i) => P[468 + i])
    .every((p) => p && [p[0], p[1], p[2]].every(Number.isFinite));
  const diameters = hasIris ? [dist2(P[469], P[471]), dist2(P[470], P[472]), dist2(P[474], P[476]), dist2(P[475], P[477])] : [];
  const iris = diameters.length && diameters.every((d) => Number.isFinite(d) && d > 0) ? mean(diameters) : null;
  const pupilDistance = hasIris ? dist2(P[468], P[473]) : null;
  const scale = iris != null ? IRIS_MM / iris : null;
  const mmPerUnit = Number.isFinite(scale) && scale > 0 && Number.isFinite(pupilDistance) && pupilDistance > 0 ? scale : null;

  return {
    hairline: { source: hairSet ? 'manual' : 'estimated', y: hairY },
    browY, subY, menY,
    thirds: { upper, middle, lower, total: upper + middle + lower, hairlineSet: hairSet },
    fifths, width, eyeW, inner, nose, mouth, upperLip, chinH, jaw, forehead, chinAngle,
    length: hairY - menY,
    // 額の高さを眉〜鼻の下と同じとみなした顔の長さ（公開データの平均顔と同じ測り方。輪郭の点数に使う）
    lengthK1: 2 * middle + lower,
    asymmetry,
    asymRegions,
    browTilt: heightDiff([300, 293, 334, 296, 336], [70, 63, 105, 66, 107]),
    eyeTilt: heightDiff([386, 374], [159, 145]),
    mouthTilt: (y(291) - y(61)) / width,
    mm: mmPerUnit == null ? null : {
      width: width * mmPerUnit,
      temple: (x(356) - x(127)) * mmPerUnit,
      pd: pupilDistance * mmPerUnit,
      eye: eyeW * mmPerUnit,
      inner: inner * mmPerUnit,
    },
  };
}

// 顔の形（近い順の確率）。生え際を指定したときは実際の長さを使う（平均顔の生え際は推定の位置と同じとみなす）
export function faceShape(m) {
  const f = {
    length: m.length / m.width,
    jaw: m.jaw / m.width,
    forehead: m.forehead / m.width,
    chin: m.chinAngle,
  };
  const scores = Object.entries(SHAPE.prototypes).map(([key, p]) => {
    const d2 = ((f.length - p.length) / SHAPE.scale.length) ** 2 + ((f.jaw - p.jaw) / SHAPE.scale.jaw) ** 2
      + ((f.forehead - p.forehead) / SHAPE.scale.forehead) ** 2 + ((f.chin - p.chin) / SHAPE.scale.chin) ** 2;
    return { key, name: p.name, w: Math.exp(-0.5 * d2) };
  });
  const total = scores.reduce((s, v) => s + v.w, 0) || 1;
  const ranked = scores.map((s) => ({ key: s.key, name: s.name, p: s.w / total })).sort((a, b) => b.p - a.p);
  return { features: f, ranked, main: ranked[0] };
}

// 項目ごとの点数と所見
export function scoreAll(m) {
  const I = SCORE.ideal, T = SCORE.tolerance;
  const items = {};

  // 左右対称
  const worst = Object.entries(m.asymRegions).sort((a, b) => b[1] - a[1])[0];
  items.symmetry = {
    score: gauss(m.asymmetry, T.symmetry),
    value: m.asymmetry,
    notes: [
      `左右のずれは顔の幅の ${(m.asymmetry * 100).toFixed(1)}%。`,
      `いちばん差が大きいのは${REGION_NAMES[worst[0]]}（${(worst[1] * 100).toFixed(1)}%）。`,
      tiltNote('眉', m.browTilt),
      tiltNote('目', m.eyeTilt),
      tiltNote('口角', m.mouthTilt),
    ].filter(Boolean),
  };

  // 縦のバランス
  const t3 = m.thirds;
  let thirdsDev, thirdsParts;
  if (t3.hairlineSet) {
    thirdsParts = [t3.upper, t3.middle, t3.lower].map((v) => v / t3.total);
    thirdsDev = rms(thirdsParts.map((v) => (v - I.thirds) / I.thirds));
  } else {
    const ml = t3.middle + t3.lower;
    thirdsParts = [null, t3.middle / ml, t3.lower / ml];
    thirdsDev = rms([(t3.middle / ml - 0.5) / 0.5, (t3.lower / ml - 0.5) / 0.5]);
  }
  items.thirds = {
    score: gauss(thirdsDev, T.thirds),
    value: thirdsDev,
    parts: thirdsParts,
    notes: thirdsNotes(t3),
  };

  // 横のバランス（平均顔との近さ：目の間と、目尻から輪郭までを、目の幅に対する比で比べる）
  const fsum = m.fifths.reduce((s, v) => s + v, 0);
  const fparts = m.fifths.map((v) => v / fsum);
  const innerR = m.inner / m.eyeW, outerR = (m.fifths[0] + m.fifths[4]) / 2 / m.eyeW;
  const fz = { innerToEye: zOf('innerToEye', innerR), outerToEye: zOf('outerToEye', outerR) };
  const fifthsDev = rms(Object.values(fz));
  items.fifths = {
    score: gauss(fifthsDev, T.fifths),
    value: fifthsDev,
    parts: fparts,
    ratios: { innerToEye: innerR, outerToEye: outerR },
    z: fz,
    notes: fifthsNotes(innerR, outerR, fz),
  };

  // パーツの配置（平均顔との近さ）
  const r1 = m.nose / m.inner, r2 = m.mouth / m.nose, r3 = m.upperLip / m.chinH;
  const pz = { noseToInner: zOf('noseToInner', r1), mouthToNose: zOf('mouthToNose', r2), lipToChin: zOf('lipToChin', r3) };
  const partsDev = rms(Object.values(pz));
  items.parts = {
    score: gauss(partsDev, T.parts),
    value: partsDev,
    ratios: { noseToInner: r1, mouthToNose: r2, lipToChin: r3 },
    z: pz,
    notes: partsNotes(r1, r2, r3, pz),
  };

  // 輪郭（平均顔＝卵型との近さ）。顔の長さは平均顔と同じ測り方（額の高さは縦のバランスで見る）
  const lenR = m.lengthK1 / m.width, jawR = m.jaw / m.width;
  const cz = { length: zOf('length', lenR), jaw: zOf('jaw', jawR), chin: zOf('chin', m.chinAngle) };
  const contourDev = rms(Object.values(cz));
  items.contour = {
    score: gauss(contourDev, T.contour),
    value: contourDev,
    ratios: { length: lenR, jaw: jawR, chin: m.chinAngle },
    z: cz,
    notes: contourNotes(lenR, jawR, m.chinAngle, cz),
  };

  const W = SCORE.weights;
  const total = Object.keys(W).reduce((s, k) => s + W[k] * items[k].score, 0);
  return { total, items };
}

function tiltNote(name, v) {
  if (Math.abs(v) < 0.006) return null;
  return `${name}は本人から見て${v > 0 ? '左' : '右'}が少し高い（顔の幅の ${(Math.abs(v) * 100).toFixed(1)}%）。`;
}

function thirdsNotes(t) {
  const notes = [];
  if (t.hairlineSet) {
    const p = [t.upper, t.middle, t.lower].map((v) => Math.round((v / t.total) * 100));
    notes.push(`上 ${p[0]}％ ／ 中 ${p[1]}％ ／ 下 ${p[2]}％（理想は 33％ずつ）。`);
    if (p[0] >= 36) notes.push('おでこが広め。前髪で少し隠すと縦のバランスが整う。');
    if (p[0] <= 30) notes.push('おでこが狭め。前髪を上げるとバランスが整う。');
  } else {
    notes.push('生え際を決めていないので、中と下の比較だけで採点している。');
  }
  const ml = t.middle / (t.middle + t.lower);
  if (ml < 0.46) notes.push('鼻の下〜あごが長め。');
  if (ml > 0.54) notes.push('眉〜鼻の下が長め。');
  return notes;
}

// 平均顔の説明。「平均 x（9割の人が a〜b）」
const avgText = (name, digits = 2) => `平均 ${NORM[name].mean.toFixed(digits)}、9割の人が ${range90(name, digits)}`;

function fifthsNotes(inner, outer, z) {
  const notes = [`目と目の間は目の幅の ${inner.toFixed(2)} 倍（東アジア人男性の${avgText('innerToEye')}）。`];
  if (z.innerToEye > 1) notes.push('目の間が平均より広め。メガネはブリッジが太め・濃い色のものが合う。');
  if (z.innerToEye < -1) notes.push('目の間が平均より狭め。メガネはブリッジが細い・透明なものが合う。');
  notes.push(`目尻から輪郭までは目の幅の ${outer.toFixed(2)} 倍（${avgText('outerToEye')}）。`);
  if (z.outerToEye > 1) notes.push('目に対して顔の横幅が広め。サイドを抑えた髪型で横幅が締まって見える。');
  if (z.outerToEye < -1) notes.push('目に対して顔の横幅が狭め。サイドに少し厚みを出すとつり合う。');
  return notes;
}

function partsNotes(nose, mouth, lip, z) {
  const notes = [`小鼻の幅は目と目の間の ${nose.toFixed(2)} 倍（${avgText('noseToInner')}）。`];
  if (z.noseToInner > 1) notes.push('小鼻が平均より広め。');
  if (z.noseToInner < -1) notes.push('小鼻が平均より細め。');
  notes.push(`口の幅は小鼻の幅の ${mouth.toFixed(2)} 倍（${avgText('mouthToNose')}）。`);
  if (z.mouthToNose > 1) notes.push('口が平均より大きめ。');
  if (z.mouthToNose < -1) notes.push('口が平均より小さめ。');
  const { mean: mu, sd } = NORM.lipToChin;
  notes.push(`鼻の下〜口：口〜あご ＝ 1：${(1 / lip).toFixed(2)}（平均 1：${(1 / mu).toFixed(2)}、9割の人が 1：${(1 / (mu + 1.645 * sd)).toFixed(2)}〜1：${(1 / (mu - 1.645 * sd)).toFixed(2)}）。`);
  if (z.lipToChin > 1) notes.push('あごに対して鼻の下が長め。');
  if (z.lipToChin < -1) notes.push('鼻の下に対してあごが長め。');
  return notes;
}

function contourNotes(lenR, jawR, chin, z) {
  const notes = [`顔の縦横比は ${lenR.toFixed(2)}（額の高さを眉〜鼻の下と同じとみなした値。${avgText('length')}）。`];
  if (z.length > 1) notes.push('縦に長め。トップの高さを抑え、横に厚みを出すと整う。');
  if (z.length < -1) notes.push('縦に短め。トップに高さを出すと整う。');
  const { mean: jm, sd: js } = NORM.jaw;
  notes.push(`あごの幅は顔の幅の ${Math.round(jawR * 100)}％（平均 ${Math.round(jm * 100)}％、9割の人が ${Math.round((jm - 1.645 * js) * 100)}〜${Math.round((jm + 1.645 * js) * 100)}％）。`);
  if (z.jaw > 1) notes.push('エラが平均より張っている。丸みのあるメガネやサイドの丸みでやわらぐ。');
  if (z.jaw < -1) notes.push('あごが平均より細め。下側に重心のあるメガネや、サイドに少し厚みのある髪型が合う。');
  const [c0, c1] = range90('chin', 0).split('〜');
  notes.push(`あご先の角度は ${Math.round(chin)}°（平均 ${Math.round(NORM.chin.mean)}°、9割の人が ${c0}〜${c1}°）。`);
  if (z.chin > 1) notes.push('あご先が平均より丸く広め。');
  if (z.chin < -1) notes.push('あご先が平均よりとがっている。');
  return notes;
}

// 計測から結果一式を作る
export function analyze(P, hairline) {
  const m = measure(P, hairline);
  const s = scoreAll(m);
  const shape = faceShape(m);
  return { measures: m, score: s, shape };
}
