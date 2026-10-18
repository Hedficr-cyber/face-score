// 撮影：前面カメラの映像から顔を追い、条件がそろったら自動で撮る（3枚×数フレームの平均）。
// 映像・画像はどこにも送らず、保存もしない。生え際の調整用に1枚だけメモリ上に残す。
import { loadLandmarker, reloadOnCpu } from './detector.js';
import { toFaceAxes, alignToCanonical, averagePoints, undoPerspective, perspectiveScaler, irisDiameterPx } from './geometry.js';
import { LINES } from './mesh-data.js';
import { CAPTURE, CAMERA, IRIS_MM } from './config.js';

const C = CAPTURE;

function blend(result, name) {
  const cats = result.faceBlendshapes?.[0]?.categories || [];
  return cats.find((c) => c.categoryName === name)?.score ?? 0;
}

// 顔のまわりの明るさ（0〜255）。小さく縮めて平均する
const lumaCanvas = document.createElement('canvas');
lumaCanvas.width = 32; lumaCanvas.height = 32;
const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
function faceLuma(video, lm, w, h) {
  const x0 = Math.max(0, lm[234].x * w), x1 = Math.min(w, lm[454].x * w);
  const y0 = Math.max(0, lm[10].y * h), y1 = Math.min(h, lm[152].y * h);
  if (x1 - x0 < 8 || y1 - y0 < 8) return 255;
  lumaCtx.drawImage(video, x0, y0, x1 - x0, y1 - y0, 0, 0, 32, 32);
  const d = lumaCtx.getImageData(0, 0, 32, 32).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return s / (d.length / 4);
}

// 条件を確かめて、直すべき点を1つ返す（null なら撮れる）
// 距離は、カメラを較正したときだけ推定値で確かめる（未較正では画角が分からず不正確なため、画面上の顔の大きさで見る）
function check(lm, fit, result, w, h, ctx, opts) {
  const short = Math.min(w, h);
  const faceW = Math.hypot((lm[454].x - lm[234].x) * w, (lm[454].y - lm[234].y) * h) / short;
  const minW = opts.minFaceWidth ?? C.minFaceWidth, maxW = opts.maxFaceWidth ?? C.maxFaceWidth;
  if (faceW > maxW || (opts.calibrated && !opts.mode && ctx.distance < C.minDistanceCm)) return { code: 'near', text: opts.nearText || '少し離れてください' };
  if (faceW < minW || (opts.calibrated && !opts.mode && ctx.distance > C.maxDistanceCm)) return { code: 'far', text: opts.farText || '少し近づいてください' };
  const cx = ((lm[234].x + lm[454].x) / 2 - 0.5) * w / short;
  const cy = ((lm[10].y + lm[152].y) / 2 - 0.5) * h / short;
  if (Math.hypot(cx, cy) > C.maxCenterOffset) return { code: 'center', text: '顔を枠の中央に合わせてください' };
  if (ctx.luma < C.minLuma) return { code: 'dark', text: '暗いです。明るい場所で撮ってください' };
  const a = fit.angles;
  if (Math.abs(a.yaw) > C.maxYaw) return { code: 'yaw', text: '正面を向いてください' };
  if (Math.abs(a.pitch) > C.maxPitch) return { code: 'pitch', text: a.pitch > 0 ? 'あごを少し上げてください' : 'あごを少し引いてください' };
  if (Math.abs(a.roll) > C.maxRoll) return { code: 'roll', text: '首をまっすぐにしてください' };
  if (blend(result, 'jawOpen') > C.maxJawOpen) return { code: 'mouth', text: '口を閉じてください' };
  if (Math.max(blend(result, 'mouthSmileLeft'), blend(result, 'mouthSmileRight')) > C.maxSmile) {
    return { code: 'smile', text: '自然な表情にしてください' };
  }
  if (Math.max(blend(result, 'eyeBlinkLeft'), blend(result, 'eyeBlinkRight')) > C.maxBlink) {
    return { code: 'blink', text: '目を開けてください' };
  }
  if (ctx.motion > C.maxMotion) return { code: 'motion', text: 'そのまま止まってください' };
  return null;
}

const DRAW = ['oval', 'leftEye', 'rightEye', 'leftBrow', 'rightBrow', 'lips', 'leftIris', 'rightIris'];

