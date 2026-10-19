import { store } from './store.js';
import { analyze, ITEM_NAMES, browLineY, hairlineY, hairlineK } from './analysis.js';
import { rankHair, rankGlasses, frameSize } from './advice.js';
import { portraitSVG, welcomeMark } from './portrait.js';
import { chartSVG } from './chart.js';
import { startCapture } from './capture.js';
import { loadLandmarker } from './detector.js';
import { toFaceAxes, alignToCanonical, averagePoints } from './geometry.js';
import { detectHairline } from './hairline.js';
import { frontalFromRaw, solveFocalFromTurns, fovDegrees } from './calibration.js';
import { unpackRaw } from './store.js';
import { SCORE, CAPTURE, PROVISIONAL, CAMERA } from './config.js';
import { VERSION } from './version.js';
import { predictAttractiveness, validateJapaneseMaleModel } from './relative-score.js';

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
let attractivenessModel = null;
try { attractivenessModel = validateJapaneseMaleModel(store.setting('attractivenessModel')); } catch { /* 日本人男性の基準がなければ主点は未算出 */ }
const displayedScore = (r) => r.attractiveness?.percentile ?? null;
const metricLabel = () => '日本人男性の魅力相対点';

// ---------- カメラの焦点距離（端末と解像度ごと。較正していなければ想定値） ----------
const camKey = (w, h) => `${Math.max(w, h)}x${Math.min(w, h)}`;
function focalFor(w, h) {
  const cal = (store.setting('focals') || {})[camKey(w, h)];
  return cal ? { focal: cal.focal, zScale: cal.zScale || 1, calibrated: true } : { focal: CAMERA.focalRatio * Math.max(w, h), zScale: 1, calibrated: false };
}

