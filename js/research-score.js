// 研究の知見にもとづく採点（左右対称・平均顔への近さ・男らしさの度合い）。
// 入力は正面にそろえた点 P（geometry.js の正面化。アプリでは遠近を補正したもの）。
// 基準集団の数値（平均顔・各指標の分布・姿勢の補正）は research-reference.js（_work で計算して生成。写真は含まない）。
import { measure } from './analysis.js';
import { LINES } from './mesh-data.js';

// 平均顔への近さは、顔の内側の点（目・眉・鼻・口）だけで測る。
// 輪郭の点は撮影距離（遠近）で大きく動き、撮影条件の違う集団の平均顔と比べると意味を失う（2026-10-19 の検証：
// SCUT の評価との相関が すべての点 0.27→0.01、内側の点 0.26→0.17）。
const NOSE_POINTS = [1, 2, 4, 5, 6, 168, 197, 195, 98, 327, 129, 358, 64, 294, 48, 278, 49, 279, 97, 326, 94, 19];
export const INNER_POINTS = [...new Set([...['leftEye', 'rightEye', 'leftBrow', 'rightBrow', 'lips'].flatMap((k) => LINES[k].flat()), ...NOSE_POINTS])];

// ---- 平均顔への近さ：2次元のプロクラステス距離（位置・大きさ・回転をそろえた後のずれ） ----
function centered(S) {
  let cx = 0, cy = 0;
  for (const [x, y] of S) { cx += x; cy += y; }
  cx /= S.length; cy /= S.length;
  const C = S.map(([x, y]) => [x - cx, y - cy]);
  let r = 0;
  for (const [x, y] of C) r += x * x + y * y;
  r = Math.sqrt(r / C.length);
  return C.map(([x, y]) => [x / r, y / r]);
}
export function shape2d(P) {
  return centered(INNER_POINTS.map((i) => [P[i][0], P[i][1]]));
}
// A を B に重ねる最適な回転（2次元）と、重ねた後の RMS のずれ
export function procrustes(A, B) {
  let sxx = 0, sxy = 0;
  for (let i = 0; i < A.length; i++) { sxx += A[i][0] * B[i][0] + A[i][1] * B[i][1]; sxy += A[i][0] * B[i][1] - A[i][1] * B[i][0]; }
  const th = Math.atan2(sxy, sxx), c = Math.cos(th), s = Math.sin(th);
  const R = A.map(([x, y]) => [c * x - s * y, s * x + c * y]);
  let d = 0;
  for (let i = 0; i < R.length; i++) d += (R[i][0] - B[i][0]) ** 2 + (R[i][1] - B[i][1]) ** 2;
  return { aligned: R, dist: Math.sqrt(d / R.length) };
}

// ---- 男らしさ：研究でよく報告される性差の向き（男性ほど 大きい=+1／小さい=−1）----
// あごが広い・顔の下半分とあごが長い・眉が目に近い（低い）・目が小さい・唇が薄い・小鼻が広い
// （男性的な特徴の例：薄い唇・角ばったあご・小さい目 ＝ Rhodes 2006 が引く Keating 1985 など）。
// 長さは「目と目の中心の距離」で割る（撮影距離で動きにくい。顔の幅で割ると遠近の影響を受ける）。
export const MASC_FEATURES = {
  jaw: { sign: +1, label: 'あごの幅' },
  lowerFace: { sign: +1, label: '鼻の下〜あごの長さ' },
  chinH: { sign: +1, label: '口〜あごの長さ' },
  browEye: { sign: -1, label: '眉と目の距離' },
  eyeOpen: { sign: -1, label: '目の縦の開き' },
  eyeWidth: { sign: -1, label: '目の横幅' },
  lips: { sign: -1, label: '唇の厚さ' },
  nose: { sign: +1, label: '小鼻の幅' },
};
const avgY = (P, idx) => idx.reduce((s, i) => s + P[i][1], 0) / idx.length;
const BROW_LOWER_R = [46, 53, 52, 65, 55], BROW_LOWER_L = [276, 283, 282, 295, 285];
export function mascFeatures(P) {
  const x = (i) => P[i][0], y = (i) => P[i][1];
  const iod = Math.hypot((P[263][0] + P[362][0] - P[33][0] - P[133][0]) / 2, (P[263][1] + P[362][1] - P[33][1] - P[133][1]) / 2);
  return {
    jaw: (x(397) - x(172)) / iod,
    lowerFace: (y(2) - y(152)) / iod,
    chinH: ((y(13) + y(14)) / 2 - y(152)) / iod,
    browEye: ((avgY(P, BROW_LOWER_R) - y(159)) + (avgY(P, BROW_LOWER_L) - y(386))) / 2 / iod,
    eyeOpen: ((y(159) - y(145)) + (y(386) - y(374))) / 2 / iod,
    eyeWidth: ((x(133) - x(33)) + (x(263) - x(362))) / 2 / iod,
    lips: ((y(0) - y(13)) + (y(14) - y(17))) / iod,
    nose: (x(358) - x(129)) / iod,
  };
}

