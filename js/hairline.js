// 生え際の自動推定：額の肌の色を基準に、顔の縦軸に沿って上へたどり、
// 肌から髪（または背景）に色が切り替わる位置を探す。3本の筋（中央と左右）で探し、中央値をとる。
// 戻り値は画像上の、額の点（10番）から顔の上向きへの距離 t（画素）。見つからなければ null。

function ycc(r, g, b) {
  return [0.299 * r + 0.587 * g + 0.114 * b, 128 - 0.169 * r - 0.331 * g + 0.5 * b, 128 + 0.5 * r - 0.419 * g - 0.081 * b];
}

export function detectHairline(canvas, lm, w, h) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const px = (i) => [lm[i].x * w, lm[i].y * h];
  const p10 = px(10), p152 = px(152);
  let ux = p10[0] - p152[0], uy = p10[1] - p152[1];
  const faceH = Math.hypot(ux, uy); ux /= faceH; uy /= faceH;
  const vx = -uy, vy = ux; // 顔の横向き
  const faceW = Math.hypot((lm[454].x - lm[234].x) * w, (lm[454].y - lm[234].y) * h);

  const sample = (x, y, r) => {
    const x0 = Math.round(x - r), y0 = Math.round(y - r), s = Math.max(1, Math.round(r * 2));
    if (x0 < 0 || y0 < 0 || x0 + s > w || y0 + s > h) return null;
    const d = ctx.getImageData(x0, y0, s, s).data;
    let R = 0, G = 0, B = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    const n = d.length / 4;
    return ycc(R / n, G / n, B / n);
  };

  // 額の肌の色（眉の少し上〜10番の間の数か所）
  const r = Math.max(2, faceW * 0.02);
  const skinPts = [151, 9, 108, 337, 107, 336].map((i) => {
    const [x, y] = px(i);
    return sample(x + ux * faceH * 0.03, y + uy * faceH * 0.03, r);
  }).filter(Boolean);
  if (skinPts.length < 3) return null;
  const skin = [0, 1, 2].map((k) => skinPts.reduce((s, c) => s + c[k], 0) / skinPts.length);
  // 肌の色のばらつきから、切り替わりとみなす差を決める
  const spread = Math.sqrt(skinPts.reduce((s, c) => s + (c[0] - skin[0]) ** 2 + (c[1] - skin[1]) ** 2 + (c[2] - skin[2]) ** 2, 0) / skinPts.length);
  const limit = Math.max(22, spread * 3);
  const diff = (c) => Math.hypot((c[0] - skin[0]) * 0.8, (c[1] - skin[1]) * 1.6, (c[2] - skin[2]) * 1.6);

  const step = Math.max(1, faceH * 0.006);
  const need = Math.ceil((faceH * 0.05) / step); // この長さ続けて肌と違えば切り替わり
  const found = [];
  for (const off of [0, -0.16, 0.16]) {
    const bx = p10[0] + vx * faceW * off, by = p10[1] + vy * faceW * off;
    let run = 0, start = null;
    for (let t = -faceH * 0.1; t < faceH * 0.75; t += step) {
      const c = sample(bx + ux * t, by + uy * t, r * 0.6);
      if (!c) break;
      if (diff(c) > limit) {
        if (run === 0) start = t;
        run += 1;
        if (run >= need) { found.push(start); break; }
      } else {
        run = 0; start = null;
      }
    }
  }
  if (found.length < 2) return null;
  found.sort((a, b) => a - b);
  return found[Math.floor(found.length / 2)];
}
