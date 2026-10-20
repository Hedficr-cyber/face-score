// 3D試着。画像は画面のメモリ内だけ。永続保存・採点・書出し・送信はしない。
import { loadLandmarker } from './detector.js';
import { TryOnStage, disposeProductRenderer } from './eyewear-3d.js';
import { FRAMES } from './eyewear-models.js';
import { demoModel, imageOf, photoFromFile, photoFromVideo, releaseTryonImage, releaseTryonPhotoDetector } from './tryon-photo.js';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let active = null;

export function openTryOn({ items, startId, pd = null, onClose = null }) {
  active?.close();
  const valid = Array.isArray(items) ? items.filter(it => Object.hasOwn(FRAMES, it.id)) : [];
  if (!valid.length) return { close() {} };
  const returnFocus = document.activeElement, oldOverflow = document.body.style.overflow;
  const el = document.createElement('section'); el.className = 'capture tryon';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'アクセサリーの3D試着');
  el.innerHTML = `<video autoplay muted playsinline hidden></video>
    <div class="tryon-stage"><canvas aria-label="フレームを重ねた試着プレビュー"></canvas></div>
    <div class="cap-top"><button class="icon-btn glass" type="button" data-tryon="close" aria-label="試着をやめる"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button><div class="cap-status" role="status" aria-live="polite">見本を準備しています</div></div>
    <div class="tryon-sources"><button type="button" class="btn ghost" data-tryon="demo">見本の顔</button><button type="button" class="btn ghost" data-tryon="camera">カメラ</button><button type="button" class="btn ghost" data-tryon="photo">自分の写真</button><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden aria-label="試着だけに使う自分の写真"></div>
    <div class="tryon-bottom"><button class="btn ghost tryon-freeze" type="button" data-tryon="freeze" hidden>この瞬間で試す</button>
      <div class="tryon-list" role="listbox" aria-label="試すフレーム">${valid.map(it => `<button type="button" role="option" class="tryon-item" data-id="${esc(it.id)}" aria-selected="false"><span class="tryon-kind">${it.kind === 'sunglasses' ? 'サングラス' : 'メガネ'}</span><b>${esc(it.name)}</b><span class="tryon-score">${Number.isFinite(it.score) ? Math.round(it.score) : ''}</span></button>`).join('')}</div>
      <p class="tryon-note">見本はCGです。自分の写真・映像は端末内だけで処理し、この画面を閉じると消えます。保存・送信・採点には使いません。寸法と見え方は目安です。</p></div>`;
  document.body.append(el); document.body.style.overflow = 'hidden';
  const video = el.querySelector('video'), canvas = el.querySelector('canvas'), host = el.querySelector('.tryon-stage');
  const status = el.querySelector('.cap-status'), input = el.querySelector('input'), freeze = el.querySelector('[data-tryon="freeze"]');
  let stage = null, stream = null, raf = 0, stopped = false, epoch = 0, stillImage = null;
  let photoController = new AbortController();
  const beginOperation = () => { photoController.abort(); photoController = new AbortController(); return ++epoch; };
  let current = valid.find(it => it.id === startId) || valid[0], mode = 'demo', lastTime = -1, smooth = null;
  const stopCamera = () => { cancelAnimationFrame(raf); raf = 0; stream?.getTracks().forEach(t => t.stop()); stream = null; video.pause(); video.srcObject = null; freeze.hidden = true; lastTime = -1; smooth = null; };
  const releaseImage = () => { if (stillImage) releaseTryonImage(stillImage); stillImage = null; };
  const fit = () => {
    if (!stage || stopped || !host.clientWidth || !host.clientHeight) return;
    const s = Math.min(host.clientWidth / stage.W, host.clientHeight / stage.H);
    stage.resize(Math.max(1, stage.W * s), Math.max(1, stage.H * s)); stage.render();
  };
  const select = id => {
    current = valid.find(it => it.id === id) || current;
    el.querySelectorAll('.tryon-item').forEach(b => { const on = b.dataset.id === current.id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    stage?.setFrame(current.id); stage?.render();
  };
  const showStill = async (photo, token) => {
    if (stopped || epoch !== token) return;
    const img = await imageOf(photo, { signal: photoController.signal });
    if (stopped || epoch !== token) { releaseTryonImage(img); return; }
    stopCamera(); releaseImage(); stillImage = img;
    stage.setSource(img, photo.w, photo.h); stage.setPd(pd); stage.setFrame(current.id);
    if (!stage.setFace(photo.landmarks.map(p => ({ x: p[0], y: p[1], z: p[2] })))) throw new Error('この写真では試着の位置を合わせられませんでした');
    canvas.classList.remove('mirrored'); mode = photo.demo ? 'demo' : 'photo';
    status.textContent = photo.demo ? '見本のCG・本人の顔ではありません' : '自分の写真・この画面だけ'; fit();
  };
  const showDemo = async () => {
    const token = beginOperation(); stopCamera();
    try { status.textContent = '見本を準備しています'; await showStill(await demoModel(), token); }
    catch { if (!stopped && token === epoch) status.textContent = '見本を読み込めませんでした。ネット接続を確認してください'; }
  };
  const startCamera = async () => {
    const token = beginOperation(); stopCamera(); status.textContent = 'カメラの許可を待っています';
    try {
      const got = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (stopped || token !== epoch) { got.getTracks().forEach(t => t.stop()); return; }
      stream = got; video.srcObject = got; await video.play(); if (stopped || token !== epoch) return;
      status.textContent = '顔の検出を準備しています'; const landmarker = await loadLandmarker(); if (stopped || token !== epoch) return;
      releaseImage(); mode = 'camera'; stage.setPd(pd); stage.setFrame(current.id); canvas.classList.add('mirrored'); freeze.hidden = false;
      const loop = () => {
        if (stopped || token !== epoch) return; raf = requestAnimationFrame(loop);
        const w = video.videoWidth, h = video.videoHeight;
        if (video.readyState < 2 || !w || !h || video.currentTime === lastTime) return; lastTime = video.currentTime;
        if (stage.W !== w || stage.H !== h || stage.photo?.material.map?.image !== video) { stage.setSource(video, w, h); fit(); smooth = null; }
        let f;
        try { f = landmarker.detectForVideo(video, performance.now()).faceLandmarks?.[0]; }
        catch { stopCamera(); stage.clear(); stage.render(); status.textContent = '顔を読み取れませんでした。カメラを開き直すか写真を選んでください'; return; }
        if (!f || f.length !== 478) { stage.clearFace(); smooth = null; status.textContent = '顔を画面に入れてください'; }
        else { smooth = smooth ? f.map((p,i) => ({ x: smooth[i].x + .55 * (p.x - smooth[i].x), y: smooth[i].y + .55 * (p.y - smooth[i].y), z: smooth[i].z + .55 * (p.z - smooth[i].z) })) : f; status.textContent = stage.setFace(smooth) ? current.name : '顔を正面に向けてください'; }
        stage.render();
      }; loop();
    } catch { if (stopped || token !== epoch) return; stopCamera(); status.textContent = 'カメラを使えませんでした。見本か自分の写真でも試せます'; }
  };
  const close = () => {
    if (stopped) return; stopped = true; epoch++; photoController.abort(); stopCamera(); releaseImage(); input.value = '';
    observer?.disconnect(); window.removeEventListener('resize', fit); window.removeEventListener('pagehide', close); window.removeEventListener('hashchange', close);
    document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', keys);
    stage?.dispose(); stage = null; disposeProductRenderer(); void releaseTryonPhotoDetector().catch(() => {}); el.remove(); canvas.width = canvas.height = 0; document.body.style.overflow = oldOverflow;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); if (active?.close === close) active = null; onClose?.();
  };
  const visibility = () => { if (document.hidden) close(); };
  const keys = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; } if (e.key !== 'Tab') return;
    const buttons = [...el.querySelectorAll('button:not([disabled])')].filter(b => !b.hidden), first = buttons[0], last = buttons.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  };
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  observer?.observe(host); window.addEventListener('resize', fit); window.addEventListener('pagehide', close); window.addEventListener('hashchange', close);
  document.addEventListener('visibilitychange', visibility); document.addEventListener('keydown', keys);
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return; if (b.dataset.id) { select(b.dataset.id); return; }
    const act = b.dataset.tryon;
    if (act === 'close') close(); if (act === 'demo') showDemo(); if (act === 'camera') startCamera(); if (act === 'photo') input.click();
    if (act === 'freeze' && mode === 'camera') {
      const token = beginOperation(), signal = photoController.signal; cancelAnimationFrame(raf); freeze.disabled = true;
      try { await showStill(await photoFromVideo(video, null, { signal }), token); } catch (err) { if (!stopped && token === epoch) { stopCamera(); status.textContent = err.message; } } finally { freeze.disabled = false; }
    }
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; input.value = ''; if (!file) return; const token = beginOperation(), signal = photoController.signal; stopCamera(); status.textContent = '写真の顔を確認しています';
    try { await showStill(await photoFromFile(file, { signal }), token); } catch (err) { if (!stopped && token === epoch) status.textContent = err.message || '写真を読み込めませんでした'; }
  });
  active = { close }; select(current.id); el.querySelector('[data-tryon="close"]').focus();
  try { stage = new TryOnStage(canvas); stage.setPd(pd); stage.setFrame(current.id); showDemo(); }
  catch { status.textContent = 'このブラウザは3D試着に対応していません。別のブラウザでお試しください'; el.querySelectorAll('[data-tryon]:not([data-tryon="close"])').forEach(b => b.disabled = true); }
  return active;
}
