// 端末内の保存（localStorage）。写真は保存しない。保存するのは正面にそろえた点の座標と設定だけ。
const KEY = 'face-score:v1';
let snapshot = null, readable = false, revision = 0;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : null;
    if (raw == null || (data && Array.isArray(data.records)
      && (!data.settings || (typeof data.settings === 'object' && !Array.isArray(data.settings))))) {
      if (snapshot !== raw) revision++;
      snapshot = raw; readable = true;
      return data ? { records: data.records, settings: data.settings || {} } : { records: [], settings: {} };
    }
  } catch (e) { /* 読めないときは空で始める */ }
  readable = false;
  return { records: [], settings: {} };
}

let state = read();

// 保存に成功した変更だけをメモリにも反映する。容量不足でも既存の記録は削らない。
function write(next) {
  try {
    // 別画面が更新した保存内容を、古いメモリから丸ごと上書きしない。
    // 変更を再読込して今回の書込は中断。撮影/読込内容は画面に残して再試行する。
    if (!readable || localStorage.getItem(KEY) !== snapshot) {
      state = read();
      return false;
    }
    const raw = JSON.stringify(next);
    localStorage.setItem(KEY, raw);
    snapshot = raw;
    revision++;
    state = next;
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
  revision: () => revision,
  refresh() { state = read(); return readable; },
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
      // 撮影ごとの目の状態（v0.8.1〜。揺れの原因の確認用。点数の計算には使わない）
      if (Array.isArray(raw.eye) && raw.eye.length === raw.shots.length) rec.raw.eye = raw.eye.map((e) => ({ ...e }));
      delete rec.shots;
    }
    return write({ ...state, records: [...state.records, rec] }) ? rec : null;
  },
  // 読み込んだ記録を足す（import.js の parseExport で確かめたもの）。この端末で測った同じ記録は上書きしない。
  // 前に読み込んだ記録は、元の端末の較正値が変わっていればそれだけ新しくする。保存できなければ null
  importRecords(list) {
    const byId = new Map(state.records.map((r) => [r.id, r]));
    let added = 0, updated = 0;
    for (const rec of list) {
      const cur = byId.get(rec.id);
      if (!cur) { byId.set(rec.id, rec); added++; continue; }
      if (cur.imported && cur.raw && rec.raw?.cal && JSON.stringify(cur.raw.cal) !== JSON.stringify(rec.raw.cal)) {
        byId.set(rec.id, { ...cur, raw: { ...cur.raw, cal: rec.raw.cal } }); updated++;
      }
    }
    if (!added && !updated) return { added, updated };
    return write({ ...state, records: [...byId.values()] }) ? { added, updated } : null;
  },
  remove(id) { return write({ ...state, records: state.records.filter((r) => r.id !== id) }); },
  clear() { return write({ ...state, records: [] }); },
  setting: (k) => state.settings[k],
  setSetting(k, v) { return this.setSettings({ [k]: v }); },
  setSettings(patch) { return write({ ...state, settings: { ...state.settings, ...patch } }); },
  exportText: () => JSON.stringify({ app: 'FACE SCORE', exportedAt: new Date().toISOString(), ...state }),
};