// ---------- 計算（記録ごとに一度だけ） ----------
const memo = new Map();
function evaluate(rec) {
  if (memo.has(rec.id)) return memo.get(rec.id);
  // v0.2.0 以降の記録は生の点から、いまの焦点距離で遠近を補正し直す
  let points = rec.points, shotPoints = rec.shots, calibrated = null;
  if (rec.raw) {
    const cam = focalFor(rec.raw.w, rec.raw.h);
    calibrated = cam.calibrated;
    shotPoints = rec.raw.shots.map((s) => frontalFromRaw(unpackRaw(s), rec.raw.w, rec.raw.h, cam.focal, cam.zScale));
    points = averagePoints(shotPoints);
  }
  const a = analyze(points, rec.hairline);
  let attractiveness = null, attractivenessError = null;
  if (attractivenessModel && rec.raw) {
    // 学習写真と同じ入力処理。比率側の遠近補正済みPを、そのまま研究モデルへ渡さない。
    try {
      const researchPoints = averagePoints(rec.raw.shots.map((s) => {
        const p = toFaceAxes(unpackRaw(s), rec.raw.w, rec.raw.h);
        const fit = alignToCanonical(p);
        return p.map(fit.apply);
      }));
      attractiveness = predictAttractiveness(researchPoints, attractivenessModel);
    } catch {
      attractivenessError = 'この採点基準では魅力の相対点を計算できませんでした。主点は未算出です。採点基準を取り込み直してください。比率の点数は参考として確認できます。';
    }
  }
  let spread = null;
  if (shotPoints && shotPoints.length > 1) {
    const totals = shotPoints.map((p) => analyze(p, rec.hairline).score.total);
    spread = (Math.max(...totals) - Math.min(...totals)) / 2;
  }
  const result = {
    ...a,
    points,
    calibrated,
    spread,
    hair: rankHair(a.measures, a.shape, a.score),
    glasses: rankGlasses(a.measures, a.shape),
    size: frameSize(a.measures),
    // 古い未補正の記録を、新しい較正済み記録と同じ魅力の点数にはしない。
    attractiveness,
    attractivenessError,
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

function gauge(total, label = 'TOTAL / 100') {
  const r = 54, c = 2 * Math.PI * r, arc = c * 0.75;
  const val = arc * Math.max(0, Math.min(100, total)) / 100;
  const [int, dec] = one(total).split('.');
  return `<div class="gauge">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="track" cx="60" cy="60" r="${r}" stroke-dasharray="${arc} ${c}"/>
      <circle class="bar" cx="60" cy="60" r="${r}" stroke-dasharray="${val} ${c}" ${total >= 80 ? 'style="stroke:var(--accent)"' : ''}/>
    </svg>
    <div class="gauge-num"><div class="n">${int}<small>.${dec}</small></div><div class="of">${esc(label)}</div></div>
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
    <p>正面から3回撮って平均します。<br>写真は保存せず、どこにも送りません。</p>
    <p class="small">日本人男性の魅力相対点は、評価付きの基準を準備中です。基準が整うまでは主点を出さず、比率の測定結果を参考として表示します。</p>
    <button class="btn" type="button" data-act="shoot">測定をはじめる</button>
    ${Object.keys(store.setting('focals') || {}).length ? '' : '<div style="margin-top:12px"><button class="btn ghost" type="button" data-act="calib">先にカメラを較正する（約30秒）</button></div>'}
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
  const attraction = r.attractiveness;
  const chips = [
    `<span class="chip strong"><b>${esc(shape.main.name)}</b>${shape.main.p < 0.6 ? '寄り' : ''}</span>`,
    second && second.p >= 0.15 ? `<span class="chip">${esc(second.name)} ${Math.round(second.p * 100)}%</span>` : '',
    r.spread != null ? `<span class="chip">ぶれ ±${one(r.spread)}</span>` : '',
    `<span class="chip">生え際 ${m.thirds.hairlineSet ? '指定' : '推定'}</span>`,
    r.calibrated == null ? '<span class="chip">比率の遠近補正なし（v0.1 の記録）</span>'
      : r.calibrated ? '<span class="chip">比率の遠近補正 較正済み</span>'
        : '<button class="chip warn" type="button" data-act="calib">比率の遠近補正 未較正 ›</button>',
  ].join('');

  view.innerHTML = `
    ${latest ? '' : '<a class="chip" href="#history" style="display:inline-block;margin:2px 0 8px">← 記録へ戻る</a>'}
    <section class="hero fade-in">
      <div class="hero-date">${dateText(rec.at)}</div>
      <div class="small">${metricLabel()}</div>
      ${attraction ? gauge(attraction.percentile, 'RELATIVE / 100') : '<h1>未算出</h1>'}
      <div class="chips">${chips}</div>
      ${attraction ? `<p class="small">基準：${esc(attraction.cohort)}。日本人男性の評価データを学んだ、顔の形状からの推定です。50点が校正用${attraction.referenceImages}画像の真ん中。一般の日本人男性全体での順位は未検証です。学習写真と同じく遠近補正前の形状を使うため、撮影距離の影響は残ります。${attraction.outsideReference ? ' 今回は基準分布の範囲外です。' : ''}</p>` : r.attractivenessError ? `<p class="small" role="alert">${esc(r.attractivenessError)}</p>` : attractivenessModel ? '<p class="small">この古い記録には元の点がないため、魅力の相対点には換算していません。比率の点数は参考として確認できます。</p>' : '<p class="small">日本人男性の評価付き基準が未整備のため、主点は出していません。比率の点数は参考として確認できます。</p>'}
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
    <div class="card small">参考：比率スコア <b>${one(r.score.total)}</b> / 100。下の5項目は比率の内訳で、魅力の相対点とは別の指標です。</div>
    <div class="label">Portrait</div>
    <div class="card portrait">
      ${portraitSVG(r.points, m, ui.portrait)}
      <div class="portrait-tools"><div class="seg mini">${modes.map(([k, t]) =>
        `<button type="button" class="${ui.portrait === k ? 'on' : ''}" data-portrait="${k}">${t}</button>`).join('')}</div></div>
    </div>
    <div class="label">Breakdown</div>
    <div class="items">${items}</div>
    <p class="small" style="margin-top:14px">左右対称・縦のバランスは「左右がそろう・縦3等分」との差、横のバランス・パーツの配置・輪郭は「平均顔（東アジア人男性の顔画像 204 枚を同じ方法で測った平均）との近さ」で採点しています。およそ 50 点が基準データの中央値になるのは、横・パーツ・輪郭の3項目です。総合点の中央値は 50 点ではなく、日本人全体の順位や魅力そのものを表す点数でもありません。</p>
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
      <p class="small" style="margin:6px 0 0">形の相性は美容室・メガネ店で定番の考え方にもとづく目安です。顔の形の判定は平均顔のデータにもとづきます。</p>
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
  const rows = recs.map((rec) => { const r = evaluate(rec); return { rec, r, value: displayedScore(r) }; });
  const totals = rows.map((x) => x.value).filter(Number.isFinite);
  const best = totals.length ? Math.max(...totals) : null;
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const num = (v) => v == null ? '—' : one(v);
  const chrono = rows.filter((x) => x.value != null).slice(0, 30).reverse().map((x) => ({ at: x.rec.at, total: x.value }));
  view.innerHTML = `
    <div class="fade-in">
      <div class="label" style="margin-top:8px">Summary</div>
      <p class="small">${metricLabel()}。比率スコアは主点の集計に含みません。${attractivenessModel ? '元の点がない古い記録も集計に含みません。' : '日本人男性の評価付き基準が未整備のため、主点は未算出です。'}</p>
      <div class="stats">
        <div><b>${num(rows[0].value)}</b><span>最新</span></div>
        <div><b>${num(best)}</b><span>最高</span></div>
        <div><b>${num(avg)}</b><span>平均</span></div>
        <div><b>${recs.length}</b><span>回数</span></div>
      </div>
      ${chrono.length ? `<div class="card chart">${chartSVG(chrono)}</div>` : `<p class="small">${attractivenessModel ? '主点を計算できる記録がありません。元の点がある記録を使って計算します。' : '日本人男性の評価付き基準を準備中です。基準が整うまで主点のグラフは表示しません。'}</p>`}
      <div class="label">History</div>
      <div class="list">${rows.map(({ rec, r, value }, i) => {
        const prev = rows[i + 1];
        const d = prev?.value != null && value != null ? value - prev.value : null;
        return `<a class="row" href="#r/${encodeURIComponent(rec.id)}">
          <div><div class="row-date">${dateText(rec.at)}</div><div class="row-sub">${esc(r.shape.main.name)}・生え際${r.measures.thirds.hairlineSet ? '指定' : '推定'}・参考比率 ${one(r.score.total)}</div></div>
          <div class="row-delta${d != null && d > 0 ? ' up' : ''}">${d == null ? '' : `${d >= 0 ? '+' : ''}${one(d)}`}</div>
          <div class="row-score">${num(value)}</div>
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
  if (act === 'calib') openCalibSheet();
  if (act === 'allHair') { ui.allHair = true; rerenderTab(); }
  if (act === 'export') exportData();
  if (act === 'clear') confirmSheet('すべての記録を削除しますか？', '元に戻せません。必要なら先に書き出してください。', '削除する', () => {
    if (!store.clear()) { toast('削除を保存できませんでした。記録は残っています'); return; }
    memo.clear(); route(); toast('削除しました');
  });
  if (act === 'delete') confirmSheet('この記録を削除しますか？', '元に戻せません。', '削除する', () => {
    if (!store.remove(t.dataset.id)) { toast('削除を保存できませんでした。記録は残っています'); return; }
    memo.delete(t.dataset.id); location.hash = '#history'; toast('削除しました');
  });
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
  el.setAttribute('role', 'status');
  document.body.append(el);
  setTimeout(() => el.remove(), 2200);
}

$('#infoBtn').addEventListener('click', () => openSheet(`
  <h2 id="sheetTitle">FACE SCORE について</h2>
  <p>日本人男性を基準に、自分の顔の魅力を相対点で見るための個人用アプリです。評価付きの日本人男性基準は準備中です。基準が整うまでは主点を出さず、顔の比率や似合う髪型・メガネを参考として表示します。</p>
  <h3>参考：比率スコアの出し方</h3>
  <ul>
    <li>顔の478点の位置をスマホの中で検出し、顔の向きを正面にそろえてから測ります。</li>
    <li>左右対称 30%、縦のバランス 20%、横のバランス 20%、パーツの配置 15%、輪郭 15% の重みで総合点にします。</li>
    <li>左右対称・縦のバランスは「左右がそろう・縦3等分」との差で採点します。</li>
    <li>横のバランス・パーツの配置・輪郭は「平均顔との近さ」で採点します。平均顔は、公開データ FairFace（CC BY 4.0）の東アジア人男性 20〜39歳・正面・無表情の顔画像 204 枚を、このアプリと同じ方法で測った平均です。この3項目の中央値がおよそ 50 点になる目盛りで、手加減はしていません。総合点の中央値を 50 点にする目盛りではなく、日本人全体での順位も表していません。</li>
    <li>比率の点数であり、魅力そのものや人としての価値の評価ではありません。</li>
  </ul>
  <h3>日本人男性の魅力相対点</h3>
  <p>学習・校正・検証それぞれの集団が日本人男性と出典で確認できる、評価付きの採点基準だけを受け付けます。アジア男性という区分だけの基準は使いません。基準をこの端末へ取り込むと、顔の形状から人の平均評価を予測します。一般の日本人男性全体の順位や、肌・髪を含む印象は未検証です。学習写真と同じ遠近補正前の形状で計算するため、撮影距離による影響は残ります。カメラの較正は参考の比率スコア側に適用されます。</p>
  ${attractivenessModel ? `<p class="small">現在の基準：${esc(attractivenessModel.cohort.label)}<br>校正用${attractivenessModel.reference.values.length}画像内の順位。${attractivenessModel.evaluation?.model?.pearson_r != null ? `独立テストとの相関 ${Number(attractivenessModel.evaluation.model.pearson_r).toFixed(2)}（正解率ではありません）。` : ''}</p>` : '<p class="small">日本人男性の評価付き基準が未整備のため、主点は未算出です。比率スコアは参考として表示しています。</p>'}
  <div class="actions"><button class="btn ghost block" type="button" id="importAttractiveness">研究用の採点基準を取り込む</button>
  ${attractivenessModel ? '<button class="btn ghost block" type="button" id="removeAttractiveness">採点基準を解除する</button>' : ''}</div>
  <input id="attractivenessFile" type="file" accept=".json,application/json" hidden>
  <p class="small">ファイルはこの端末の中で読み込みます。写真や採点基準を外部へ送信しません。</p>
  <h3>精度について</h3>
  <ul>
    <li>角度・照明・表情・前髪で数値は少し変わります。3回撮って平均し、そのぶれ幅を「ぶれ」に表示しています。</li>
    <li>生え際は顔の点に含まれないため、撮影後に自分で合わせます。合わせないときは推定値を使い、縦のバランスは中と下だけで採点します。</li>
    <li>メガネのサイズは黒目の大きさ（平均 11.7mm）から推定した目安です。</li>
    <li>近くから撮ったときの遠近の歪み（鼻が大きく・輪郭が細く写る）は、顔の点の奥行きとカメラの画角から取り除いています。画角は端末ごとに、Face ID の登録のように顔を上下左右に回して較正します。較正し直すと、過去の記録も新しい値で計算し直します。</li>
  </ul>
  <div class="actions" style="margin-top:10px"><button class="btn ghost block" type="button" id="infoCalib">カメラを較正する（遠近の補正）</button></div>
  <h3>データ</h3>
  <ul>
    <li>写真は保存せず、どこにも送りません。保存するのは顔の点の座標と点数のもとになる数値だけで、この端末の中にあります。</li>
    <li>顔の検出には Google の MediaPipe（Apache-2.0）をアプリに同梱して使っています。利用状況の送信もアプリ側で止めています。</li>
  </ul>
  <p class="small" style="margin-top:18px">バージョン ${VERSION}・3枚×${CAPTURE.framesPerShot}フレームの平均</p>
`));
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'infoCalib') { closeSheet(); openCalibSheet(); } });
sheet.addEventListener('click', (e) => {
  if (e.target.id === 'importAttractiveness') $('#attractivenessFile').click();
  if (e.target.id === 'removeAttractiveness') {
    if (!store.setSetting('attractivenessModel', null)) { toast('表示の設定を保存できませんでした'); return; }
    attractivenessModel = null; memo.clear(); closeSheet(); route(); toast('採点基準を解除しました。主点は未算出です');
  }
});
sheet.addEventListener('change', async (e) => {
  if (e.target.id !== 'attractivenessFile' || !e.target.files[0]) return;
  try {
    const file = e.target.files[0];
    if (file.size > 1024 * 1024) throw new Error('採点基準のファイルが大きすぎます');
    const model = validateJapaneseMaleModel(JSON.parse(await file.text()));
    if (!store.setSetting('attractivenessModel', model)) throw new Error('保存できませんでした。端末の保存領域を確認してください');
    attractivenessModel = model; memo.clear(); closeSheet(); route(); toast('研究用の採点基準を取り込みました');
  } catch (err) { toast(err.message || '採点基準を読み込めませんでした'); }
  finally { e.target.value = ''; }
});