// ---- 生の指標（姿勢の補正前）----
export function rawIndices(P, meanShape) {
  const m = measure(P, null);
  const mf = mascFeatures(P);
  return {
    asymmetry: m.asymmetry,
    averageness: meanShape ? procrustes(shape2d(P), meanShape).dist : null,
    masc: mf,
  };
}

// 姿勢・表情・解像度の補正：基準集団で「正面・無表情・高解像度」で撮った場合の値へそろえる
export function covariates(c) {
  return [Math.abs(c.yaw || 0), Math.abs(c.pitch || 0), c.smile || 0, 100 / Math.max(60, c.facePx || 600)];
}
export function adjust(value, coef, cov) {
  if (!coef) return value;
  return value - coef.reduce((s, b, k) => s + b * cov[k], 0);
}

// 基準集団の並び（昇順）の中で何番目か → 0〜100（中央が50。同じ値は真ん中の順位）
export function percentile(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  let eq = lo;
  while (eq < sorted.length && sorted[eq] === v) eq++;
  return (100 * (lo + (eq - lo) / 2)) / sorted.length;
}

// 男らしさの好み：ちょうど良い所（optimum。標準化した男らしさ）からの離れ具合の2乗を、基準集団で標準化
// （2026-10-19 の SCUT の前半：男性的なほど評価が下がり、女性寄り 1 標準偏差あたりから先は横ばい）
export function mascPreference(m, pref) {
  return (-((m - pref.optimum) ** 2) - pref.mean) / pref.sd;
}

// ---- 採点：ref は research-reference.js の REFERENCE ----
// cov：本人の撮影条件（顔の向き・笑顔・顔の幅の画素）。アプリの測定は正面・無表情・高解像度なので、ほぼ 0 の補正
export function researchScore(P, ref, cov = {}) {
  const c = covariates(cov);
  const raw = rawIndices(P, ref.meanShape);
  const asym = adjust(raw.asymmetry, ref.coef.asymmetry, c);
  const avg = adjust(raw.averageness, ref.coef.averageness, c);
  const mascZ = Object.entries(MASC_FEATURES).map(([k, f]) => {
    const v = adjust(raw.masc[k], ref.coef.masc[k], c);
    return f.sign * (v - ref.masc[k].mean) / ref.masc[k].sd;
  });
  const masc = (mascZ.reduce((s, v) => s + v, 0) / mascZ.length - ref.mascComposite.mean) / ref.mascComposite.sd;
  // 各要素を「良い方が大きい」標準化した値に
  const s = {
    symmetry: -(asym - ref.asymmetry.mean) / ref.asymmetry.sd,
    averageness: -(avg - ref.averageness.mean) / ref.averageness.sd,
    masculinity: mascPreference(masc, ref.mascPreference),
  };
  const w = ref.weights;
  const composite = w.symmetry * s.symmetry + w.averageness * s.averageness + w.masculinity * s.masculinity;
  return {
    total: percentile(ref.compositeSorted, composite),
    composite,
    parts: {
      symmetry: { value: asym, z: s.symmetry, pct: percentile(ref.sortedParts.symmetry, s.symmetry) },
      averageness: { value: avg, z: s.averageness, pct: percentile(ref.sortedParts.averageness, s.averageness) },
      masculinity: { value: masc, z: s.masculinity, pct: percentile(ref.sortedParts.masculinity, s.masculinity), mascIndex: masc },
    },
    raw,
  };
}
