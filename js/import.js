// 「データを書き出す（JSON）」で作ったファイル（store.exportText の形）から記録を読み込む。
// 中身は一つずつ確かめ、決まった形の値だけを新しく作り直して使う（知らない項目は捨てる）。
// 他の端末の記録には、書き出した時点のその端末の較正値（焦点距離・奥行きの倍率）を付ける。
// 未較正の記録にも元のカメラ値と状態を残し、読み込み先の端末の較正値を混ぜない。
import { cameraForRecord } from './record-camera.js';
import { frontalFromRaw } from './calibration.js';
import { browLineY } from './analysis.js';
import { averagePoints } from './geometry.js';
export const IMPORT_LIMITS = { bytes: 20 * 1024 * 1024, records: 500, shots: 10 };

const ID = /^r[0-9a-z]{4,24}$/;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
// 計測の良し悪しの基準ではなく、桁あふれ・ゼロ除算を防ぐための十分広い限界。
const COORD_LIMIT = 1e6, MIN_SPAN = 1e-8;
const coordinate = (v) => num(v) && Math.abs(v) <= COORD_LIMIT;
const point3 = (p) => Array.isArray(p) && p.length === 3 && p.every(coordinate);
const points = (a, sizes) => Array.isArray(a) && sizes.includes(a.length) && a.every(point3);
const camKey = (w, h) => `${Math.max(w, h)}x${Math.min(w, h)}`;

function cleanCal(c) {
  if (!c || typeof c !== 'object' || !num(c.focal) || c.focal < 1e-6 || c.focal > 1e5) return null;
  return { focal: c.focal, zScale: num(c.zScale) && c.zScale > 0.1 && c.zScale < 10 ? c.zScale : 1,
    calibrated: c.calibrated === undefined ? true : c.calibrated === true };
}

function safeFrontalShape(P, hairline) {
  if (!points(P, [468, 478])) return false;
  const x = (i) => P[i][0], y = (i) => P[i][1];
  const brow = browLineY(P), middle = brow - y(2), lower = y(2) - y(152);
  const manual = hairline?.source === 'manual';
  const hairY = brow + (manual ? hairline.k : 1) * middle;
  const denominators = [x(454) - x(234), (x(133) - x(33) + x(263) - x(362)) / 2,
    x(362) - x(133), x(358) - x(129), (y(13) + y(14)) / 2 - y(152), x(356) - x(127),
    manual ? hairY - y(152) : middle + lower];
  if (!coordinate(hairY) || !denominators.every((v) => num(v) && v > MIN_SPAN)) return false;
  const u = [x(172) - x(152), y(172) - y(152)], v = [x(397) - x(152), y(397) - y(152)];
  const lengths = Math.hypot(...u) * Math.hypot(...v);
  const cosine = (u[0] * v[0] + u[1] * v[1]) / lengths;
  return lengths > MIN_SPAN ** 2 && num(cosine) && Math.abs(cosine) <= 1;
}

// 撮影ごとの目の状態（0〜1 の数値5つ）。形が合わなければ捨てる（記録自体は読む）
const EYE_KEYS = ['blink', 'lookDown', 'lookUp', 'squint', 'wide'];
function cleanEye(eye, n) {
  if (!Array.isArray(eye) || eye.length !== n) return null;
  const ok = eye.every((e) => e && typeof e === 'object' && EYE_KEYS.every((k) => num(e[k]) && e[k] >= 0 && e[k] <= 1));
  return ok ? eye.map((e) => Object.fromEntries(EYE_KEYS.map((k) => [k, e[k]]))) : null;
}

function cleanHairline(h) {
  if (!h || typeof h !== 'object') return null;
  if (h.source === 'manual' && num(h.k)) return { source: 'manual', k: h.k, auto: !!h.auto };
  if (h.source === 'estimated') return { source: 'estimated', k: num(h.k) ? h.k : 1 };
  return null;
}

function cleanRecord(r, focals) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !ID.test(r.id)) return null;
  if (typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return null;
  if (!points(r.points, [468, 478])) return null;
  const rec = {
    id: r.id,
    at: new Date(r.at).toISOString(),
    v: typeof r.v === 'string' ? r.v.slice(0, 20) : null,
    points: r.points.map((p) => p.slice()),
    hairline: cleanHairline(r.hairline),
    imported: true,
  };
  if (!safeFrontalShape(rec.points, rec.hairline)) return null;
  if (r.raw && typeof r.raw === 'object') {
    const { w, h, shots } = r.raw;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || w > 10000 || h > 10000) return null;
    if (!Array.isArray(shots) || shots.length < 1 || shots.length > IMPORT_LIMITS.shots || !shots.every((s) => points(s, [478]))) return null;
    rec.raw = {
      w, h,
      shots: shots.map((s) => s.map((p) => p.slice())),
      focal: num(r.raw.focal) ? r.raw.focal : null,
      zScale: num(r.raw.zScale) ? r.raw.zScale : 1,
      calibrated: r.raw.calibrated === true,
    };
    const eye = cleanEye(r.raw.eye, shots.length);
    if (eye) rec.raw.eye = eye;
    // 再書き出しした端末の settings は元のカメラの値とは限らない。
    // 初回の読み込みだけ書き出し元の較正を使い、未較正なら撮影時の値・元の既定値を固定する。
    const cal = cleanCal(r.raw.cal) || (!r.imported && cleanCal(focals[camKey(w, h)]));
    if (cal) rec.raw.cal = cal;
    rec.raw.cal = cameraForRecord(rec, null);
    // 元のカメラ値で作り直す経路も検査する。生の点だけが退化しているファイルも保存しない。
    const cam = rec.raw.cal;
    try {
      const frontal = rec.raw.shots.map((s) => frontalFromRaw(s.map(([x, y, z]) => ({ x, y, z })), w, h, cam.focal, cam.zScale));
      if (!frontal.every((s) => safeFrontalShape(s, rec.hairline)) || !safeFrontalShape(averagePoints(frontal), rec.hairline)) return null;
    } catch { return null; }
  } else if (r.shots != null) {
    // 元の点がない古い記録（v0.1）
    if (!Array.isArray(r.shots) || r.shots.length > IMPORT_LIMITS.shots || !r.shots.every((s) => safeFrontalShape(s, rec.hairline))) return null;
    rec.shots = r.shots.map((s) => s.map((p) => p.slice()));
  }
  return rec;
}

// text：ファイルの中身。返り値：{ records, skipped }。ファイル全体が読めないときは Error（画面に出す文）
export function parseExport(text) {
  if (typeof text !== 'string' || text.length > IMPORT_LIMITS.bytes) throw new Error('ファイルが大きすぎます');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('JSON として読めませんでした'); }
  if (!data || typeof data !== 'object' || data.app !== 'FACE SCORE' || !Array.isArray(data.records)) throw new Error('FACE SCORE で書き出したファイルではありません');
  if (data.records.length > IMPORT_LIMITS.records) throw new Error('記録が多すぎます');
  const f = data.settings && typeof data.settings === 'object' ? data.settings.focals : null;
  const focals = f && typeof f === 'object' && !Array.isArray(f) ? f : {};
  const records = [];
  let skipped = 0;
  for (const r of data.records) {
    const rec = cleanRecord(r, focals);
    if (rec) records.push(rec); else skipped++;
  }
  return { records, skipped };
}