// ---------- 撮影 ----------
const cap = {
  el: $('#capture'), video: $('#camVideo'), canvas: $('#camCanvas'), status: $('#capStatus'),
  ring: $('#guideRing'), dots: [...$('#capShots').children], flash: $('#capFlash'), hint: $('.cap-hint'), session: null, controller: null, onCancel: null,
};

const HINT = '明るい場所で、メガネを外し、おでこを出すと正確に測れます';

// 撮影画面を開く。options.onDone を渡さなければ、ふつうの測定（生え際の調整へ進む）
async function openCapture(options = {}) {
  if (cap.controller) return;
  const controller = new AbortController();
  cap.controller = controller;
  const { onDone = openHairline, onCancel = null, hint = HINT, capOpts = {} } = options;
  cap.el.hidden = false;
  document.body.style.overflow = 'hidden';
  cap.dots.forEach((d) => d.classList.remove('on'));
  cap.ring.style.strokeDasharray = '0 100';
  cap.status.textContent = 'カメラを準備しています';
  cap.status.classList.remove('ok');
  cap.hint.textContent = hint;
  cap.onCancel = onCancel;
  // 撮影の点（3つ）は、ふつうの測定のときだけ出す
  cap.dots[0].parentElement.hidden = capOpts.mode === 'turn-scan';
  const session = await startCapture({
    video: cap.video,
    canvas: cap.canvas,
    signal: controller.signal,
    opts: { focalFor, ...capOpts },
    onStatus: (s) => {
      if (controller.signal.aborted) return;
      if (DEV && DEV.log.length > 600) DEV.log.splice(0, 200);
      if (DEV) DEV.log.push({ t: Math.round(performance.now()), code: s.code, a: s.angles && Object.fromEntries(Object.entries(s.angles).map(([k, v]) => [k, Math.round(v * 10) / 10])),
        d: s.distance && Math.round(s.distance), m: s.motion && Math.round(s.motion * 10000) / 10000, l: s.luma && Math.round(s.luma) });
      cap.status.textContent = s.text;
      cap.status.classList.toggle('ok', s.code === 'hold');
    },
    onProgress: (done, frac, total = CAPTURE.shots) => {
      if (controller.signal.aborted) return;
      const p = ((done + frac) / total) * 100;
      cap.ring.style.strokeDasharray = `${p.toFixed(1)} 100`;
    },
    onShot: (n) => {
      if (controller.signal.aborted) return;
      cap.dots.forEach((d, i) => d.classList.toggle('on', i < n));
      cap.flash.classList.remove('go'); void cap.flash.offsetWidth; cap.flash.classList.add('go');
    },
    onDone: (res) => {
      if (controller.signal.aborted) return;
      if (DEV && res.raw) DEV.send('capture', { mode: capOpts.mode || 'measure', log: DEV.log.splice(0), video: [res.raw.w, res.raw.h], focal: res.raw.focal, zScale: res.raw.zScale, calibrated: res.raw.calibrated, distance: res.snapshot.distance, faceWidth: res.faceWidth, raw: res.raw.shots });
      if (DEV && res.turn) DEV.send('turn-scan', { log: DEV.log.splice(0), ...res.turn });
      cap.onCancel = null;
      closeCapture(); onDone(res);
    },
    onError: (err) => {
      if (controller.signal.aborted) return;
      if (DEV) DEV.send('error', { code: err.code, error: String(err.error), log: DEV.log.splice(0) });
      cap.onCancel = null;
      closeCapture(); toast(err.text); console.warn(err.error);
      onCancel?.();
    },
  });
  if (controller.signal.aborted || cap.controller !== controller) { session?.stop(); return; }
  cap.session = session;
}