function drawOverlay(ctx, lm, w, h, ok) {
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  ctx.lineWidth = Math.max(1.2, w / 520);
  ctx.strokeStyle = ok ? 'rgba(217,199,158,0.9)' : 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  for (const key of DRAW) {
    for (const [s, e] of LINES[key]) {
      ctx.moveTo(lm[s].x * w, lm[s].y * h);
      ctx.lineTo(lm[e].x * w, lm[e].y * h);
    }
  }
  ctx.stroke();
}

// opts.focalFor(w, h) → { focal, calibrated }：焦点距離（画素）。opts.mode：'calib-near' / 'calib-far' のとき較正用の撮影
export async function startCapture({ video, canvas, onStatus, onProgress, onShot, onDone, onError, opts = {}, signal }) {
  let stopped = false;
  let stream = null;
  let raf = 0;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    signal?.removeEventListener('abort', stop);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      // 前の起動処理が遅れて終わっても、新しく開いた撮影の映像には触らない。
      if (video.srcObject === stream) video.srcObject = null;
      stream = null;
    }
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) { stop(); return { stop }; }

  // カメラの起動と顔の検出の準備を同時に進める
  onStatus({ code: 'loading', text: 'カメラを準備しています' });
  const landmarkerReady = loadLandmarker();
  landmarkerReady.catch(() => {});
  try {
    // 正方形などに切り出させず、カメラ本来の縦横比で受け取る（切り出すと画角が変わるため）
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    if (stopped) { stop(); return { stop }; }
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute('playsinline', '');
    await video.play();
  } catch (e) {
    if (stopped) return { stop };
    stop();
    onError({ code: 'camera', text: 'カメラを使えませんでした。ブラウザの設定でカメラを許可してください。', error: e });
    return { stop };
  }
  if (stopped) return { stop };

  let landmarker;
  try {
    onStatus({ code: 'loading', text: '顔の検出を準備しています（初回は少し時間がかかります）' });
    landmarker = await landmarkerReady;
  } catch (e) {
    if (stopped) return { stop };
    stop();
    onError({ code: 'model', text: '顔の検出を準備できませんでした。電波の良い場所で開き直してください。', error: e });
    return { stop };
  }
  if (stopped) return { stop };

  const ctx2d = canvas.getContext('2d');
  const shots = [];
  const rawShots = [];
  const shotWidths = [];
  let buffer = [];
  let rawBuffer = [];
  let faceWidths = [];
  let hold = 0;
  let waitUntil = 0;
  let lastTime = -1;
  let snapshot = null;
  let retried = false;
  let prev = null;
  let luma = 255, frameNo = 0;

  // 不成立になった「今の1枚」は、生の点も含めてまとめて捨てる。
  // 撮り終えた1枚目の写真は、生え際合わせに使うため残す。
  const resetShot = () => {
    hold = 0; buffer = []; rawBuffer = []; faceWidths = [];
    if (!shots.length && snapshot) {
      snapshot.canvas.width = 0; snapshot.canvas.height = 0;
      snapshot = null;
    }
  };

  const loop = async () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (video.readyState < 2 || video.currentTime === lastTime) return;
    lastTime = video.currentTime;
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

    let result;
    try {
      result = landmarker.detectForVideo(video, performance.now());
    } catch (e) {
      if (!retried) {
        retried = true;
        cancelAnimationFrame(raf);
        const next = await reloadOnCpu().catch(() => null);
        if (stopped) return;
        if (next) {
          resetShot(); turnBuf = []; turnKey = null; prev = null;
          landmarker = next; raf = requestAnimationFrame(loop); return;
        }
      }
      stop();
      onError({ code: 'detect', text: '顔の検出でエラーが起きました。もう一度お試しください。', error: e });
      return;
    }

    const lm = result.faceLandmarks?.[0];
    if (!lm || lm.length < 478) {
      resetShot(); turnBuf = []; turnKey = null; prev = null; frameNo = 0;
      drawOverlay(ctx2d, null, w, h, false);
      onStatus({ code: 'search', text: '顔を枠に合わせてください' });
      if (opts.mode === 'turn-scan') onProgress(Object.keys(views).length, 0, 5);
      else onProgress(shots.length, 0);
      return;
    }

    // 遠近を補正してから正面にそろえる（較正済みなら奥行きの倍率も直す）
    const cam = opts.focalFor ? opts.focalFor(w, h) : { focal: CAMERA.focalRatio * Math.max(w, h), zScale: 1, calibrated: false };
    const focal = cam.focal, zs = cam.zScale || 1;
    opts.calibrated = cam.calibrated;
    const lmz = zs === 1 ? lm : lm.map((p) => ({ x: p.x, y: p.y, z: p.z * zs }));
    const lmc = undoPerspective(lmz, w, h, focal);
    const pts = toFaceAxes(lmc, w, h);
    const fit = alignToCanonical(pts);
    const P = pts.map(fit.apply);
    const width = P[454][0] - P[234][0];
    let motion = 0;
    if (prev) { for (let i = 0; i < 468; i++) motion += Math.hypot(P[i][0] - prev[i][0], P[i][1] - prev[i][1]); motion /= 468 * width; }
    prev = P;
    if (frameNo++ % 8 === 0) luma = faceLuma(video, lm, w, h);
    const distance = (focal * IRIS_MM / 10) / irisDiameterPx(lm, w, h);
    const env = { distance, motion, luma };

    if (opts.mode === 'turn-scan') { turnStep(lm, fit, result, w, h, env); return; }

    const problem = check(lm, fit, result, w, h, env, opts);
    drawOverlay(ctx2d, lm, w, h, !problem);
    const info = { angles: fit.angles, distance, motion, luma };

    if (problem) {
      resetShot();
      onStatus({ ...problem, ...info });
      onProgress(shots.length, 0);
      return;
    }
    if (performance.now() < waitUntil) return;
    hold += 1;
    onStatus({ code: 'hold', text: 'そのまま動かないでください', ...info });
    if (hold < C.holdFrames) { onProgress(shots.length, hold / (C.holdFrames + C.framesPerShot)); return; }

    buffer.push(P);
    rawBuffer.push(lm.map((p) => [p.x, p.y, p.z]));
    faceWidths.push(Math.hypot((lm[454].x - lm[234].x) * w, (lm[454].y - lm[234].y) * h) / Math.min(w, h));
    if (!snapshot && buffer.length === Math.ceil(C.framesPerShot / 2)) {
      // 生え際の調整用に今のフレームを1枚だけメモリに残す
      const shotCanvas = document.createElement('canvas');
      shotCanvas.width = w; shotCanvas.height = h;
      shotCanvas.getContext('2d').drawImage(video, 0, 0, w, h);
      const copy = (arr) => arr.map((p) => ({ x: p.x, y: p.y, z: p.z }));
      snapshot = {
        canvas: shotCanvas, landmarks: copy(lm), corrected: copy(lmc), fit, width: w, height: h,
        scaleAt: perspectiveScaler(lmz, w, focal), distance,
      };
    }
    onProgress(shots.length, (hold + buffer.length) / (C.holdFrames + C.framesPerShot));
    if (buffer.length < C.framesPerShot) return;

    shots.push(averagePoints(buffer));
    // 生の点（正規化座標）の平均も残す。焦点距離を較正し直したとき、あとから補正をやり直せるように
    rawShots.push(averagePoints(rawBuffer).map(([x, y, z]) => ({ x, y, z })));
    shotWidths.push(faceWidths.reduce((s, v) => s + v, 0) / faceWidths.length);
    buffer = []; rawBuffer = []; faceWidths = []; hold = 0;
    waitUntil = performance.now() + C.gapMs;
    onShot(shots.length);
    onProgress(shots.length, 0);
    if (shots.length >= C.shots) {
      const points = averagePoints(shots);
      stop();
      const faceWidth = shotWidths.reduce((s, v) => s + v, 0) / shotWidths.length;
      onDone({ points, shots, snapshot, raw: { w, h, shots: rawShots, focal, zScale: zs, calibrated: cam.calibrated }, faceWidth });
    }
  };

  // ---- 顔を回すスキャン（較正用）：正面・左右・上下の5つの向きで、それぞれ数フレームの生の点を集める ----
  // 左右・上下は「どちらからでも」受け付け、2つ目は反対側を求める（向きの符号の取り違えで止まらないように）
  const views = {};
  let turnBuf = [], turnKey = null;
  const TURN_ORDER = ['front', 'side1', 'side2', 'vert1', 'vert2'];
  const nextTurn = () => TURN_ORDER.find((k) => !views[k]);
  function classify(a) {
    if (Math.abs(a.yaw) < 4 && Math.abs(a.pitch) < 5) return 'front';
    if (Math.abs(a.yaw) >= 14 && Math.abs(a.yaw) <= 32 && Math.abs(a.pitch) < 10) return a.yaw > 0 ? 'yaw+' : 'yaw-';
    if (Math.abs(a.pitch) >= 9 && Math.abs(a.pitch) <= 26 && Math.abs(a.yaw) < 10) return a.pitch > 0 ? 'pitch+' : 'pitch-';
    return null;
  }
  const turnText = {
    front: '正面を向いてください',
    side1: 'ゆっくり横を向いてください（左右どちらからでも）',
    side2: '反対側へゆっくり向いてください',
    vert1: 'ゆっくり上か下を向いてください',
    vert2: '反対（上なら下、下なら上）を向いてください',
  };
  function turnStep(lm, fit, result, w, h, env) {
    const want = nextTurn();
    const short = Math.min(w, h);
    const faceW = Math.hypot((lm[454].x - lm[234].x) * w, (lm[454].y - lm[234].y) * h) / short;
    const cx = ((lm[234].x + lm[454].x) / 2 - 0.5) * w / short, cy = ((lm[10].y + lm[152].y) / 2 - 0.5) * h / short;
    let problem = null;
    if (faceW > (opts.maxFaceWidth ?? 0.85)) problem = '少し離れてください';
    else if (faceW < (opts.minFaceWidth ?? 0.22)) problem = '少し近づいてください';
    else if (Math.hypot(cx, cy) > 0.2) problem = '顔を枠の中に入れてください';
    else if (env.luma < C.minLuma) problem = '暗いです。明るい場所で撮ってください';
    else if (blend(result, 'jawOpen') > C.maxJawOpen) problem = '口を閉じてください';
    else if (Math.max(blend(result, 'eyeBlinkLeft'), blend(result, 'eyeBlinkRight')) > C.maxBlink) problem = '目を開けてください';
    else if (env.motion > C.maxMotion * 1.5) problem = 'その向きで止まってください';
    const cls = classify(fit.angles);
    const sideTaken = views.side1?.cls, vertTaken = views.vert1?.cls;
    const fits = cls && ((want === 'front' && cls === 'front')
      || (want === 'side1' && cls.startsWith('yaw'))
      || (want === 'side2' && cls.startsWith('yaw') && cls !== sideTaken)
      || (want === 'vert1' && cls.startsWith('pitch'))
      || (want === 'vert2' && cls.startsWith('pitch') && cls !== vertTaken));
    drawOverlay(ctx2d, lm, w, h, !problem && fits);
    const done = Object.keys(views).length;
    const info = { angles: fit.angles, distance: env.distance, motion: env.motion, luma: env.luma };
    if (problem || !fits) {
      if (turnKey) { turnBuf = []; turnKey = null; }
      onStatus({ code: problem ? 'turn-problem' : 'turn', text: `${done + 1}/5　${problem || turnText[want]}`, ...info });
      onProgress(done, 0, 5);
      return;
    }
    turnKey = want;
    turnBuf.push(lm.map((p) => [p.x, p.y, p.z]));
    onStatus({ code: 'hold', text: `${done + 1}/5　そのまま`, ...info });
    onProgress(done, turnBuf.length / 6, 5);
    if (turnBuf.length < 6) return;
    views[want] = { cls, raw: averagePoints(turnBuf).map(([x, y, z]) => ({ x, y, z })), angles: fit.angles };
    turnBuf = []; turnKey = null;
    onShot(Object.keys(views).length);
    if (!nextTurn()) {
      stop();
      onDone({ turn: { w, h, views: TURN_ORDER.map((k) => views[k].raw), angles: TURN_ORDER.map((k) => views[k].angles) } });
    }
  }

  raf = requestAnimationFrame(loop);
  return { stop };
}
