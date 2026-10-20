// 研究の知見にもとづく採点（左右対称・平均顔への近さ・男らしさの度合い）。
// 入力は正面にそろえた点 P（geometry.js の正面化。アプリでは遠近を補正したもの）。
// 基準集団の数値（平均顔・各指標の分布・姿勢の補正）は research-reference.js（_work で計算して生成。写真は含まない）。
import { measure } from './analysis.js';
import { LINES } from './mesh-data.js';

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}
function validDistribution(sorted) {
  if (!Array.isArray(sorted) || !sorted.length) throw new Error('reference distribution must not be empty');
  for (let i = 0; i < sorted.length; i++) {
    finite(sorted[i], 'reference value');
    if (i && sorted[i] < sorted[i - 1]) throw new Error('reference distribution must be sorted');
  }
}

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
  if (!Number.isFinite(r) || r <= 1e-9) throw new Error('face shape is degenerate');
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
  if (!Number.isFinite(iod) || iod <= 1e-9) throw new Error('eye-center distance is degenerate');
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
  for (const key of ['yaw', 'pitch', 'smile', 'facePx']) if (c[key] != null) finite(c[key], key);
  if (c.facePx != null && c.facePx <= 0) throw new Error('facePx must be positive');
  return [Math.abs(c.yaw || 0), Math.abs(c.pitch || 0), c.smile || 0, 100 / Math.max(60, c.facePx || 600)];
}
export function adjust(value, coef, cov) {
  if (!coef) return value;
  return value - coef.reduce((s, b, k) => s + b * cov[k], 0);
}

// 基準集団の並び（昇順）の中で何番目か → 0〜100（中央が50。同じ値は真ん中の順位）
export function percentile(sorted, v) {
  validDistribution(sorted);
  finite(v, 'value');
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
  let eq = lo;
  while (eq < sorted.length && sorted[eq] === v) eq++;
  return (100 * (lo + (eq - lo) / 2)) / sorted.length;
}