function closeCapture() {
  const controller = cap.controller;
  cap.controller = null;
  controller?.abort();
  cap.session?.stop();
  cap.session = null;
  cap.el.hidden = true;
  document.body.style.overflow = '';
}

$('#capClose').addEventListener('click', () => { const c = cap.onCancel; cap.onCancel = null; closeCapture(); c?.(); });
$('#shootBtn').addEventListener('click', () => openCapture());

// 1回撮って結果を返す（較正用）。やめたら null
const captureOnce = (hint, capOpts) => new Promise((resolve) => openCapture({ hint, capOpts, onDone: resolve, onCancel: () => resolve(null) }));

// ---------- カメラの較正（顔を回すスキャン） ----------
function openCalibSheet() {
  const cams = Object.entries(store.setting('focals') || {});
  openSheet(`<h2 id="sheetTitle">遠近の補正（カメラの較正）</h2>
    <p>顔に近いカメラで撮ると、鼻が大きく・輪郭が細く写ります。FACE SCORE は顔の点の奥行きを使ってこの歪みを取り除きますが、そのためにカメラの画角を知る必要があります。</p>
    <p>Face ID の登録のように、顔を<b>正面・左右・上下</b>へゆっくり回します。横を向くと近い側の頬は大きく・遠い側は小さく写るので、どの向きから正面に戻しても同じ形になる画角を計算で求めます（メジャーは不要）。端末ごとに1回だけ行います。</p>
    <ul><li>ふだん測るときと同じ距離で構える（スマホなら腕を軽く伸ばす）</li><li>案内に合わせて、正面 → 横 → 反対の横 → 上か下 → 反対 の順に向く</li><li>口を閉じ、目を開けたまま、首だけをゆっくり回す</li></ul>
    <p class="small">Face ID の奥行きセンサーはブラウザからは使えないため、ふつうのカメラの映像から計算します。</p>
    ${cams.length ? `<p class="small">較正済み：${cams.map(([k, v]) => `${esc(k)}（水平 ${Math.round(fovDegrees(v.focal, ...k.split('x').map(Number)).h)}°・${esc(String(v.at || '').slice(0, 10))}）`).join('、')}</p>` : ''}
    <div class="actions" style="margin-top:18px"><button class="btn block" type="button" id="calibStart">較正をはじめる</button>
    <button class="btn ghost block" type="button" data-close>あとで</button></div>`);
  $('#calibStart').addEventListener('click', () => { closeSheet(); runCalibration(); }, { once: true });
}

