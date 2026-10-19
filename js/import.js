// 「データを書き出す（JSON）」で作ったファイル（store.exportText の形）から記録を読み込む。
// 中身は一つずつ確かめ、決まった形の値だけを新しく作り直して使う（知らない項目は捨てる）。
// 他の端末の記録には、書き出した時点のその端末の較正値（焦点距離・奥行きの倍率）を付ける。
// 記録は開いた端末の較正値で計算し直すため、付けないと PC では元の端末と違う点数になる。
export const IMPORT_LIMITS = { bytes: 20 * 1024 * 1024, records: 500, shots: 10 };

const ID = /^r[0-9a-z]{4,24}$/;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const point3 = (p) => Array.isArray(p) && p.length === 3 && p.every(num);
const points = (a, sizes) => Array.isArray(a) && sizes.includes(a.length) && a.every(point3);
const camKey = (w, h) => `${Math.max(w, h)}x${Math.min(w, h)}`;

function cleanCal(c) {
  if (!c || typeof c !== 'object' || !num(c.focal) || c.focal <= 0 || c.focal > 1e5) return null;
  return { focal: c.focal, zScale: num(c.zScale) && c.zScale > 0.1 && c.zScale < 10 ? c.zScale : 1 };
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
  if (r.raw && typeof r.raw === 'object') {
    const { w, h, shots } = r.raw;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 16 || h < 16 || w > 10000 || h > 10000) return null;
    if (!Array.isArray(shots) || shots.length < 1 || shots.length > IMPORT_LIMITS.shots || !shots.every((s) => points(s, [478]))) return null;
    rec.raw = {
      w, h,
      shots: shots.map((s) => s.map((p) => p.slice())),
      focal: num(r.raw.focal) ? r.raw.focal : null,
      zScale: num(r.raw.zScale) ? r.raw.zScale : 1,
      calibrated: !!r.raw.calibrated,
    };
    // すでに別の端末から読み込んだ記録なら、最初の端末の較正値をそのまま引き継ぐ
    const cal = cleanCal(r.raw.cal) || cleanCal(focals[camKey(w, h)]);
    if (cal) rec.raw.cal = cal;
  } else if (r.shots != null) {
    // 元の点がない古い記録（v0.1）
    if (!Array.isArray(r.shots) || r.shots.length > IMPORT_LIMITS.shots || !r.shots.every((s) => points(s, [468, 478]))) return null;
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
