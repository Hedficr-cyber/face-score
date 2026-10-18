// 撮影：前面カメラの映像から顔を追い、条件がそろったら自動で撮る（3枚×数フレームの平均）。
// 映像・画像はどこにも送らず、保存もしない。生え際の調整用に1枚だけメモリ上に残す。
import { loadLandmarker, reloadOnCpu } from './detector.js';
import { toFaceAxes, alignToCanonical, averagePoints } from './geometry.js';
import { LINES } from './mesh-data.js';
import { CAPTURE } from './config.js';

const C = CAPTURE;

function blend(result, name) {
  const cats = result.faceBlendshapes?.[0]?.categories || [];
  return cats.find((c) => c.categoryName === name)?.score ?? 0;
}

// 条件を確かめて、直すべき点を1つ返す（null なら撮れる）
function check(lm, fit, result, w, h) {
  const short = Math.min(w, h);
  const faceW = Math.hypot((lm[454].x - lm[234].x) * w, (lm[454].y - lm[234].y) * h) / short;
  if (faceW < C.minFaceWidth) return { code: 'far', text: 'もう少し近づいてください' };
  if (faceW > C.maxFaceWidth) return { code: 'near', text: '少し離れてください' };
  const cx = ((lm[234].x + lm[454].x) / 2 - 0.5) * w / short;
  const cy = ((lm[10].y + lm[152].y) / 2 - 0.5) * h / short;
  if (Math.hypot(cx, cy) > C.maxCenterOffset) return { code: 'center', text: '顔を枠の中央に合わせてください' };
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

export async function startCapture({ video, canvas, onStatus, onProgress, onShot, onDone, onError }) {
  let stopped = false;
  let stream = null;
  let raf = 0;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  try {
    onStatus({ code: 'loading', text: 'カメラを準備しています' });
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
    });
    if (stopped) { stop(); return { stop }; }
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute('playsinline', '');
    await video.play();
  } catch (e) {
    stop();
    onError({ code: 'camera', text: 'カメラを使えませんでした。ブラウザの設定でカメラを許可してください。', error: e });
    return { stop };
  }

  let landmarker;
  try {
    onStatus({ code: 'loading', text: '顔の検出を準備しています（初回は少し時間がかかります）' });
    landmarker = await loadLandmarker();
  } catch (e) {
    stop();
    onError({ code: 'model', text: '顔の検出を準備できませんでした。電波の良い場所で開き直してください。', error: e });
    return { stop };
  }
  if (stopped) return { stop };

  const ctx = canvas.getContext('2d');
  const shots = [];
  let buffer = [];
  let hold = 0;
  let waitUntil = 0;
  let lastTime = -1;
  let snapshot = null;
  let retried = false;

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
        if (next) { landmarker = next; raf = requestAnimationFrame(loop); return; }
      }
      stop();
      onError({ code: 'detect', text: '顔の検出でエラーが起きました。もう一度お試しください。', error: e });
      return;
    }

    const lm = result.faceLandmarks?.[0];
    if (!lm || lm.length < 478) {
      hold = 0; buffer = [];
      drawOverlay(ctx, null, w, h, false);
      onStatus({ code: 'search', text: '顔を枠に合わせてください' });
      onProgress(shots.length, 0);
      return;
    }
    const pts = toFaceAxes(lm, w, h);
    const fit = alignToCanonical(pts);
    const problem = check(lm, fit, result, w, h);
    drawOverlay(ctx, lm, w, h, !problem);

    if (problem) {
      hold = 0; buffer = [];
      onStatus({ ...problem, angles: fit.angles });
      onProgress(shots.length, 0);
      return;
    }
    if (performance.now() < waitUntil) return;
    hold += 1;
    onStatus({ code: 'hold', text: 'そのまま動かないでください', angles: fit.angles });
    if (hold < C.holdFrames) { onProgress(shots.length, hold / (C.holdFrames + C.framesPerShot)); return; }

    buffer.push(pts.map(fit.apply));
    if (!snapshot && buffer.length === Math.ceil(C.framesPerShot / 2)) {
      // 生え際の調整用に今のフレームを1枚だけメモリに残す
      const shotCanvas = document.createElement('canvas');
      shotCanvas.width = w; shotCanvas.height = h;
      shotCanvas.getContext('2d').drawImage(video, 0, 0, w, h);
      snapshot = { canvas: shotCanvas, landmarks: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })), fit, width: w, height: h };
    }
    onProgress(shots.length, (hold + buffer.length) / (C.holdFrames + C.framesPerShot));
    if (buffer.length < C.framesPerShot) return;

    shots.push(averagePoints(buffer));
    buffer = []; hold = 0;
    waitUntil = performance.now() + C.gapMs;
    onShot(shots.length);
    onProgress(shots.length, 0);
    if (shots.length >= C.shots) {
      const points = averagePoints(shots);
      stop();
      onDone({ points, shots, snapshot });
    }
  };
  raf = requestAnimationFrame(loop);
  return { stop };
}
