// 正面にそろえた点から、顔の線画（SVG）と比率の補助線を描く。写真は使わない。
// 鏡と同じ向き（本人の左が画面の左）で描く。
import { LINES, PAIRS, MIDLINE } from './mesh-data.js';
import { mean } from './geometry.js';

const FACE = ['oval', 'leftEye', 'rightEye', 'leftBrow', 'rightBrow', 'lips'];
const NOSE = [[98, 97], [97, 2], [2, 326], [326, 327], [98, 64], [327, 294], [6, 197], [197, 195], [195, 5]];

export function portraitSVG(P, m, mode) {
  const W = m.width;
  const s = 100 / W;
  const pad = 14;
  const xs = [234, 454, 127, 356].map((i) => -P[i][0]);
  const minX = Math.min(...xs);
  const topY = Math.max(m.hairline.y, P[10][1]);
  const X = (x) => (-x - minX) * s + pad;
  const Y = (y) => (topY - y) * s + pad + 6;
  const vbW = (Math.max(...xs) - minX) * s + pad * 2 + 22;
  const vbH = (topY - P[152][1]) * s + pad * 2 + 12;
  const seg = (a, b) => `M${X(P[a][0]).toFixed(2)} ${Y(P[a][1]).toFixed(2)}L${X(P[b][0]).toFixed(2)} ${Y(P[b][1]).toFixed(2)}`;

  let face = '';
  for (const k of FACE) face += LINES[k].map(([a, b]) => seg(a, b)).join('');
  const soft = NOSE.map(([a, b]) => seg(a, b)).join('');
  // 黒目は4点の平均半径の円で描く
  const irises = [[468, 469, 470, 471, 472], [473, 474, 475, 476, 477]].map(([c, ...ring]) => {
    const r = mean(ring.map((i) => Math.hypot(P[i][0] - P[c][0], P[i][1] - P[c][1]))) * s;
    return `<circle class="face soft" cx="${X(P[c][0]).toFixed(2)}" cy="${Y(P[c][1]).toFixed(2)}" r="${r.toFixed(2)}"/>`;
  }).join('');

  let guides = '';
  const left = X(P[454][0]) > X(P[234][0]) ? X(P[234][0]) : X(P[454][0]);
  const right = Math.max(X(P[234][0]), X(P[454][0]));
  if (mode === 'thirds') {
    const t = m.thirds;
    const ys = [m.hairline.y, m.browY, m.subY, m.menY];
    const parts = [t.upper, t.middle, t.lower].map((v) => Math.round((v / t.total) * 100));
    ys.forEach((y, i) => {
      const dashed = i === 0 && !t.hairlineSet;
      guides += `<path class="guide-line${dashed ? '' : ' solid'}" d="M${left - 6} ${Y(y)}H${right + 6}"/>`;
    });
    for (let i = 0; i < 3; i++) {
      const cy = (Y(ys[i]) + Y(ys[i + 1])) / 2 + 2;
      const label = i === 0 && !t.hairlineSet ? '推定' : `${parts[i]}%`;
      guides += `<text class="guide-text${i === 0 && !t.hairlineSet ? ' sub' : ''}" x="${right + 8}" y="${cy}">${label}</text>`;
    }
  } else if (mode === 'fifths') {
    const idx = [127, 33, 133, 362, 263, 356];
    const y0 = Y(m.browY) - 6, y1 = Y(P[2][1]);
    const xsF = idx.map((i) => X(P[i][0])).sort((a, b) => a - b);
    xsF.forEach((x) => { guides += `<path class="guide-line solid" d="M${x} ${y0}V${y1}"/>`; });
    const widths = xsF.slice(1).map((x, k) => x - xsF[k]);
    const sum = widths.reduce((a, b) => a + b, 0);
    widths.forEach((w, k) => {
      guides += `<text class="guide-text" text-anchor="middle" x="${xsF[k] + w / 2}" y="${y1 + 9}">${Math.round((w / sum) * 100)}</text>`;
    });
  } else if (mode === 'symmetry') {
    // 中心線と、本人の右半分を左へ折り返した線（ずれが見える）
    const my = MIDLINE.map((i) => P[i][1]), mx = MIDLINE.map((i) => P[i][0]);
    const cy = mean(my), cx = mean(mx);
    let num = 0, den = 0;
    for (let k = 0; k < my.length; k++) { num += (my[k] - cy) * (mx[k] - cx); den += (my[k] - cy) ** 2; }
    const a = den ? num / den : 0, b = cx - a * cy;
    const refl = (p) => { const d = (p[0] - a * p[1] - b) / (1 + a * a); return [p[0] - 2 * d, p[1] + 2 * d * a]; };
    const mirror = new Map(PAIRS.map(([l, r]) => [r, l]));
    const rightSide = (i) => mirror.has(i);
    let path = '';
    for (const k of ['oval', 'rightEye', 'rightBrow', 'lips']) {
      for (const [i, j] of LINES[k]) {
        if (!rightSide(i) || !rightSide(j)) continue;
        const p = refl(P[i]), q = refl(P[j]);
        path += `M${X(p[0]).toFixed(2)} ${Y(p[1]).toFixed(2)}L${X(q[0]).toFixed(2)} ${Y(q[1]).toFixed(2)}`;
      }
    }
    const top = Y(topY), bot = Y(P[152][1]) + 6;
    guides += `<path class="guide-line" d="M${X(a * topY + b)} ${top - 4}L${X(a * P[152][1] + b)} ${bot}"/>`;
    guides += `<path class="guide-line solid" d="${path}"/>`;
  }

  return `<svg viewBox="0 0 ${vbW.toFixed(1)} ${vbH.toFixed(1)}" role="img" aria-label="顔の線画">
    <path class="face soft" d="${soft}"/>
    ${irises}
    <path class="face" d="${face}"/>
    ${guides}
  </svg>`;
}

// はじめての画面用の線画（標準顔）
export function welcomeMark() {
  return `<svg viewBox="0 0 100 125" aria-hidden="true">
    <ellipse cx="50" cy="62" rx="36" ry="47"/>
    <path d="M30 50q8-5 15 0M55 50q7-5 15 0" opacity=".7"/>
    <path d="M33 58q6 4 12 0M55 58q6 4 12 0"/>
    <path d="M50 60v14q-3 3 0 4" opacity=".6"/>
    <path d="M41 88q9 5 18 0"/>
    <path d="M8 44h84M8 75h84" stroke-dasharray="2 3" opacity=".35"/>
  </svg>`;
}