// ---- 順位の参考範囲（既定は名目90%の係数）----
// 2つの誤差を合わせる。
// ① 基準の人数が少ないことによる順位の揺れ：「基準の人のうち何割より上か」を二項分布のウィルソン区間で見る
// ② 測定の揺れ：撮影ごとの合成値のばらつき（標準誤差 se）を、基準の並びの上で順位の揺れに直す
// ①と②は独立なので、正規分布の目盛り（プロビット）の上で二乗和にして合わせる（単純に足すと広すぎる）。
// 著名人中心という基準の偏りの大きさは測れないので、この範囲には含まれない。
// モデル誤差や、少数の撮影から推定した se 自体の不確かさも含まない。実利用で90%の被覆を保証する式ではない。
function erf(x) {
  const sg = Math.sign(x), a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  return sg * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
}
export const normCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
// 標準正規分布の逆関数（Acklam の近似）
export function normInv(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const tail = (q) => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
export function percentileInterval(sorted, value, se = 0, z = 1.645) {
  finite(se, 'standard error');
  finite(z, 'interval multiplier');
  if (se < 0 || z <= 0) throw new Error('standard error must be nonnegative and interval multiplier must be positive');
  finite(z * z, 'squared interval multiplier');
  const n = sorted.length;
  const p = percentile(sorted, value) / 100;
  const wilson = (sign) => {
    const z2 = z * z, dn = 1 + z2 / n;
    const cc = (p + z2 / (2 * n)) / dn, h = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / dn;
    return Math.min(1, Math.max(0, cc + sign * h));
  };
  const lo = wilson(-1), hi = wilson(+1);
  if (!(se > 0)) return [100 * lo, 100 * hi];
  // 基準の並びを線でつないだ順位（測定の揺れで合成値が少し動いたときの順位の動き）
  const smooth = (v) => {
    if (v <= sorted[0]) return 0.5 / n;
    if (v >= sorted[n - 1]) return 1 - 0.5 / n;
    let i = 0;
    while (sorted[i + 1] <= v) i++;
    const gap = sorted[i + 1] - sorted[i];
    return (i + 0.5 + (gap > 0 ? (v - sorted[i]) / gap : 0)) / n;
  };
  const q = normInv(Math.min(1 - 0.5 / n, Math.max(0.5 / n, p)));
  const qs = normInv(smooth(value));
  const mL = qs - normInv(smooth(value - z * se)), mU = normInv(smooth(value + z * se)) - qs;
  const out = (bound, m, sign) => {
    if (bound <= 0 || bound >= 1) return bound;
    const r = Math.abs(normInv(bound) - q);
    return normCdf(q + sign * Math.sqrt(r * r + m * m));
  };
  return [100 * out(lo, mL, -1), 100 * out(hi, mU, +1)];
}

// 男らしさの好み：ちょうど良い所（optimum。標準化した男らしさ）からの離れ具合の2乗を、基準集団で標準化
// （2026-10-19 の SCUT の前半：男性的なほど評価が下がり、女性寄り 1 標準偏差あたりから先は横ばい）
export function mascPreference(m, pref) {
  return (-((m - pref.optimum) ** 2) - pref.mean) / pref.sd;
}

// ---- 10段階：基準集団の中の順位（0〜100）を、10人に1人ずつの段階にする（1＝下位10%・10＝上位10%）----
export function levelOf(pct) { return Math.min(10, Math.max(1, Math.ceil(finite(pct, 'percentile') / 10))); }
export const LEVEL_WORDS = ['', '下位', '下位', '平均よりやや下', '平均よりやや下', '平均くらい', '平均くらい', '平均より上', '平均より上', '上位', '上位'];

// ---- 部位ごとのプラス・マイナス ----
// 重み（ref.partWeights）は、日本人の評価者の「魅力の向き」（Nakamura & Watanabe 2020 の動画）に沿って顔を 1 SD 動かしたとき、
// 各特徴（日本人男性の基準で標準化）がどれだけ動くか。部位の点＝その部位の特徴を、日本人の評価者が好む向きに測ったもの（標準偏差の単位）。
// 重みの大きさ＝その部位が魅力の向きにどれだけ効くか（目が最も大きい）。鼻すじ・鷲鼻などの高さは正面の写真では測れないので入れない。
export const PARTS = [
  { key: 'eyes', name: '目', features: ['eyeOpen', 'eyeWidth'] },
  { key: 'brows', name: '眉と目の間', features: ['browEye'] },
  { key: 'jaw', name: 'あご・輪郭', features: ['jaw', 'lowerFace', 'chinH'] },
  { key: 'nose', name: '小鼻', features: ['nose'] },
  { key: 'lips', name: '唇', features: ['lips'] },
];
export function partAnalysis(featZ, weights) {
  return PARTS.map((p) => {
    const w = p.features.map((k) => weights[k] || 0);
    const z = p.features.map((k) => featZ[k]);
    const influence = Math.hypot(...w);
    const score = influence > 0 ? w.reduce((s, wk, i) => s + wk * z[i], 0) / influence : 0;
    return { key: p.key, name: p.name, score, influence, items: p.features.map((k, i) => ({ key: k, z: z[i], weight: w[i] })) };
  });
}

// ---- 日本人の好みの向き ----
// Nakamura & Watanabe 2020（Sci Rep 10:16588、データ CC0）が日本人の評価者の評定から作った「魅力が上がる顔の変化」の動画
// （CG の東アジア人男性）を同じ方法で測り、目・眉・鼻・口の形（平均顔に重ねた2次元）が SD とともに動く向きを求めたもの。
// 本人の形が平均顔からその向きにどれだけ寄っているか（射影）を出す。direction は単位ベクトル（INNER_POINTS の x,y の順）。
export function japaneseProjection(P, meanShape, direction) {
  const s = procrustes(shape2d(P), meanShape).aligned;
  let t = 0;
  for (let i = 0; i < s.length; i++) t += (s[i][0] - meanShape[i][0]) * direction[2 * i] + (s[i][1] - meanShape[i][1]) * direction[2 * i + 1];
  return t;
}

// ---- 採点：ref は research-reference.js の REFERENCE ----
// cov：本人の撮影条件（顔の向き・笑顔・顔の幅の画素）。アプリの測定は正面・無表情・高解像度なので、ほぼ 0 の補正
export function researchScore(P, ref, cov = {}) {
  // 読み込み値や幾何計算の異常を、最下位の点数として表示しない。
  if (!Array.isArray(P) || P.length !== 478 || P.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((v) => typeof v !== 'number' || !Number.isFinite(v)))) {
    throw new Error('face landmarks must contain 478 finite 3D points');
  }
  const c = covariates(cov);
  const raw = rawIndices(P, ref.meanShape);
  const asym = adjust(raw.asymmetry, ref.coef.asymmetry, c);
  const avg = adjust(raw.averageness, ref.coef.averageness, c);
  // 特徴ごとの標準化した値（日本人男性の基準で。大きいほどその特徴が大きい）
  const features = Object.fromEntries(Object.keys(MASC_FEATURES).map((k) => [k, (adjust(raw.masc[k], ref.coef.masc[k], c) - ref.masc[k].mean) / ref.masc[k].sd]));
  const mascZ = Object.entries(MASC_FEATURES).map(([k, f]) => f.sign * features[k]);
  const masc = (mascZ.reduce((s, v) => s + v, 0) / mascZ.length - ref.mascComposite.mean) / ref.mascComposite.sd;
  // 各要素を「良い方が大きい」標準化した値に
  const s = {
    symmetry: -(asym - ref.asymmetry.mean) / ref.asymmetry.sd,
    averageness: -(avg - ref.averageness.mean) / ref.averageness.sd,
    masculinity: mascPreference(masc, ref.mascPreference),
  };
  const extra = {};
  if (ref.japanese) {
    // 日本人の好みの向き（形）：目・眉・鼻・口の形が、日本人の評価者の「魅力」の向きにどれだけ寄っているか
    const proj = adjust(japaneseProjection(P, ref.meanShape, ref.japanese.direction), ref.japanese.coef, c);
    s.japanese = (proj - ref.japanese.mean) / ref.japanese.sd;
    extra.japanese = { value: proj, z: s.japanese, pct: percentile(ref.sortedParts.japanese, s.japanese) };
  }
  if (ref.featureJapanese && ref.partWeights) {
    // 部位の特徴（日本人の好み）：8つの特徴を、日本人の評価者が好む向きの重みで合成（部位ごとのプラス・マイナスの合計）
    const fj = Object.keys(ref.partWeights).reduce((t, k) => t + ref.partWeights[k] * features[k], 0);
    s.featureJapanese = (fj - ref.featureJapanese.mean) / ref.featureJapanese.sd;
    extra.featureJapanese = { value: fj, z: s.featureJapanese, pct: percentile(ref.sortedParts.featureJapanese, s.featureJapanese) };
  }
  // 総合：各要素（日本人の基準で標準化）を、答え合わせの前半で決めた重みで足す
  const w = ref.weights;
  const composite = Object.keys(w).reduce((t, k) => t + (w[k] || 0) * (s[k] ?? 0), 0);
  finite(composite, 'composite score');
  return {
    total: percentile(ref.compositeSorted, composite),
    composite,
    parts: {
      symmetry: { value: asym, z: s.symmetry, pct: percentile(ref.sortedParts.symmetry, s.symmetry) },
      averageness: { value: avg, z: s.averageness, pct: percentile(ref.sortedParts.averageness, s.averageness) },
      masculinity: { value: masc, z: s.masculinity, pct: percentile(ref.sortedParts.masculinity, s.masculinity), mascIndex: masc },
      ...extra,
    },
    features,
    ...(ref.partWeights ? { partsDetail: partAnalysis(features, ref.partWeights) } : {}),
    raw,
  };
}