// Face ID の登録のように顔を上下左右に回して、カメラの画角と奥行きの倍率を求める
async function runCalibration() {
  const res0 = await captureOnce('ふだん測るときと同じ距離で構え、案内に合わせてゆっくり顔を回してください', {
    mode: 'turn-scan', minFaceWidth: 0.22, maxFaceWidth: 0.85,
  });
  if (!res0) return;
  const { w, h, views } = res0.turn;
  toast('計算しています…');
  await new Promise((r) => setTimeout(r, 50));
  const res = solveFocalFromTurns(views, w, h);
  if (DEV) DEV.send('calib', { method: 'turn-scan', w, h, ...res, angles: res0.turn.angles });
  if (res.atEdge || res.sharp < 1.04) { toast('うまく求められませんでした。もう少し大きく顔を回して、やり直してください'); return; }
  // 同じカメラで較正し直したときは、これまでの結果と平均してぶれを減らす（直近5回ぶんの重み）
  const focals = { ...(store.setting('focals') || {}) };
  const key = camKey(w, h), old = focals[key];
  const n = old ? Math.min(old.n || 1, 4) : 0;
  const gmean = (a, b) => Math.exp((n * Math.log(a) + Math.log(b)) / (n + 1));
  const fe = old ? gmean(old.focal / (old.zScale || 1), res.fe) : res.fe;
  const zs = old ? gmean(old.zScale || 1, res.zScale) : res.zScale;
  focals[key] = { focal: Math.round(fe * zs), zScale: Math.round(zs * 1000) / 1000, n: n + 1, sharp: Math.round(res.sharp * 100) / 100, at: new Date().toISOString() };
  if (!store.setSetting('focals', focals)) {
    toast('較正結果を保存できませんでした。記録を書き出して、端末の保存領域を確認してください');
    return;
  }
  memo.clear();
  route();
  toast(`較正しました（${n + 1}回分の平均・水平の画角 約${Math.round(fovDegrees(fe * zs, w, h).h)}°）`);
}

