// アクセサリーの試着：前面カメラの映像に、メガネ・サングラスの形（eyewear-visuals.js の12種類）を
// 黒目の位置・間隔・傾きに合わせて重ねる。映像の処理はすべて端末の中だけで、保存も送信もしない。
// 画像生成（顔写真を外部へ送る方式）は使わない：「顔写真は端末の外に送らない」決まりのため（2026-10-20）。
import { loadLandmarker } from './detector.js';
import { eyewearSVG, TRYON_GEOMETRY as G } from './eyewear-visuals.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const images = new Map();
function frameImage(id, kind) {
  const key = `${id}|${kind}`;
  if (!images.has(key)) {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(eyewearSVG(id, kind, { overlay: true }))}`;
    images.set(key, img);
  }
  return images.get(key);
}

// 顔の点（478点、0〜1の座標）から、フレームを置く位置：左右の黒目の中心（468・473）の中点・間隔・傾き
export function framePlacement(f, w, h) {
  const a = { x: f[468].x * w, y: f[468].y * h }, b = { x: f[473].x * w, y: f[473].y * h };
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
}
// フレームの画像を、黒目の間隔＝左右のレンズの中心の間隔になる大きさで描く
export function drawFrame(ctx, place, img) {
  if (!img.complete || !img.naturalWidth) return false;
  const s = place.d / G.lensCenterGap;
  ctx.save();
  ctx.translate(place.cx, place.cy);
  ctx.rotate(place.ang);
  ctx.scale(s, s);
  ctx.drawImage(img, -G.pupilX, -G.pupilY, G.width, G.height);
  ctx.restore();
  return true;
}
export { frameImage };

// items：[{ id, name, kind: 'glasses'|'sunglasses', score }]。startId の形から始める
export function openTryOn({ items, startId, onClose = null }) {
  const el = document.createElement('section');
  el.className = 'capture tryon';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'アクセサリーの試着');
  el.innerHTML = `
    <video class="cam" autoplay muted playsinline></video>
    <canvas class="cam cam-overlay"></canvas>
    <div class="cap-top">
      <button class="icon-btn glass" type="button" data-tryon="close" aria-label="試着をやめる"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <div class="cap-status" role="status" aria-live="polite">カメラを準備しています</div>
    </div>
    <div class="tryon-bottom">
      <div class="tryon-list" role="listbox" aria-label="試すフレーム">${items.map((it) => `
        <button type="button" role="option" class="tryon-item" data-id="${esc(it.id)}" aria-selected="false">
          <span class="tryon-kind">${it.kind === 'sunglasses' ? 'サングラス' : 'メガネ'}</span>
          <b>${esc(it.name)}</b><span class="tryon-score">${Math.round(it.score)}</span>
        </button>`).join('')}</div>
      <p class="tryon-note">映像はスマホの中だけで重ねています。保存も送信もしません。形と大きさの目安なので、かけ心地や実際の見え方はお店で確かめてください。</p>
    </div>`;
  document.body.append(el);
  document.body.style.overflow = 'hidden';

  const video = el.querySelector('video'), canvas = el.querySelector('canvas'), ctx = canvas.getContext('2d');
  const status = el.querySelector('.cap-status');
  let current = items.find((it) => it.id === startId) || items[0];
  let stream = null, raf = 0, stopped = false, smooth = null, lastTime = -1;

  const select = (id) => {
    current = items.find((it) => it.id === id) || current;
    el.querySelectorAll('.tryon-item').forEach((b) => {
      const on = b.dataset.id === current.id;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('on', on);
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
    frameImage(current.id, current.kind);
  };
  const close = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    el.remove();
    document.body.style.overflow = '';
    onClose?.();
  };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-tryon="close"]')) { close(); return; }
    const b = e.target.closest('.tryon-item');
    if (b) select(b.dataset.id);
  });
  select(current.id);

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      status.textContent = '顔の検出を準備しています';
      const landmarker = await loadLandmarker();
      if (stopped) return;
      const loop = () => {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        if (video.readyState < 2 || video.currentTime === lastTime) return;
        lastTime = video.currentTime;
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        let result;
        try { result = landmarker.detectForVideo(video, performance.now()); } catch { return; }
        const f = result.faceLandmarks?.[0];
        ctx.clearRect(0, 0, w, h);
        if (!f || f.length < 478) { status.textContent = '顔を画面に入れてください'; smooth = null; return; }
        status.textContent = `${current.name}（${current.kind === 'sunglasses' ? 'サングラス' : 'メガネ'}）`;
        // 左右の黒目の位置・間隔・傾きに合わせる。小さな揺れはならす
        const target = framePlacement(f, w, h);
        smooth = smooth ? Object.fromEntries(Object.keys(target).map((k) => [k, smooth[k] + 0.45 * (target[k] - smooth[k])])) : target;
        drawFrame(ctx, smooth, frameImage(current.id, current.kind));
      };
      loop();
    } catch (e) {
      status.textContent = 'カメラを使えませんでした。設定でカメラを許可してください';
    }
  })();
  return { close };
}