// ---- 要素ごとの点数への効き（v0.11・2026-10-20）----
// 「この要素が日本人男性の基準の平均だったら、総合点が何点変わるか」（ほかの要素はそのまま）。
// 正の値＝その要素が点数を下げている（平均なら上がる）。負の値＝点数を上げている（平均なら下がる）。
// 部位（目・眉と目の間・あご・小鼻・唇）は、その部位の特徴（標準化した値）を 0 にして、「部位の特徴」と「男らしさのバランス」を
// 計算し直す。顔全体の形・平均顔への近さは、その要素の標準化した値を 0（基準の平均）にする。要素どうしは独立ではないため、
// 足し合わせても総合点の差とは一致しない（1つずつ動かしたときの目安）。
export const ELEMENTS = [
  ...PARTS.map((p) => ({ key: p.key, name: p.name, features: p.features })),
  { key: 'japanese', name: '顔全体の形', component: 'japanese' },
  { key: 'averageness', name: '平均顔への近さ', component: 'averageness' },
];
// features（8特徴の標準化した値）と、ほかの要素の標準化した値 s から、総合点（0〜100）を作る。researchScore と同じ式
function totalFrom(features, s, ref) {
  const mascZ = Object.entries(MASC_FEATURES).map(([k, f]) => f.sign * features[k]);
  const masc = (mascZ.reduce((t, v) => t + v, 0) / mascZ.length - ref.mascComposite.mean) / ref.mascComposite.sd;
  const z = { ...s, masculinity: mascPreference(masc, ref.mascPreference) };
  if (ref.featureJapanese && ref.partWeights) {
    const fj = Object.keys(ref.partWeights).reduce((t, k) => t + ref.partWeights[k] * features[k], 0);
    z.featureJapanese = (fj - ref.featureJapanese.mean) / ref.featureJapanese.sd;
  }
  const composite = Object.keys(ref.weights).reduce((t, k) => t + (ref.weights[k] || 0) * (z[k] ?? 0), 0);
  finite(composite, 'composite score');
  return { total: percentile(ref.compositeSorted, composite), composite };
}
const otherParts = (res) => Object.fromEntries(['symmetry', 'averageness', 'japanese'].filter((k) => res.parts[k]).map((k) => [k, res.parts[k].z]));
// res：researchScore の結果。返り値は効きの大きい順（点数を下げている要素が先）
export function elementImpacts(res, ref) {
  const base = totalFrom(res.features, otherParts(res), ref).total;
  return ELEMENTS.filter((e) => e.features || res.parts[e.component]).map((e) => {
    const f = { ...res.features }, s = otherParts(res);
    if (e.features) for (const k of e.features) f[k] = 0; else s[e.component] = 0;
    return { key: e.key, name: e.name, points: totalFrom(f, s, ref).total - base };
  }).sort((a, b) => b.points - a.points);
}
// 基準の真ん中の人（すべて平均）で、各要素が1標準偏差ぶん好まれない向きにずれたら総合点が何点下がるか（要素の効きの大きさ）。
// 部位は、日本人の評価者が好む向き（partWeights）の反対へ、その部位の特徴をまとめて1標準偏差動かす。
export function elementSensitivity(ref) {
  const zero = Object.fromEntries(Object.keys(MASC_FEATURES).map((k) => [k, 0]));
  const s0 = { symmetry: 0, averageness: 0, ...(ref.japanese ? { japanese: 0 } : {}) };
  const base = totalFrom(zero, s0, ref).total;
  return ELEMENTS.filter((e) => e.features || e.component in s0).map((e) => {
    const f = { ...zero }, s = { ...s0 };
    if (e.features) {
      const w = e.features.map((k) => ref.partWeights?.[k] || 0), len = Math.hypot(...w);
      e.features.forEach((k, i) => { f[k] = len > 0 ? -w[i] / len : 0; });
    } else s[e.component] = -1;
    return { key: e.key, name: e.name, points: base - totalFrom(f, s, ref).total };
  }).sort((a, b) => b.points - a.points);
}
export const recomputeTotal = (res, ref) => totalFrom(res.features, otherParts(res), ref).total; // 要素を動かさずに計算し直した総合点（researchScore と一致するかの確認用）
// 8特徴の一部を差し替えて総合点（0〜100）を計算し直す（v0.12）。例：目の縦の開きを本人のいつもの値にしたら何点か
export function totalWithFeatures(res, ref, overrides = {}) {
  for (const [k, v] of Object.entries(overrides)) { if (!(k in res.features)) throw new Error('unknown feature ' + k); finite(v, k); }
  return totalFrom({ ...res.features, ...overrides }, otherParts(res), ref).total;
}
