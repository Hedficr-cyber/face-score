// カメラの自己較正：同じ顔を「近く」と「遠く」から撮ると、遠近の歪みの大きさだけが違う。
// 焦点距離 f を変えながら両方を補正し、補正後の形がいちばん一致する f を選ぶ（顔の形は変わらないので）。
// MediaPipe の奥行き（z）の倍率のずれも、この f にまとめて吸収される。メジャーは要らない。
import { undoPerspective, toFaceAxes, alignToCanonical } from './geometry.js';
import { CANONICAL } from './mesh-data.js';

// zScale：MediaPipe の奥行き（z）の倍率の補正（較正で求める。1 なら補正なし）
export function frontalFromRaw(raw, w, h, focal, zScale = 1) {
  const src = zScale === 1 ? raw : raw.map((p) => ({ x: p.x, y: p.y, z: p.z * zScale }));
  const pts = toFaceAxes(undoPerspective(src, w, h, focal), w, h);
  const fit = alignToCanonical(pts);
  return pts.map(fit.apply);
}

// 2つの正面の形の差（468点の x・y の二乗平均。顔の幅に対する割合）
function shapeGap(A, B) {
  let s = 0;
  for (let i = 0; i < 468; i++) s += (A[i][0] - B[i][0]) ** 2 + (A[i][1] - B[i][1]) ** 2;
  return Math.sqrt(s / 468) / (A[454][0] - A[234][0]);
}

// near・far：撮影ごとの平均した生の点（正規化座標の配列）。同じ解像度で撮ったもの
export function solveFocal(nearShots, farShots, w, h) {
  const L = Math.max(w, h);
  const gapAt = (f) => {
    const A = nearShots.map((r) => frontalFromRaw(r, w, h, f));
    const B = farShots.map((r) => frontalFromRaw(r, w, h, f));
    let s = 0, n = 0;
    for (const a of A) for (const b of B) { s += shapeGap(a, b); n += 1; }
    return s / n;
  };
  // 粗く探してから、黄金分割法で詰める（f は長い辺の 0.3〜3 倍の範囲）
  const grid = [];
  for (let r = 0.3; r <= 3.0001; r *= 1.08) grid.push(r * L);
  const gaps = grid.map(gapAt);
  let k = gaps.indexOf(Math.min(...gaps));
  let lo = grid[Math.max(0, k - 1)], hi = grid[Math.min(grid.length - 1, k + 1)];
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = gapAt(x1), f2 = gapAt(x2);
  for (let i = 0; i < 30; i++) {
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = gapAt(x1); }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = gapAt(x2); }
  }
  const focal = (lo + hi) / 2;
  const best = gapAt(focal);
  // 曲線のとがり具合（f を ±15% 動かしたときの差の増え方）で、決まり方の確かさを見る
  const sharp = Math.min(gapAt(focal * 0.85), gapAt(focal * 1.15)) / best;
  const atEdge = k === 0 || k === grid.length - 1;
  return { focal, ratio: focal / L, gap: best, sharp, atEdge, uncorrectedGap: gapAt(1e9) };
}

// 向きをまたいだ形の差は 468 点すべてで見る（2026-10-19 の実測2回では、顔の内側だけ・動きにくい点だけより、すべての点のほうが結果がそろった）
const TURN_POINTS = CANONICAL.map((_, i) => i);

function turnGap(A, B) {
  let s = 0;
  for (const i of TURN_POINTS) s += (A[i][0] - B[i][0]) ** 2 + (A[i][1] - B[i][1]) ** 2;
  return Math.sqrt(s / TURN_POINTS.length) / (A[454][0] - A[234][0]);
}

// 1変数の最小値探し（対数の目盛りで粗く探してから黄金分割法）
function minimize1d(fn, lo0, hi0, step) {
  const grid = [];
  for (let x = lo0; x <= hi0 * 1.0001; x *= step) grid.push(x);
  const vals = grid.map(fn);
  const k = vals.indexOf(Math.min(...vals));
  let lo = grid[Math.max(0, k - 1)], hi = grid[Math.min(grid.length - 1, k + 1)];
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = fn(x1), f2 = fn(x2);
  for (let i = 0; i < 24; i++) {
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = fn(x1); }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = fn(x2); }
  }
  return { x: (lo + hi) / 2, atEdge: k === 0 || k === grid.length - 1 };
}

// 顔を回すスキャン（Face ID の登録のように上下左右）から焦点距離を求める。
// 顔を横に向けると、カメラに近い側の頬は大きく・遠い側は小さく写る（向きで歪みが反対になる）。
// 正しい焦点距離で補正すると、どの向きから正面にそろえても同じ形になる。その一致がいちばん良い f を選ぶ。
// 横を向いた顔を正面に戻すときは奥行き（z）も効くので、z の倍率 zScale も同時に求める。
// views：向きごとの生の点（正規化座標）の配列
export function solveFocalFromTurns(views, w, h) {
  const L = Math.max(w, h);
  const gapAt = (f, zs) => {
    const F = views.map((r) => frontalFromRaw(r, w, h, f, zs));
    let s = 0, n = 0;
    for (let a = 0; a < F.length; a++) for (let b = a + 1; b < F.length; b++) { s += turnGap(F[a], F[b]); n += 1; }
    return s / n;
  };
  // 測定に効くのは fe＝f÷zScale（正面の顔の遠近の補正の強さ）。fe と zScale を軸にすると互いに引きずられにくい
  const gapFe = (fe, zs) => gapAt(fe * zs, zs);
  let fe = 0.8 * L, zs = 1, edge = false;
  for (let round = 0; round < 8; round++) {
    const r = minimize1d((x) => gapFe(x, zs), 0.3 * L, 3 * L, 1.08);
    fe = r.x; edge = r.atEdge;
    zs = minimize1d((x) => gapFe(fe, x), 0.5, 2, 1.05).x;
  }
  const best = gapFe(fe, zs);
  // fe を 0.6 倍・1.7 倍にして、そのたびに zScale を合わせ直したときの差の増え方で、決まり方の確かさを見る
  // （実際の顔の点は向きで少し動くので、±15% のような狭い幅では差が出にくい）
  const refit = (x) => gapFe(x, minimize1d((z) => gapFe(x, z), 0.5, 2, 1.1).x);
  const sharp = Math.min(refit(fe * 0.6), refit(fe * 1.7)) / best;
  return { focal: fe * zs, fe, zScale: zs, ratio: (fe * zs) / L, gap: best, sharp, atEdge: edge, uncorrectedGap: gapAt(1e9, 1) };
}

// 水平・垂直の画角（度）。表示用
export function fovDegrees(focal, w, h) {
  return { h: (2 * Math.atan(w / 2 / focal) * 180) / Math.PI, v: (2 * Math.atan(h / 2 / focal) * 180) / Math.PI };
}
