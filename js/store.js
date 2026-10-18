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

export const store = {
  records: () => state.records.slice().sort((a, b) => (a.at < b.at ? 1 : -1)),
  get: (id) => state.records.find((r) => r.id === id) || null,
  latest() { return this.records()[0] || null; },
  add({ points, shots, hairline, version }) {
    const rec = {
      id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      v: version,
      points: pack(points),
      shots: shots.map(pack),
      hairline,
    };
    state.records.push(rec);
    if (!write()) {
      // 容量が足りないときは、各回の点（ぶれの計算用）を古い順に削って保存し直す
      for (const r of state.records) { if (r !== rec) delete r.shots; if (write()) break; }
    }
    return rec;
  },
  remove(id) { state.records = state.records.filter((r) => r.id !== id); write(); },
  clear() { state.records = []; write(); },
  setting: (k) => state.settings[k],
  setSetting(k, v) { state.settings[k] = v; write(); },
  exportText: () => JSON.stringify({ app: 'FACE SCORE', exportedAt: new Date().toISOString(), ...state }),
};
