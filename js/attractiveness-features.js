// 人の評定を予測する研究用モデルの入力。比率の手作り点数を教師として使わない。
export const FEATURE_SCHEMA = 'mp468-shape-xy-v1';
export const FEATURE_COUNT = 468 * 2;

export function attractivenessFeatures(points) {
  if (!Array.isArray(points) || points.length < 468) throw new Error('顔の点が不足しています');
  if (!points.slice(0, 468).every((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))) {
    throw new Error('顔の点に不正な値があります');
  }
  const width = points[454][0] - points[234][0];
  const cx = (points[454][0] + points[234][0]) / 2;
  const cy = points[168][1];
  if (!Number.isFinite(width) || width <= 0) throw new Error('顔の幅を測れません');
  const out = points.slice(0, 468).flatMap((p) => [(p[0] - cx) / width, (p[1] - cy) / width]);
  if (!out.every(Number.isFinite)) throw new Error('顔の点に不正な値があります');
  return out;
}
