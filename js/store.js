// 端末内の保存（localStorage）。写真は保存しない。保存するのは正面にそろえた点の座標と設定だけ。
const KEY = 'face-score:v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (data && Array.isArray(data.records)) return { records: data.records, settings: data.settings || {} };
  } catch (e) { /* 読めないときは空で始める */ }
  return { records: [], settings: {} };
}

let state = read();

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

const pack = (points) => points.map((p) => p.map((v) => Math.round(v * 1000) / 1000));
// 生の点（正規化座標）は細かい桁まで残す
const packRaw = (lm) => lm.map((p) => [p.x, p.y, p.z].map((v) => Math.round(v * 1e5) / 1e5));
export const unpackRaw = (arr) => arr.map(([x, y, z]) => ({ x, y, z }));

export const store = {
  records: () => state.records.slice().sort((a, b) => (a.at < b.at ? 1 : -1)),
  get: (id) => state.records.find((r) => r.id === id) || null,
  latest() { return this.records()[0] || null; },
  add({ points, shots, hairline, version, raw }) {
    const rec = {
      id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      v: version,
      points: pack(points),
      shots: shots.map(pack),
      hairline,
    };
    // 生の点：焦点距離を較正し直したら、ここから正面の点を作り直す（v0.2.0〜）。各回の正面の点は生の点から作れるので持たない
    if (raw) {
      rec.raw = { w: raw.w, h: raw.h, shots: raw.shots.map(packRaw), focal: Math.round(raw.focal), zScale: raw.zScale || 1, calibrated: !!raw.calibrated };
      delete rec.shots;
    }
    state.records.push(rec);
    if (!write()) {
      // 容量が足りないときは、古い記録から各回の点（ぶれの計算用）を削って保存し直す
      for (const r of state.records) { if (r !== rec) { delete r.shots; if (r.raw) r.raw.shots = r.raw.shots.slice(0, 1); } if (write()) break; }
    }
    return rec;
  },
  remove(id) { state.records = state.records.filter((r) => r.id !== id); write(); },
  clear() { state.records = []; write(); },
  setting: (k) => state.settings[k],
  setSetting(k, v) { state.settings[k] = v; write(); },
  exportText: () => JSON.stringify({ app: 'FACE SCORE', exportedAt: new Date().toISOString(), ...state }),
};
