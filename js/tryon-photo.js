// 試着画面を開いている間だけ本人の写真を使う。永続保存・採点・JSON書き出し・外部送信はしない。
import { toFaceAxes, alignToCanonical } from './geometry.js';
const MAX_SIDE = 1280;
const MAX_INPUT_BYTES = 20 * 1024 * 1024, MAX_STORED_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40 * 1024 * 1024, MAX_INPUT_SIDE = 16384;
const DEMO_URL = new URL('../img/model-cg.jpg', import.meta.url).href;
const DEMO_META = new URL('../img/model-cg-landmarks.json', import.meta.url).href;

export class TryonPhotoError extends Error {
  constructor(code, message, cause) { super(message); this.name = 'TryonPhotoError'; this.code = code; if (cause) this.cause = cause; }
}
const fail = (code, message, cause) => new TryonPhotoError(code, message, cause);
const abortError = () => new DOMException('試着用写真の準備を中止しました', 'AbortError');
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(abortError()); };
    if (signal.aborted) { Promise.resolve(promise).catch(() => {}); stop(); return; }
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(promise).then((value) => { signal.removeEventListener('abort', stop); resolve(value); }, (error) => { signal.removeEventListener('abort', stop); reject(error); });
  });
}
const isDimensions = (w, h, maxSide = MAX_SIDE, maxPixels = MAX_SIDE * MAX_SIDE) => Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && Math.max(w, h) <= maxSide && w * h <= maxPixels;
function validLandmarks(lm) {
  if (!Array.isArray(lm) || lm.length !== 478 || !lm.every((p) => Array.isArray(p) && p.length === 3 && p.every((v) => typeof v === 'number' && Number.isFinite(v)) && p[0] >= -1 && p[0] <= 2 && p[1] >= -1 && p[1] <= 2 && Math.abs(p[2]) <= 2)) return false;
  const xs = lm.map((p) => p[0]), ys = lm.map((p) => p[1]);
  return Math.max(...xs) - Math.min(...xs) > 0.01 && Math.max(...ys) - Math.min(...ys) > 0.01;
}
function validPhoto(photo) {
  return photo && photo.blob instanceof Blob && photo.blob.type === 'image/jpeg' && photo.blob.size > 0 && photo.blob.size <= MAX_STORED_BYTES && isDimensions(photo.w, photo.h) && validLandmarks(photo.landmarks);
}
async function imageFromBlob(blob, signal) {
  checkAbort(signal);
  const url = URL.createObjectURL(blob), img = new Image(); let timer;
  try {
    img.src = url;
    await abortable(Promise.race([img.decode(), new Promise((_, reject) => { timer = setTimeout(() => reject(fail('IMAGE_TIMEOUT', '画像を開くのに時間がかかっています。小さな写真で再度お試しください')), 15000); })]), signal);
    checkAbort(signal);
    return img;
  } catch (error) {
    img.removeAttribute('src');
    checkAbort(signal);
    if (error instanceof TryonPhotoError || error?.name === 'AbortError') throw error;
    throw fail('IMAGE_DECODE', 'この画像は開けませんでした。JPEG・PNGなど、このブラウザで表示できる写真を選んでください', error);
  } finally { clearTimeout(timer); URL.revokeObjectURL(url); }
}
async function decodedPhoto(photo, signal) {
  checkAbort(signal);
  if (!validPhoto(photo)) throw fail('INVALID_PHOTO', '写真のデータが正しくありません');
  const header = new Uint8Array(await abortable(photo.blob.slice(0, 3).arrayBuffer(), signal));
  checkAbort(signal);
  if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) throw fail('INVALID_PHOTO', '写真の形式が正しくありません');
  const img = await imageFromBlob(photo.blob, signal);
  if (img.naturalWidth !== photo.w || img.naturalHeight !== photo.h) { releaseTryonImage(img); throw fail('INVALID_PHOTO', '写真の大きさと保存情報が一致しません'); }
  return img;
}
function toCanvas(src, w, h) {
  if (!isDimensions(w, h, MAX_INPUT_SIDE, MAX_INPUT_PIXELS)) throw fail('IMAGE_DIMENSIONS', '画像が大きすぎるか、まだ表示できていません。小さな写真で再度お試しください');
  const s = Math.min(1, MAX_SIDE / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext('2d');
  if (!ctx) throw fail('CANVAS_UNAVAILABLE', 'このブラウザでは写真を準備できません');
  // 透過PNGの透明部分は白にする。元画像のEXIF・位置・ファイル名はJPEGに引き継がない。
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
function jpeg(canvas) {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob((b) => b && b.type === 'image/jpeg' && b.size > 0 && b.size <= MAX_STORED_BYTES ? resolve(b) : reject(fail('IMAGE_ENCODE', '写真を変換できませんでした')), 'image/jpeg', 0.9); }
    catch (error) { reject(fail('IMAGE_ENCODE', '写真を変換できませんでした', error)); }
  });
}
// 採点用VIDEO検出器と分離。2人まで検出し、複数顔を単一顔として通さない。
let detectorPending = null, cpuOnly = false, detectorTail = Promise.resolve();
async function createDetector(delegate, signal) {
  checkAbort(signal);
  const vision = await import('../vendor/mediapipe/vision_bundle.mjs');
  checkAbort(signal);
  const fileset = await vision.FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm', import.meta.url).href);
  checkAbort(signal);
  const instance = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: new URL('../models/face_landmarker.task', import.meta.url).href, delegate },
    runningMode: 'IMAGE', numFaces: 2, outputFaceBlendshapes: false,
    minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  if (signal?.aborted) { instance.close(); throw abortError(); }
  return instance;
}
function detector(signal) {
  checkAbort(signal);
  if (!detectorPending) detectorPending = (async () => {
    if (!cpuOnly) { try { return await createDetector('GPU', signal); } catch (error) { if (error?.name === 'AbortError') throw error; cpuOnly = true; } }
    checkAbort(signal);
    return createDetector('CPU', signal);
  })().catch((error) => { detectorPending = null; checkAbort(signal); if (error?.name === 'AbortError') throw error; throw fail('DETECTOR_UNAVAILABLE', '写真の顔を確認できませんでした。再度お試しください', error); });
  return detectorPending;
}
async function runDetection(canvas, signal) {
  checkAbort(signal);
  let lmk = await detector(signal), res;
  checkAbort(signal);
  try { res = lmk.detect(canvas); }
  catch (error) {
    if (cpuOnly) throw fail('DETECTOR_FAILED', '写真の顔を確認できませんでした', error);
    try { lmk.close(); } catch { /* CPUへ作り直す */ }
    cpuOnly = true; detectorPending = null; checkAbort(signal); lmk = await detector(signal); checkAbort(signal);
    try { res = lmk.detect(canvas); } catch (cause) { throw fail('DETECTOR_FAILED', '写真の顔を確認できませんでした', cause); }
  }
  const faces = res.faceLandmarks || [];
  if (faces.length !== 1) throw fail(faces.length ? 'MULTIPLE_FACES' : 'NO_FACE', faces.length ? '顔が1人だけ写った写真を選んでください' : '顔が見つかりませんでした。顔がはっきり写った写真を選んでください');
  const f = faces[0], lm = f.map((p) => [Math.round(p.x * 1e5) / 1e5, Math.round(p.y * 1e5) / 1e5, Math.round(p.z * 1e5) / 1e5]);
  if (!validLandmarks(lm)) throw fail('INVALID_LANDMARKS', '写真の顔を読み取れませんでした');
  const { angles, scale } = alignToCanonical(toFaceAxes(f, canvas.width, canvas.height));
  if (!Number.isFinite(scale) || !Object.values(angles).every(Number.isFinite)) throw fail('INVALID_LANDMARKS', '写真の顔を読み取れませんでした');
  if (Math.abs(angles.yaw) > 35 || Math.abs(angles.pitch) > 30 || Math.abs(angles.roll) > 35) throw fail('FACE_ANGLE', '顔が横や上下に傾きすぎています。正面に近い写真を選んでください');
  return lm;
}
function detect(canvas, signal) { checkAbort(signal); const next = detectorTail.then(() => { checkAbort(signal); return runDetection(canvas, signal); }); detectorTail = next.then(() => {}, () => {}); return next; }
export function releaseTryonPhotoDetector() {
  const next = detectorTail.then(async () => { try { (await detectorPending)?.close(); } finally { detectorPending = null; } });
  detectorTail = next.then(() => {}, () => {}); return next;
}
export async function photoFromFile(file, { signal } = {}) {
  checkAbort(signal);
  if (!(file instanceof Blob) || !file.size || file.size > MAX_INPUT_BYTES) throw fail('IMAGE_SIZE', '20MB以内の写真を選んでください');
  // SVG/HTMLは受け入れず、ファイルのバイト列からラスター画像だけを開く。
  const h = new Uint8Array(await abortable(file.slice(0, 32).arrayBuffer(), signal)), text = (a, b) => String.fromCharCode(...h.slice(a, b));
  checkAbort(signal);
  const raster = h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff || h[0] === 0x89 && text(1, 4) === 'PNG' || text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP' || text(4, 8) === 'ftyp' && /^(avif|avis|heic|heix|hevc|hevx|mif1|msf1)$/.test(text(8, 12));
  if (!raster) throw fail('IMAGE_TYPE', 'JPEG・PNG・WebP・HEICなどの写真を選んでください');
  let img, c;
  try {
    img = await imageFromBlob(file, signal); checkAbort(signal);
    c = toCanvas(img, img.naturalWidth, img.naturalHeight); releaseTryonImage(img); img = null;
    const landmarks = await detect(c, signal); checkAbort(signal);
    const blob = await abortable(jpeg(c), signal); checkAbort(signal);
    return { blob, w: c.width, h: c.height, landmarks };
  } finally { if (img) releaseTryonImage(img); if (c) { c.width = 0; c.height = 0; } file = null; }
}
export async function photoFromVideo(video, _landmarks = null, { signal } = {}) {
  checkAbort(signal);
  if (!video || !Number.isFinite(video.videoWidth) || !Number.isFinite(video.videoHeight) || !(video.readyState >= 2)) throw fail('VIDEO_NOT_READY', 'カメラの映像が表示されてからお試しください');
  const c = toCanvas(video, video.videoWidth, video.videoHeight);
  try {
    // VIDEO用numFaces:1の点を流用しない。同じ静止フレームを2人検出器で再確認する。
    const blob = await abortable(jpeg(c), signal); checkAbort(signal);
    const landmarks = await detect(c, signal); checkAbort(signal);
    return { blob, w: c.width, h: c.height, landmarks };
  } finally { c.width = 0; c.height = 0; video = null; _landmarks = null; }
}
let demoPending = null;
export async function demoModel() {
  if (!demoPending) demoPending = (async () => {
    const response = await fetch(DEMO_META); if (!response.ok) throw fail('DEMO_UNAVAILABLE', '見本の顔を開けませんでした');
    const meta = await response.json();
    if (!isDimensions(meta.width, meta.height) || !validLandmarks(meta.landmarks)) throw fail('DEMO_UNAVAILABLE', '見本の顔の情報が正しくありません');
    return { url: DEMO_URL, w: meta.width, h: meta.height, landmarks: meta.landmarks, demo: true };
  })().catch((error) => { demoPending = null; throw error; });
  const demo = await demoPending; return { ...demo, landmarks: demo.landmarks.map((p) => p.slice()) };
}
export async function imageOf(photo, { signal } = {}) {
  checkAbort(signal);
  if (photo?.blob) return decodedPhoto(photo, signal);
  // 任意URLから外部画像を読み込む経路を作らない。
  if (!photo?.demo || photo.url !== DEMO_URL || !isDimensions(photo.w, photo.h) || !validLandmarks(photo.landmarks)) throw fail('INVALID_PHOTO', '写真のデータが正しくありません');
  const response = await fetch(DEMO_URL, { signal }); checkAbort(signal); if (!response.ok) throw fail('DEMO_UNAVAILABLE', '見本の顔を開けませんでした');
  const blob = await abortable(response.blob(), signal); checkAbort(signal);
  const img = await imageFromBlob(blob, signal);
  if (img.naturalWidth !== photo.w || img.naturalHeight !== photo.h) { releaseTryonImage(img); throw fail('DEMO_UNAVAILABLE', '見本の顔の大きさが一致しません'); }
  return img;
}
// Blob URL はdecode直後に解放済み。描画側が終了時に画像参照・textureも破棄する。
export function releaseTryonImage(image) { if (image instanceof HTMLImageElement) image.removeAttribute('src'); }
