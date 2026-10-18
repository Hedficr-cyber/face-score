// 計測と採点。入力は正面にそろえた点（geometry.frontalize の points を平均したもの）。
import { PAIRS, MIDLINE } from './mesh-data.js';
import { SCORE, SHAPE, IRIS_MM } from './config.js';
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

  // 実寸（黒目の横幅から）
  const iris = mean([dist2(P[469], P[471]), dist2(P[470], P[472]), dist2(P[474], P[476]), dist2(P[475], P[477])]);
  const mmPerUnit = IRIS_MM / iris;

  return {
    hairline: { source: hairSet ? 'manual' : 'estimated', y: hairY },
    browY, subY, menY,
    thirds: { upper, middle, lower, total: upper + middle + lower, hairlineSet: hairSet },
    fifths, width, eyeW, inner, nose, mouth, upperLip, chinH, jaw, forehead, chinAngle,
    length: hairY - menY,
    asymmetry,
    asymRegions,
    browTilt: heightDiff([300, 293, 334, 296, 336], [70, 63, 105, 66, 107]),
    eyeTilt: heightDiff([386, 374], [159, 145]),
    mouthTilt: (y(291) - y(61)) / width,
    mm: {
      width: width * mmPerUnit,
      temple: (x(356) - x(127)) * mmPerUnit,
      pd: dist2(P[468], P[473]) * mmPerUnit,
      eye: eyeW * mmPerUnit,
      inner: inner * mmPerUnit,
    },
  };
}

// 顔の形（近い順の確率）
export function faceShape(m) {
  const f = {
    length: m.length / m.width,
    jaw: m.jaw / m.width,
    forehead: m.forehead / m.width,
    chin: m.chinAngle,
  };
  const lenScale = m.thirds.hairlineSet ? SHAPE.scale.length : SHAPE.lengthScaleEstimated;
  const scores = Object.entries(SHAPE.prototypes).map(([key, p]) => {
    const d2 = ((f.length - p.length) / lenScale) ** 2 + ((f.jaw - p.jaw) / SHAPE.scale.jaw) ** 2
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

  // 横のバランス
  const fsum = m.fifths.reduce((s, v) => s + v, 0);
  const fparts = m.fifths.map((v) => v / fsum);
  const fifthsDev = rms(fparts.map((v) => (v - I.fifths) / I.fifths));
  items.fifths = {
    score: gauss(fifthsDev, T.fifths),
    value: fifthsDev,
    parts: fparts,
    notes: fifthsNotes(m),
  };

  // パーツの配置
  const r1 = m.nose / m.inner, r2 = m.mouth / m.nose, r3 = m.upperLip / m.chinH;
  const partsDev = rms([(r1 - I.noseToInner) / I.noseToInner, (r2 - I.mouthToNose) / I.mouthToNose, (r3 - I.lipToChin) / I.lipToChin]);
  items.parts = {
    score: gauss(partsDev, T.parts),
    value: partsDev,
    ratios: { noseToInner: r1, mouthToNose: r2, lipToChin: r3 },
    notes: [
      `小鼻の幅は目と目の間の ${r1.toFixed(2)} 倍（理想 1.00）。`,
      `口の幅は小鼻の幅の ${r2.toFixed(2)} 倍（理想 1.50）。`,
      `鼻の下〜口：口〜あご ＝ 1：${(1 / r3).toFixed(2)}（理想 1：2）。`,
    ],
  };

  // 輪郭（標準顔＝卵型からの離れ具合）
  const R = SHAPE.reference;
  const lenR = m.length / m.width, jawR = m.jaw / m.width;
  const comps = [(jawR - R.jaw) / R.jaw, (m.chinAngle - R.chin) / R.chin];
  if (t3.hairlineSet) comps.unshift((lenR - R.length) / R.length);
  const contourDev = rms(comps);
  items.contour = {
    score: gauss(contourDev, T.contour),
    value: contourDev,
    notes: contourNotes(lenR, jawR, m.chinAngle, t3.hairlineSet),
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

function fifthsNotes(m) {
  const r = m.inner / m.eyeW;
  const notes = [`目と目の間は目の幅の ${r.toFixed(2)} 倍（理想 1.00）。`];
  if (r > 1.12) notes.push('目の間がやや広め。メガネはブリッジが太め・濃い色のものが合う。');
  if (r < 0.9) notes.push('目の間がやや狭め。メガネはブリッジが細い・透明なものが合う。');
  const outer = (m.fifths[0] + m.fifths[4]) / 2 / m.eyeW;
  notes.push(`目尻から輪郭までは目の幅の ${outer.toFixed(2)} 倍。`);
  return notes;
}

function contourNotes(lenR, jawR, chin, hairSet) {
  const R = SHAPE.reference;
  const notes = [];
  if (hairSet) {
    notes.push(`顔の長さは幅の ${lenR.toFixed(2)} 倍（卵型の目安 ${R.length.toFixed(2)}）。`);
    if (lenR > R.length * 1.05) notes.push('縦に長め。トップの高さを抑え、横に厚みを出すと整う。');
    if (lenR < R.length * 0.95) notes.push('縦に短め。トップに高さを出すと整う。');
  }
  notes.push(`あごの幅は顔の幅の ${Math.round(jawR * 100)}％（卵型の目安 ${Math.round(R.jaw * 100)}％）。`);
  if (jawR > R.jaw * 1.05) notes.push('エラがやや張っている。丸みのあるメガネやサイドの丸みでやわらぐ。');
  if (jawR < R.jaw * 0.95) notes.push('あごが細め。下側に重心のあるメガネや、サイドに少し厚みのある髪型が合う。');
  notes.push(`あご先の角度は ${Math.round(chin)}°（卵型の目安 ${R.chin}°）。`);
  return notes;
}

// 計測から結果一式を作る
export function analyze(P, hairline) {
  const m = measure(P, hairline);
  const s = scoreAll(m);
  const shape = faceShape(m);
  return { measures: m, score: s, shape };
}
