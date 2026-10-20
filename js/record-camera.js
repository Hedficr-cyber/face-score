// 読み込んだ記録は元の端末のカメラ値で固定し、この端末の較正から切り離す。
import { CAMERA } from './config.js';

const validFocal = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 1e-6 && v <= 1e5;
const validZScale = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0.1 && v < 10;

function snapshot(c, legacyCalibrated = false) {
  if (!c || typeof c !== 'object' || !validFocal(c.focal)) return null;
  return {
    focal: c.focal,
    zScale: validZScale(c.zScale) ? c.zScale : 1,
    // v0.5.1 の raw.cal は較正済みの値だけを持ち、状態フラグはなかった。
    calibrated: c.calibrated === undefined ? legacyCalibrated : c.calibrated === true,
  };
}

// localCamera は focalFor(w, h) の結果。この端末で撮った記録だけに適用する。
export function cameraForRecord(rec, localCamera) {
  const raw = rec.raw;
  if (!raw) return null;
  const original = snapshot(raw.cal, true) || snapshot(raw);
  const fallback = { focal: CAMERA.focalRatio * Math.max(raw.w, raw.h), zScale: 1, calibrated: false };
  if (rec.imported) return original || fallback;
  return snapshot(localCamera) || original || fallback;
}