// ---------- 生え際の調整 ----------
function openHairline({ points, shots, snapshot, raw }) {
  const { canvas: snap, landmarks: lm, corrected: lmc, fit, width: w, height: h, scaleAt } = snapshot;
  // 正面の座標は遠近を補正した点から求めている。画面（元の画像）との行き来は額の点（10番）の補正倍率で行う
  const fp = toFaceAxes(lmc, w, h).map(fit.apply);
  const s10 = scaleAt(lmc[10].z); // lmc の z は較正の倍率をかけたもの
  const toCorrected = (ix, iy) => [w / 2 + (ix - w / 2) * s10, h / 2 + (iy - h / 2) * s10];
  const toOriginal = (cx_, cy_) => [w / 2 + (cx_ - w / 2) / s10, h / 2 + (cy_ - h / 2) / s10];
  const saved = store.setting('hairlineK');
  const k0 = Number.isFinite(saved) ? saved : 1;

  // 顔の縦軸（あご先→額）を画像上で求める
  const px = (i) => [lm[i].x * w, lm[i].y * h];
  const p10 = px(10), p152 = px(152);
  let ux = p10[0] - p152[0], uy = p10[1] - p152[1];
  const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
  const z10 = -lmc[10].z * w;

  // 正面座標の y ⇔ 画像上の軸上の位置 t
  const yToT = (yF) => {
    const a = fit.invert([fp[10][0], yF, fp[10][2]]);
    const [ix, iy] = toOriginal(a[0], -a[1]);
    return (ix - p10[0]) * ux + (iy - p10[1]) * uy;
  };
  const tToY = (t) => {
    const [qx, qy] = toCorrected(p10[0] + ux * t, p10[1] + uy * t);
    return fit.apply([qx, -qy, z10])[1];
  };

  // 最初の線の位置：肌と髪の色の切り替わりから自動で推定 → だめなら前回の位置 → だめなら比率の推定
  let auto = null;
  try { auto = detectHairline(snap, lm, w, h); } catch (e) { auto = null; }
  const startLabel = auto != null ? '自動で推定した位置' : Number.isFinite(saved) ? '前回の位置' : '推定の位置';

  const el = document.createElement('section');
  el.className = 'hairline';
  el.innerHTML = `
    <div class="hairline-head">
      <h2>生え際の位置</h2>
      <p>線が髪の生え始めに合っているか確かめて、ずれていれば動かしてください</p>
    </div>
    <div class="hairline-stage" id="hlStage">
      <canvas id="hlCanvas"></canvas>
      <div class="hairline-line" id="hlLine"><span class="tag">${startLabel}</span><span class="knob">${icon.updown}</span></div>
      <div class="nudge">
        <button class="icon-btn glass" type="button" data-nudge="1" aria-label="少し上へ"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg></button>
        <button class="icon-btn glass" type="button" data-nudge="-1" aria-label="少し下へ"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
      </div>
    </div>
    <div class="hairline-foot">
      <p id="hlError" role="alert" class="small" hidden></p>
      <button class="btn block" type="button" id="hlOk">この位置で決定</button>
      <button class="btn ghost block" type="button" id="hlSkip">見えない・わからない（推定で測る）</button>
      <button class="btn ghost block" type="button" id="hlCancel">今回の測定をやめる</button>
    </div>`;
  document.body.append(el);

  const stage = $('#hlStage', el), cv = $('#hlCanvas', el), line = $('#hlLine', el);
  const faceH = Math.hypot(p10[0] - p152[0], p10[1] - p152[1]);
  const cx = (lm[234].x + lm[454].x) / 2 * w;
  let crop;
  // 自動推定は、本人がこれまでに線を直した量（平均）だけ寄せる。直すたびに学ぶ
  const bias = Number(store.setting('hairlineAutoBiasK')) || 0;
  const autoK = auto != null ? hairlineK(fp, tToY(auto)) : null;
  let t = autoK != null ? yToT(hairlineY(fp, autoK + bias)) : yToT(hairlineY(fp, k0));

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
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-nudge]')) return;
    stage.setPointerCapture(e.pointerId); drag(e);
  });
  stage.addEventListener('pointermove', (e) => { if (stage.hasPointerCapture(e.pointerId)) drag(e); });
  el.querySelectorAll('[data-nudge]').forEach((b) => b.addEventListener('click', () => {
    t = Math.max(-faceH * 0.15, Math.min(faceH * 0.8, t + Number(b.dataset.nudge) * faceH * 0.005));
    place();
  }));
  requestAnimationFrame(layout);
  window.addEventListener('resize', layout);

  const dispose = () => {
    window.removeEventListener('resize', layout);
    el.remove();
    snap.width = 0; snap.height = 0; // 撮影した画像を破棄
  };
  const finish = (hairline) => {
    const rec = store.add({ points, shots, hairline, version: VERSION, raw });
    if (!rec) {
      const error = $('#hlError', el);
      error.textContent = '保存できませんでした。今回の測定はこの画面に残っています。端末の保存領域を確認して再試行するか、「今回の測定をやめる」で戻って記録を書き出してください。既存の記録は変更していません。';
      error.hidden = false;
      return;
    }
    let settingsSaved = true;
    if (hairline.source === 'manual') {
      const settings = { hairlineK: hairline.k };
      if (autoK != null) {
        const n = Number(store.setting('hairlineAutoBiasN')) || 0;
        settings.hairlineAutoBiasK = (bias * n + (hairline.k - autoK)) / (n + 1);
        settings.hairlineAutoBiasN = Math.min(n + 1, 8);
      }
      settingsSaved = store.setSettings(settings);
    }
    dispose();
    if (DEV) {
      const r = evaluate(rec);
      DEV.send('result', { rec, total: r.score.total, items: Object.fromEntries(Object.entries(r.score.items).map(([k, v]) => [k, { score: v.score, notes: v.notes }])),
        shape: r.shape.ranked, measures: r.measures, hair: r.hair.slice(0, 5).map((h) => [h.name, h.score]), glasses: r.glasses.map((g) => [g.name, g.score]), size: r.size, spread: r.spread });
    }
    ui.tab = 'score'; ui.open.clear();
    if (location.hash === '#result' || !location.hash) route(); else location.hash = '#result';
    toast(settingsSaved ? '測定しました' : '測定は保存しました。生え際の学習設定は保存できませんでした');
  };
  $('#hlOk', el).addEventListener('click', () => {
    const k = hairlineK(fp, tToY(t));
    if (DEV) DEV.send('hairline', { autoK, bias, finalK: k, savedK: saved ?? null, faceH });
    finish({ source: 'manual', k, auto: auto != null });
  });
  $('#hlSkip', el).addEventListener('click', () => finish({ source: 'estimated', k: 1 }));
  $('#hlCancel', el).addEventListener('click', dispose);
}

// ---------- 起動 ----------
window.addEventListener('hashchange', route);
route();

// 顔の検出を手が空いたときに先に準備しておく（測定ボタンを押してからの待ち時間を減らす）
const warmUp = () => loadLandmarker().catch(() => {});
if ('requestIdleCallback' in window) requestIdleCallback(warmUp, { timeout: 4000 }); else setTimeout(warmUp, 1500);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (DEV) window.__faceScore = { store, evaluate, openHairline, route, browLineY, dev: DEV };
