// 幾何計算：検出した顔を標準顔の向き・大きさにそろえる（Horn の四元数法）。
// 座標系は mesh-data.js と同じ（x=本人の左が＋, y=上が＋, z=手前が＋）。
import { CANONICAL } from './mesh-data.js';

const N = CANONICAL.length; // 468

// 遠近の補正：近くから撮ると手前（鼻）が大きく、奥（輪郭）が小さく写る。
// MediaPipe の z は x と同じ倍率の相対的な奥行きなので、奥行きの差÷焦点距離（画素）が
// 「その点の距離÷基準の距離 − 1」になる。各点を画像の中心から (1 + Δz/f) 倍し、遠くから撮ったのと同じ写り（正射影）に戻す。
// 撮影距離は要らない。焦点距離は画角から（config.js の CAMERA）。
export function perspectiveScaler(landmarks, width, focalPx) {
  let zMean = 0;
  for (let i = 0; i < N; i++) zMean += landmarks[i].z;
  zMean /= N;
  return (z) => 1 + ((z - zMean) * width) / focalPx;
}
export function undoPerspective(landmarks, width, height, focalPx) {
  const scaleAt = perspectiveScaler(landmarks, width, focalPx);
  return landmarks.map((p) => {
    const s = scaleAt(p.z);
    return { x: 0.5 + (p.x - 0.5) * s, y: 0.5 + (p.y - 0.5) * s, z: p.z };
  });
}

// 黒目の直径（画素）。撮影距離の目安に使う
export function irisDiameterPx(landmarks, width, height) {
  const d = (a, b) => Math.hypot((landmarks[a].x - landmarks[b].x) * width, (landmarks[a].y - landmarks[b].y) * height);
  return (d(469, 471) + d(470, 472) + d(474, 476) + d(475, 477)) / 4;
}

// MediaPipe の正規化座標（x右・y下・z奥が＋）を、画素単位の標準顔の座標系へ
export function toFaceAxes(landmarks, width, height) {
  return landmarks.map((p) => [p.x * width, -p.y * height, -p.z * width]);
}

// 対称行列の固有値分解（ヤコビ法）。戻り値は最大固有値の固有ベクトル
function maxEigenvector(A) {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (a[i][i] > a[best][best]) best = i;
  return v.map((row) => row[best]);
}

function quatToMatrix([w, x, y, z]) {
  return [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (y * x + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (z * x - w * y), 2 * (z * y + w * x), w * w - x * x - y * y + z * z],
  ];
}

// 検出点（toFaceAxes の結果）を標準顔に重ねる相似変換を求める
export function alignToCanonical(points) {
  const ca = [0, 0, 0], cb = [0, 0, 0];
  for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) { ca[k] += points[i][k]; cb[k] += CANONICAL[i][k]; }
  for (let k = 0; k < 3; k++) { ca[k] /= N; cb[k] /= N; }
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let sa = 0, sb = 0;
  for (let i = 0; i < N; i++) {
    const a = [points[i][0] - ca[0], points[i][1] - ca[1], points[i][2] - ca[2]];
    const b = [CANONICAL[i][0] - cb[0], CANONICAL[i][1] - cb[1], CANONICAL[i][2] - cb[2]];
    sa += a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
    sb += b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += a[r] * b[c];
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const K = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const q = maxEigenvector(K);
  const R = quatToMatrix(q);
  const scale = Math.sqrt(sb / sa);
  const apply = (p) => {
    const a = [p[0] - ca[0], p[1] - ca[1], p[2] - ca[2]];
    return [0, 1, 2].map((r) => scale * (R[r][0] * a[0] + R[r][1] * a[1] + R[r][2] * a[2]) + cb[r]);
  };
  // 正面の座標 → 元の画素単位の座標
  const invert = (p) => {
    const b = [(p[0] - cb[0]) / scale, (p[1] - cb[1]) / scale, (p[2] - cb[2]) / scale];
    return [0, 1, 2].map((r) => R[0][r] * b[0] + R[1][r] * b[1] + R[2][r] * b[2] + ca[r]);
  };
  return { R, scale, apply, invert, angles: headAngles(R) };
}

// 顔の向き（度）。R は「検出→正面」の回転なので、頭の回転はその逆（転置）H = Ry·Rx·Rz とみて分解する
// yaw＋：本人の左を向く　pitch＋：下を向く　roll＋：本人の左側が上がる
export function headAngles(R) {
  const H = [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
  const deg = 180 / Math.PI;
  return {
    yaw: Math.atan2(H[0][2], H[2][2]) * deg,
    pitch: Math.asin(Math.max(-1, Math.min(1, -H[1][2]))) * deg,
    roll: Math.atan2(H[1][0], H[1][1]) * deg,
  };
}

// 検出1回分を正面にそろえた点の配列（478点）にする
export function frontalize(landmarks, width, height) {
  const pts = toFaceAxes(landmarks, width, height);
  const fit = alignToCanonical(pts);
  return { points: pts.map(fit.apply), angles: fit.angles };
}

// 複数フレームの点を平均する
export function averagePoints(list) {
  const n = list[0].length;
  const out = Array.from({ length: n }, () => [0, 0, 0]);
  for (const pts of list) for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[i][k] += pts[i][k];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) out[i][k] /= list.length;
  return out;
}

export const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
