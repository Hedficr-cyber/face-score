import { store } from './store.js';
import { analyze, ITEM_NAMES, browLineY, hairlineY, hairlineK } from './analysis.js';
import { rankHair, rankGlasses, frameSize } from './advice.js';
import { portraitSVG, welcomeMark } from './portrait.js';
import { chartSVG } from './chart.js';
import { startCapture } from './capture.js';
import { toFaceAxes } from './geometry.js';
import { SCORE, CAPTURE, PROVISIONAL } from './config.js';
import { VERSION } from './version.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
// 動作確認用（手元のサーバーのときだけ）
const DEV = ['localhost', '127.0.0.1'].includes(location.hostname) ? {
  log: [],
  // 数値だけを手元の開発用サーバーへ送る（写真は送らない）
  send(kind, data) {
    fetch('/__dev/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, at: new Date().toISOString(), ua: navigator.userAgent, ...data }) }).catch(() => {});
  },
} : null;

const ui = { tab: 'score', portrait: 'thirds', eyewear: 'glasses', open: new Set(), allHair: false, allGlasses: false };

// ---------- 計算（記録ごとに一度だけ） ----------
const memo = new Map();
function evaluate(rec) {
  if (memo.has(rec.id)) return memo.get(rec.id);
  const a = analyze(rec.points, rec.hairline);
  let spread = null;
  if (rec.shots && rec.shots.length > 1) {
    const totals = rec.shots.map((p) => analyze(p, rec.hairline).score.total);
    spread = (Math.max(...totals) - Math.min(...totals)) / 2;
  }
  const result = {
    ...a,
    spread,
    hair: rankHair(a.measures, a.shape, a.score),
    glasses: rankGlasses(a.measures, a.shape),
    size: frameSize(a.measures),
  };
  memo.set(rec.id, result);
  return result;
}

// ---------- 表示の部品 ----------
const pad2 = (n) => String(n).padStart(2, '0');
function dateText(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}  ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
const level = (v) => (v >= 80 ? 'hi' : v < 60 ? 'lo' : '');
const one = (v) => (Math.round(v * 10) / 10).toFixed(1);
const icon = {
  chev: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  updown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9l4-4 4 4M8 15l4 4 4-4"/></svg>',
};

function gauge(total) {
  const r = 54, c = 2 * Math.PI * r, arc = c * 0.75;
  const val = arc * Math.max(0, Math.min(100, total)) / 100;
  const [int, dec] = one(total).split('.');
  return `<div class="gauge">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="track" cx="60" cy="60" r="${r}" stroke-dasharray="${arc} ${c}"/>
      <circle class="bar" cx="60" cy="60" r="${r}" stroke-dasharray="${val} ${c}" ${total >= 80 ? 'style="stroke:var(--accent)"' : ''}/>
    </svg>
    <div class="gauge-num"><div class="n">${int}<small>.${dec}</small></div><div class="of">TOTAL / 100</div></div>
  </div>`;
}

function meter(v) {
  return `<div class="meter"><i class="${level(v)}" style="width:${Math.max(2, Math.min(100, v)).toFixed(1)}%"></i></div>`;
}

// ---------- 結果 ----------
function renderWelcome() {
  view.innerHTML = `<section class="welcome fade-in">
    <div class="welcome-mark">${welcomeMark()}</div>
    <h1>顔を測ってみましょう</h1>
    <p>正面から3回撮って平均し、比率を採点します。<br>写真は保存せず、どこにも送りません。</p>
    <button class="btn" type="button" data-act="shoot">測定をはじめる</button>
    <ul class="tips">
      <li><span>01</span>明るい場所で、顔に影ができないように</li>
      <li><span>02</span>メガネを外し、前髪を上げておでこを出す</li>
      <li><span>03</span>腕を伸ばしてスマホを目の高さに構える</li>
      <li><span>04</span>口を閉じて、自然な表情で正面を向く</li>
    </ul>
  </section>`;
}

function renderResult(rec, { latest }) {
  if (!rec) { renderWelcome(); return; }
  const r = evaluate(rec);
  const m = r.measures;
  const shape = r.shape;
  const second = shape.ranked[1];
  const chips = [
    `<span class="chip strong"><b>${esc(shape.main.name)}</b>${shape.main.p < 0.6 ? '寄り' : ''}（調整中）</span>`,
    second && second.p >= 0.15 ? `<span class="chip">${esc(second.name)} ${Math.round(second.p * 100)}%</span>` : '',
    r.spread != null ? `<span class="chip">ぶれ ±${one(r.spread)}</span>` : '',
    `<span class="chip">生え際 ${m.thirds.hairlineSet ? '指定' : '推定'}</span>`,
  ].join('');

  view.innerHTML = `
    ${latest ? '' : '<a class="chip" href="#history" style="display:inline-block;margin:2px 0 8px">← 記録へ戻る</a>'}
    <section class="hero fade-in">
      <div class="hero-date">${dateText(rec.at)}</div>
      ${gauge(r.score.total)}
      <div class="chips">${chips}</div>
    </section>
    <div class="seg" role="tablist" aria-label="結果の切り替え">
      ${[['score', 'スコア'], ['hair', '髪型'], ['eyewear', 'メガネ']].map(([k, t]) =>
        `<button type="button" role="tab" aria-selected="${ui.tab === k}" class="${ui.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}
    </div>
    <div id="tabBody" class="fade-in">${tabBody(rec, r)}</div>
    ${latest ? '' : `<div class="actions"><button class="btn danger block" type="button" data-act="delete" data-id="${esc(rec.id)}">この記録を削除</button></div>`}
  `;
}

function tabBody(rec, r) {
  if (ui.tab === 'hair') return hairTab(r);
  if (ui.tab === 'eyewear') return eyewearTab(r);
  return scoreTab(rec, r);
}

function scoreTab(rec, r) {
  const m = r.measures;
  const modes = [['thirds', '縦'], ['fifths', '横'], ['symmetry', '左右']];
  const items = Object.keys(SCORE.weights).map((k) => {
    const it = r.score.items[k];
    const open = ui.open.has(k);
    let extra = '';
    if (k === 'thirds') {
      const p = it.parts;
      extra = `<div class="ratio-bar">${p.map((v, i) => v == null
        ? '<span class="na" style="flex:1">推定</span>'
        : `<span style="flex:${v.toFixed(3)}">${Math.round(v * 100)}%</span>`).join('')}</div>`;
    }
    if (k === 'fifths') {
      // 線画と同じく鏡の向き（本人の左が画面の左）で並べる
      extra = `<div class="ratio-bar">${it.parts.slice().reverse().map((v) => `<span style="flex:${v.toFixed(3)}">${Math.round(v * 100)}</span>`).join('')}</div>`;
    }
    return `<div class="item${open ? ' open' : ''}" data-item="${k}">
      <button class="item-head" type="button" aria-expanded="${open}">
        <span class="item-name">${ITEM_NAMES[k]}<span class="item-weight">${Math.round(SCORE.weights[k] * 100)}%</span>${PROVISIONAL.includes(k) ? '<span class="item-tag">調整中</span>' : ''}</span>
        <span class="item-score ${level(it.score)}">${one(it.score)}</span>
        ${icon.chev}
        ${meter(it.score)}
      </button>
      <div class="item-body">${extra}<ul>${it.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>
    </div>`;
  }).join('');

  return `
    <div class="label">Portrait</div>
    <div class="card portrait">
      ${portraitSVG(rec.points, m, ui.portrait)}
      <div class="portrait-tools"><div class="seg mini">${modes.map(([k, t]) =>
        `<button type="button" class="${ui.portrait === k ? 'on' : ''}" data-portrait="${k}">${t}</button>`).join('')}</div></div>
    </div>
    <div class="label">Breakdown</div>
    <div class="items">${items}</div>
    <p class="small" style="margin-top:14px">点数は顔の比率を美容でよく使われる基準と比べたものです。魅力そのものの評価ではありません。<br>「調整中」の項目は、基準値を実際の顔のデータで見直している途中です（古典的な基準は平均的な日本人の顔でも外れやすく、低めに出ます）。</p>
  `;
}

function rankList(list, all) {
  const shown = all ? list : list.slice(0, 5);
  return `<div class="rank">${shown.map((h, i) => `
    <article class="rank-card${i === 0 ? ' best' : ''}">
      <div class="rank-top">
        <span class="rank-no">${pad2(i + 1)}</span>
        <span class="rank-name">${esc(h.name)}${i === 0 ? '<span class="rank-tag">BEST</span>' : ''}</span>
        <span class="rank-score">${Math.round(h.score)}</span>
      </div>
      ${meter(h.score)}
      <ul class="rank-why">${h.reasons.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <div class="rank-tip"><b>伝え方・選び方</b>　${esc(h.tip)}</div>
    </article>`).join('')}</div>`;
}

function hairTab(r) {
  return `
    <div class="label">Hair style</div>
    ${rankList(r.hair, ui.allHair)}
    ${r.hair.length > 5 && !ui.allHair ? `<button class="more" type="button" data-act="allHair">すべて見る（${r.hair.length}）</button>` : ''}
    <p class="small" style="margin-top:14px">顔の形との相性に、縦横の比率・おでこの広さ・あごの幅をどれだけ整えるかを足した点数です。</p>`;
}

function eyewearTab(r) {
  const list = r.glasses.filter((g) => g.kind === (ui.eyewear === 'sun' ? 'sunglasses' : 'glasses'));
  const s = r.size;
  return `
    <div class="label">Eyewear</div>
    <div class="seg mini">
      <button type="button" class="${ui.eyewear === 'glasses' ? 'on' : ''}" data-eyewear="glasses">メガネ</button>
      <button type="button" class="${ui.eyewear === 'sun' ? 'on' : ''}" data-eyewear="sun">サングラス</button>
    </div>
    <div class="card">
      <div class="size-grid">
        <div><b>${s.pd}</b><span>瞳孔間 mm</span></div>
        <div><b>${s.lensPlusBridge[0]}–${s.lensPlusBridge[1]}</b><span>レンズ＋ブリッジ mm</span></div>
        <div><b>${s.lens[0]}–${s.lens[1]}</b><span>レンズ幅 mm</span></div>
      </div>
      <p class="small" style="margin:0">${esc(s.bridge)}<br>黒目の大きさから推定した目安です（±5% 程度）。メガネの「52□18」のような表記は、レンズ幅□ブリッジ幅です。</p>
      <p class="small" style="margin:6px 0 0">顔の形の判定は基準を調整中のため、順位は目安です。</p>
    </div>
    <div style="height:10px"></div>
    ${rankList(list, true)}`;
}

// ---------- 記録 ----------
function renderHistory() {
  const recs = store.records();
  if (!recs.length) {
    view.innerHTML = `<div class="empty fade-in">まだ記録がありません。<br><br><button class="btn" type="button" data-act="shoot">測定をはじめる</button></div>`;
    return;
  }
  const rows = recs.map((rec) => ({ rec, r: evaluate(rec) }));
  const totals = rows.map((x) => x.r.score.total);
  const best = Math.max(...totals);
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const chrono = rows.slice(0, 30).reverse().map((x) => ({ at: x.rec.at, total: x.r.score.total }));
  view.innerHTML = `
    <div class="fade-in">
      <div class="label" style="margin-top:8px">Summary</div>
      <div class="stats">
        <div><b>${one(totals[0])}</b><span>最新</span></div>
        <div><b>${one(best)}</b><span>最高</span></div>
        <div><b>${one(avg)}</b><span>平均</span></div>
        <div><b>${recs.length}</b><span>回数</span></div>
      </div>
      <div class="card chart">${chartSVG(chrono)}</div>
      <div class="label">History</div>
      <div class="list">${rows.map(({ rec, r }, i) => {
        const prev = rows[i + 1];
        const d = prev ? r.score.total - prev.r.score.total : null;
        return `<a class="row" href="#r/${encodeURIComponent(rec.id)}">
          <div><div class="row-date">${dateText(rec.at)}</div><div class="row-sub">${esc(r.shape.main.name)}・生え際${r.measures.thirds.hairlineSet ? '指定' : '推定'}</div></div>
          <div class="row-delta${d != null && d > 0 ? ' up' : ''}">${d == null ? '' : `${d >= 0 ? '+' : ''}${one(d)}`}</div>
          <div class="row-score">${one(r.score.total)}</div>
        </a>`;
      }).join('')}</div>
      <div class="actions">
        <button class="btn ghost block" type="button" data-act="export">データを書き出す（JSON）</button>
        <button class="btn danger block" type="button" data-act="clear">すべての記録を削除</button>
      </div>
    </div>`;
}

// ---------- 画面の切り替え ----------
function route() {
  const hash = location.hash || '#result';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', hash.startsWith(`#${t.dataset.tab}`) || (t.dataset.tab === 'history' && hash.startsWith('#r/'))));
  if (hash.startsWith('#r/')) {
    const rec = store.get(decodeURIComponent(hash.slice(3)));
    if (!rec) { location.replace('#history'); return; }
    renderResult(rec, { latest: false });
  } else if (hash === '#history') {
    renderHistory();
  } else {
    renderResult(store.latest(), { latest: true });
  }
  window.scrollTo(0, 0);
}

function rerenderTab() {
  const body = $('#tabBody');
  const hash = location.hash || '#result';
  const rec = hash.startsWith('#r/') ? store.get(decodeURIComponent(hash.slice(3))) : store.latest();
  if (!body || !rec) return;
  body.innerHTML = tabBody(rec, evaluate(rec));
  document.querySelectorAll('.seg [data-tab]').forEach((b) => {
    b.classList.toggle('on', b.dataset.tab === ui.tab);
    b.setAttribute('aria-selected', b.dataset.tab === ui.tab);
  });
}

view.addEventListener('click', (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;
  if (t.dataset.tab) { ui.tab = t.dataset.tab; rerenderTab(); return; }
  if (t.dataset.portrait) { ui.portrait = t.dataset.portrait; rerenderTab(); return; }
  if (t.dataset.eyewear) { ui.eyewear = t.dataset.eyewear; rerenderTab(); return; }
  if (t.classList.contains('item-head')) {
    const k = t.closest('.item').dataset.item;
    if (ui.open.has(k)) ui.open.delete(k); else ui.open.add(k);
    t.closest('.item').classList.toggle('open', ui.open.has(k));
    t.setAttribute('aria-expanded', ui.open.has(k));
    return;
  }
  const act = t.dataset.act;
  if (act === 'shoot') openCapture();
  if (act === 'allHair') { ui.allHair = true; rerenderTab(); }
  if (act === 'export') exportData();
  if (act === 'clear') confirmSheet('すべての記録を削除しますか？', '元に戻せません。必要なら先に書き出してください。', '削除する', () => { store.clear(); memo.clear(); route(); toast('削除しました'); });
  if (act === 'delete') confirmSheet('この記録を削除しますか？', '元に戻せません。', '削除する', () => { store.remove(t.dataset.id); memo.delete(t.dataset.id); location.hash = '#history'; toast('削除しました'); });
});

function exportData() {
  const blob = new Blob([store.exportText()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `face-score_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- シート・通知 ----------
const sheet = $('#sheet');
function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  sheet.hidden = false;
}
function closeSheet() { sheet.hidden = true; }
sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

function confirmSheet(title, text, okText, onOk) {
  openSheet(`<h2 id="sheetTitle">${esc(title)}</h2><p>${esc(text)}</p>
    <div class="actions" style="margin-top:18px"><button class="btn danger block" type="button" id="sheetOk">${esc(okText)}</button>
    <button class="btn ghost block" type="button" data-close>やめる</button></div>`);
  $('#sheetOk').addEventListener('click', () => { closeSheet(); onOk(); }, { once: true });
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

$('#infoBtn').addEventListener('click', () => openSheet(`
  <h2 id="sheetTitle">FACE SCORE について</h2>
  <p>自分の顔の比率を測って採点し、似合う髪型・メガネを点数つきで提案する、個人用のアプリです。</p>
  <h3>点数の出し方</h3>
  <ul>
    <li>顔の478点の位置をスマホの中で検出し、顔の向きを正面にそろえてから測ります。</li>
    <li>左右対称 30%、縦のバランス 20%、横のバランス 20%、パーツの配置 15%、輪郭 15% の重みで総合点にします。</li>
    <li>縦3等分・横5等分などは美容でよく使われる基準です。点数は手加減なしで、基準からのずれをそのまま点にしています。</li>
    <li>比率の点数であり、魅力そのものや人としての価値の評価ではありません。</li>
  </ul>
  <h3>精度について</h3>
  <ul>
    <li>角度・照明・表情・前髪で数値は少し変わります。3回撮って平均し、そのぶれ幅を「ぶれ」に表示しています。</li>
    <li>生え際は顔の点に含まれないため、撮影後に自分で合わせます。合わせないときは推定値を使い、縦のバランスは中と下だけで採点します。</li>
    <li>メガネのサイズは黒目の大きさ（平均 11.7mm）から推定した目安です。</li>
    <li>横のバランス・パーツの配置・輪郭と顔の形は、基準値を実際の顔のデータで調整している途中です。</li>
  </ul>
  <h3>データ</h3>
  <ul>
    <li>写真は保存せず、どこにも送りません。保存するのは顔の点の座標と点数のもとになる数値だけで、この端末の中にあります。</li>
    <li>顔の検出には Google の MediaPipe（Apache-2.0）をアプリに同梱して使っています。利用状況の送信もアプリ側で止めています。</li>
  </ul>
  <p class="small" style="margin-top:18px">バージョン ${VERSION}・3枚×${CAPTURE.framesPerShot}フレームの平均</p>
`));

// ---------- 撮影 ----------
const cap = {
  el: $('#capture'), video: $('#camVideo'), canvas: $('#camCanvas'), status: $('#capStatus'),
  ring: $('#guideRing'), dots: [...$('#capShots').children], flash: $('#capFlash'), session: null,
};

async function openCapture() {
  cap.el.hidden = false;
  document.body.style.overflow = 'hidden';
  cap.dots.forEach((d) => d.classList.remove('on'));
  cap.ring.style.strokeDasharray = '0 100';
  cap.status.textContent = 'カメラを準備しています';
  cap.status.classList.remove('ok');
  cap.session = await startCapture({
    video: cap.video,
    canvas: cap.canvas,
    onStatus: (s) => {
      if (DEV && DEV.log.length > 600) DEV.log.splice(0, 200);
      if (DEV) DEV.log.push({ t: Math.round(performance.now()), code: s.code, a: s.angles && Object.fromEntries(Object.entries(s.angles).map(([k, v]) => [k, Math.round(v * 10) / 10])) });
      cap.status.textContent = s.text;
      cap.status.classList.toggle('ok', s.code === 'hold');
    },
    onProgress: (done, frac) => {
      const p = ((done + frac) / CAPTURE.shots) * 100;
      cap.ring.style.strokeDasharray = `${p.toFixed(1)} 100`;
    },
    onShot: (n) => {
      cap.dots.forEach((d, i) => d.classList.toggle('on', i < n));
      cap.flash.classList.remove('go'); void cap.flash.offsetWidth; cap.flash.classList.add('go');
    },
    onDone: (res) => {
      if (DEV) DEV.send('capture', { log: DEV.log.splice(0), video: [cap.video.videoWidth, cap.video.videoHeight], snapshotLandmarks: res.snapshot.landmarks });
      closeCapture(); openHairline(res);
    },
    onError: (err) => {
      if (DEV) DEV.send('error', { code: err.code, error: String(err.error), log: DEV.log.splice(0) });
      closeCapture(); toast(err.text); console.warn(err.error);
    },
  });
}

function closeCapture() {
  cap.session?.stop();
  cap.session = null;
  cap.el.hidden = true;
  document.body.style.overflow = '';
}

$('#capClose').addEventListener('click', closeCapture);
$('#shootBtn').addEventListener('click', openCapture);

// ---------- 生え際の調整 ----------
function openHairline({ points, shots, snapshot }) {
  const { canvas: snap, landmarks: lm, fit, width: w, height: h } = snapshot;
  const fp = toFaceAxes(lm, w, h).map(fit.apply);
  const saved = store.setting('hairlineK');
  const k0 = Number.isFinite(saved) ? saved : 1;

  // 顔の縦軸（あご先→額）を画像上で求める
  const px = (i) => [lm[i].x * w, lm[i].y * h];
  const p10 = px(10), p152 = px(152);
  let ux = p10[0] - p152[0], uy = p10[1] - p152[1];
  const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
  const z10 = -lm[10].z * w;

  // 正面座標の y ⇔ 画像上の軸上の位置 t
  const yToT = (yF) => {
    const a = fit.invert([fp[10][0], yF, fp[10][2]]);
    return (a[0] - p10[0]) * ux + (-a[1] - p10[1]) * uy;
  };
  const tToY = (t) => fit.apply([p10[0] + ux * t, -(p10[1] + uy * t), z10])[1];

  const el = document.createElement('section');
  el.className = 'hairline';
  el.innerHTML = `
    <div class="hairline-head">
      <h2>生え際の位置</h2>
      <p>線を上下に動かして、髪の生え始めに合わせてください</p>
    </div>
    <div class="hairline-stage" id="hlStage">
      <canvas id="hlCanvas"></canvas>
      <div class="hairline-line" id="hlLine"><span class="tag">${Number.isFinite(saved) ? '前回の位置' : '推定の位置'}</span><span class="knob">${icon.updown}</span></div>
    </div>
    <div class="hairline-foot">
      <button class="btn block" type="button" id="hlOk">この位置で決定</button>
      <button class="btn ghost block" type="button" id="hlSkip">見えない・わからない（推定で測る）</button>
    </div>`;
  document.body.append(el);

  const stage = $('#hlStage', el), cv = $('#hlCanvas', el), line = $('#hlLine', el);
  const faceH = Math.hypot(p10[0] - p152[0], p10[1] - p152[1]);
  const cx = (lm[234].x + lm[454].x) / 2 * w;
  let crop;
  let t = yToT(hairlineY(fp, k0));

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const sw = stage.clientWidth, sh = stage.clientHeight;
    cv.width = Math.round(sw * dpr); cv.height = Math.round(sh * dpr);
    const top = p10[1] - faceH * 0.85, bottom = p152[1] + faceH * 0.15;
    const ch = bottom - top, cw = ch * (sw / sh);
    crop = { left: cx - cw / 2, top, width: cw, height: ch, sw, sh };
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.translate(cv.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(snap, crop.left, crop.top, crop.width, crop.height, 0, 0, cv.width, cv.height);
    ctx.restore();
    place();
  }
  // 画像座標 ⇔ 画面座標（左右反転）
  const toScreen = (ix, iy) => [crop.sw - ((ix - crop.left) / crop.width) * crop.sw, ((iy - crop.top) / crop.height) * crop.sh];
  const toImage = (sx, sy) => [crop.left + ((crop.sw - sx) / crop.sw) * crop.width, crop.top + (sy / crop.sh) * crop.height];
  function place() {
    const [sx, sy] = toScreen(p10[0] + ux * t, p10[1] + uy * t);
    // 画面上の顔の上向き（左右反転後）に垂直な向きへ線を傾ける
    const angle = Math.atan2(uy, -ux) * 180 / Math.PI + 90;
    line.style.top = `${sy}px`;
    line.style.transformOrigin = `${sx}px 50%`;
    line.style.transform = `rotate(${angle.toFixed(2)}deg)`;
  }
  const drag = (e) => {
    const r = stage.getBoundingClientRect();
    const [ix, iy] = toImage(e.clientX - r.left, e.clientY - r.top);
    const nt = (ix - p10[0]) * ux + (iy - p10[1]) * uy;
    t = Math.max(-faceH * 0.15, Math.min(faceH * 0.8, nt));
    place();
  };
  stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); drag(e); });
  stage.addEventListener('pointermove', (e) => { if (stage.hasPointerCapture(e.pointerId)) drag(e); });
  requestAnimationFrame(layout);
  window.addEventListener('resize', layout);

  const finish = (hairline) => {
    window.removeEventListener('resize', layout);
    el.remove();
    snap.width = 0; snap.height = 0; // 撮影した画像を破棄
    const rec = store.add({ points, shots, hairline, version: VERSION });
    if (DEV) {
      const r = evaluate(rec);
      DEV.send('result', { rec, total: r.score.total, items: Object.fromEntries(Object.entries(r.score.items).map(([k, v]) => [k, { score: v.score, notes: v.notes }])),
        shape: r.shape.ranked, measures: r.measures, hair: r.hair.slice(0, 5).map((h) => [h.name, h.score]), glasses: r.glasses.map((g) => [g.name, g.score]), size: r.size, spread: r.spread });
    }
    ui.tab = 'score'; ui.open.clear();
    if (location.hash === '#result' || !location.hash) route(); else location.hash = '#result';
    toast(rec ? '測定しました' : '保存できませんでした');
  };
  $('#hlOk', el).addEventListener('click', () => {
    const k = hairlineK(fp, tToY(t));
    store.setSetting('hairlineK', k);
    finish({ source: 'manual', k });
  });
  $('#hlSkip', el).addEventListener('click', () => finish({ source: 'estimated', k: 1 }));
}

// ---------- 起動 ----------
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (DEV) window.__faceScore = { store, evaluate, openHairline, route, browLineY, dev: DEV };
