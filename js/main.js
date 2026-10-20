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
import { researchScore, percentileInterval, percentile, levelOf, LEVEL_WORDS, elementImpacts, elementSensitivity, totalWithFeatures } from './research-score.js';
import { parseExport, IMPORT_LIMITS } from './import.js';
import { cameraForRecord } from './record-camera.js';
import { openTryOn } from './tryon.js';
import { renderProduct, disposeProductRenderer } from './eyewear-3d.js';
import { REFERENCE as RESEARCH_REF } from './research-reference.js';

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

const ui = { tab: 'score', portrait: 'thirds', eyewear: 'glasses', open: new Set(), allHair: false, allGlasses: false, historyOpen: false };
let productGeneration = 0;
async function hydrateFrameImages() {
  const generation = ++productGeneration;
  const images = [...view.querySelectorAll('img[data-frame]')];
  try {
    for (const img of images) {
      if (generation !== productGeneration || !img.isConnected) return;
      try {
        const url = await renderProduct(img.dataset.frame);
        if (generation !== productGeneration || !img.isConnected) return;
        img.src = url; img.hidden = false; img.nextElementSibling.hidden = true;
      } catch { if (img.isConnected) img.nextElementSibling.textContent = 'このブラウザでは3D見本を表示できません'; }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } finally { disposeProductRenderer(); }
}
let attractivenessModel = null;
try { attractivenessModel = validateJapaneseMaleModel(store.setting('attractivenessModel')); } catch { /* 日本人男性の基準がなければ主点は未算出 */ }
// 主点：日本人男性の評価付きモデルを取り込んでいればそれ、なければ研究の知見による相対点（2026-10-19 本人の決定）
const displayedScore = (r) => attractivenessModel ? r.attractiveness?.percentile ?? null : r.research?.total ?? null;
const metricLabel = () => (attractivenessModel ? '日本人男性の魅力相対点' : `研究の知見による相対点（日本人男性・基準 ${RESEARCH_REF.n} 人内）`);

// ---------- カメラの焦点距離（端末と解像度ごと。較正していなければ想定値） ----------
const camKey = (w, h) => `${Math.max(w, h)}x${Math.min(w, h)}`;
function focalFor(w, h) {
  const cal = (store.setting('focals') || {})[camKey(w, h)];
  return cal ? { focal: cal.focal, zScale: cal.zScale || 1, calibrated: true } : { focal: CAMERA.focalRatio * Math.max(w, h), zScale: 1, calibrated: false };
}

// この端末で測った記録の較正の回数（読み込んだ記録は元の端末の値なので数えない）
function calibCount(rec) {
  if (!rec.raw || rec.imported) return null;
  return (store.setting('focals') || {})[camKey(rec.raw.w, rec.raw.h)]?.n ?? null;
}

// ---------- 計算（記録ごとに一度だけ） ----------
const memo = new Map();
let memoRevision = store.revision();
function evaluate(rec) {
  if (memoRevision !== store.revision()) { memo.clear(); memoRevision = store.revision(); }
  if (memo.has(rec.id)) return memo.get(rec.id);
  // v0.2.0 以降の記録は生の点から、いまの焦点距離で遠近を補正し直す
  let points = rec.points, shotPoints = rec.shots, calibrated = null;
  if (rec.raw) {
    // 他の端末から読み込んだ記録は、書き出した時点のその端末の較正値で計算する（この端末の較正は別のカメラのもの）
    const cam = cameraForRecord(rec, focalFor(rec.raw.w, rec.raw.h));
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
  // 研究の知見による相対点：遠近を補正した点で、日本人男性の基準集団の中の順位にする（元の点がない v0.1 の記録は出さない）
  let research = null;
  if (rec.raw) {
    try {
      const lm0 = unpackRaw(rec.raw.shots[0]);
      const facePx = Math.hypot((lm0[454].x - lm0[234].x) * rec.raw.w, (lm0[454].y - lm0[234].y) * rec.raw.h);
      const cov = { yaw: 0, pitch: 0, smile: 0, facePx };
      research = researchScore(points, RESEARCH_REF, cov);
      let se = 0;
      if (shotPoints && shotPoints.length > 1) {
        const shots = shotPoints.map((p) => researchScore(p, RESEARCH_REF, cov));
        const ts = shots.map((s) => s.total);
        research.spread = (Math.max(...ts) - Math.min(...ts)) / 2;
        // 平均した点の測定の揺れ＝撮影ごとの合成値の標準偏差÷√枚数
        const cs = shots.map((s) => s.composite), cm = cs.reduce((a, b) => a + b, 0) / cs.length;
        se = Math.sqrt(cs.reduce((a, b) => a + (b - cm) ** 2, 0) / (cs.length - 1)) / Math.sqrt(cs.length);
      }
      // 基準の人数と測定の揺れからの参考範囲。推定SEなので90%被覆は保証しない。
      research.interval = percentileInterval(RESEARCH_REF.compositeSorted, research.composite, se);
    } catch { research = null; }
  }
  const result = {
    ...a,
    points,
    calibrated,
    spread,
    research,
    hair: rankHair(a.measures, a.shape, a.score, research?.features),
    glasses: rankGlasses(a.measures, a.shape, research?.features),
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

function gauge(total, label = 'TOTAL / 100', range = null) {
  const r = 54, c = 2 * Math.PI * r, arc = c * 0.75;
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const val = arc * clamp(total) / 100;
  // 誤差の範囲（下限〜上限）を太い薄い帯で重ねる
  const band = range ? `<circle class="range" cx="60" cy="60" r="${r}" stroke-dasharray="${(arc * (clamp(range[1]) - clamp(range[0])) / 100).toFixed(2)} ${c}" stroke-dashoffset="${(-arc * clamp(range[0]) / 100).toFixed(2)}"/>` : '';
  const [int, dec] = one(total).split('.');
  return `<div class="gauge">
    <svg viewBox="0 0 120 120" aria-hidden="true"><g transform="rotate(135 60 60)">
      <circle class="track" cx="60" cy="60" r="${r}" stroke-dasharray="${arc} ${c}"/>
      ${band}
      <circle class="bar" cx="60" cy="60" r="${r}" stroke-dasharray="${val} ${c}" ${total >= 80 ? 'style="stroke:var(--accent)"' : ''}/>
    </g></svg>
    <div class="gauge-num"><div class="n">${int}<small>.${dec}</small></div><div class="of">${esc(label)}</div></div>
  </div>`;
}

// 10段階（基準集団を10人に1人ずつに分けた位置）。参考範囲にあたる段階も薄く示す
function levelBlock(R) {
  // 範囲は画面に出す数字（四捨五入）と同じ値で段階にする
  const lv = levelOf(R.total), lo = levelOf(Math.round(R.interval[0])), hi = levelOf(Math.round(R.interval[1]));
  const cells = Array.from({ length: 10 }, (_, i) => {
    const n = i + 1;
    return `<i class="${n === lv ? 'on' : n >= lo && n <= hi ? 'near' : ''}"></i>`;
  }).join('');
  return `<div class="level" role="img" aria-label="10段階で${lv}（参考範囲では${lo}〜${hi}）">
      <div class="level-head"><span class="level-n">${lv}</span><span class="level-of">/ 10</span><span class="level-word">${LEVEL_WORDS[lv]}</span></div>
      <div class="level-bar">${cells}</div>
      <div class="level-note">参考範囲：${lo === hi ? `${lo}段階` : `${lo}〜${hi}段階`}</div>
    </div>`;
}

// 直近の平均：この記録までの、元の点がある記録（新しい順に最大5回）の合成値を平均して、基準の中の順位にする。
// 本人の29回の記録の解析（2026-10-20）では、1回ごとの点数の標準偏差は約12点、直近5回の平均では約5点だった（主に目の開きの揺れ）。
function recentAverage(rec) {
  const evs = store.records().filter((x) => x.raw && x.at <= rec.at).slice(0, 5).map((x) => evaluate(x).research).filter(Boolean);
  const n = evs.length;
  if (n < 2) return { n };
  const cs = evs.map((e) => e.composite), m = cs.reduce((a, b) => a + b, 0) / n;
  const sdc = Math.sqrt(cs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  const ts = evs.map((e) => e.total), tm = ts.reduce((a, b) => a + b, 0) / n;
  return { n, total: percentile(RESEARCH_REF.compositeSorted, m), interval: percentileInterval(RESEARCH_REF.compositeSorted, m, sdc / Math.sqrt(n)),
    perRecordSd: Math.sqrt(ts.reduce((a, b) => a + (b - tm) ** 2, 0) / (n - 1)) };
}
// この回の目の縦の開きと、本人のいつもの開き（この記録までの最大20回の中央値）の比較（v0.12）。
// 本人の記録の解析（2026-10-20、目の状態つき26回）では、記録どうしの点数の揺れの大部分が目の縦の開きで、
// 撮影中に目を細める度合いとの相関は −0.97。いつもの開きにそろえると、1回ごとの標準偏差は5.2点→3.2点になった。
function eyeNote(rec, R) {
  const evs = store.records().filter((x) => x.raw && x.at <= rec.at).slice(0, 20).map((x) => evaluate(x).research).filter(Boolean);
  if (evs.length < 5 || !R?.features) return '';
  const vals = evs.map((e) => e.features.eyeOpen).sort((a, b) => a - b), n = vals.length;
  const usual = n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2;
  const std = totalWithFeatures(R, RESEARCH_REF, { eyeOpen: usual }), d = std - R.total;
  if (Math.abs(d) < 2) return `<p class="recent-eye">この回の目の縦の開きは、いつもどおりでした（あなたの最近${n}回の真ん中くらい）。</p>`;
  return `<p class="recent-eye">この回は目が<b>いつもより${d > 0 ? '細め' : '大きく開いていました'}</b>${d > 0 ? 'でした' : ''}。いつもの開きなら約<b>${Math.round(std)}点</b>です（目の開き方だけで${Math.round(Math.abs(d))}点動いています）。</p>`;
}
function recentBlock(rec, R) {
  if (attractivenessModel) return '';
  const a = recentAverage(rec);
  if (a.total == null) return `<div class="recent"><p>1回ごとの点数は、目の開き方などで10点前後揺れます。同じ条件で3〜5回測ると、ここに平均が出て点数が安定します。</p>${eyeNote(rec, R)}</div>`;
  const [lo, hi] = a.interval.map(Math.round);
  return `<div class="recent">
      <div class="recent-head">直近${a.n}回の平均 <b>${Math.round(a.total)}</b><span>点</span>　10段階で <b>${levelOf(a.total)}</b></div>
      <p>1回ごとの点数は、目の開き方などで揺れます（いまの記録では1回ごとに ±${Math.round(a.perRecordSd)} 点ほど）。${a.n}回の平均の方が確かな目安です。参考範囲 ${lo}〜${hi} 点。${a.n < 5 ? `あと${5 - a.n}回測ると、さらに安定します。` : ''}</p>
      ${eyeNote(rec, R)}
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
    <p>鏡に向かうような正面顔を3回撮って平均します。<br>写真は保存せず、どこにも送りません。</p>
    <p class="small">日本人の評価者が好む部位の特徴と顔の形、研究で魅力との関係が確かめられた要素（平均顔への近さ・男らしさのバランス）を合わせ、著名人・スポーツ選手中心の基準 ${RESEARCH_REF.n} 人の中の順位（50点が真ん中）と10段階で出します。日本人男性全体の順位ではありません。</p>
    <button class="btn" type="button" data-act="shoot">測定をはじめる</button>
    <ul class="tips">
      <li><span>01</span>明るい場所で、顔に影ができないように</li>
      <li><span>02</span>メガネを外し、前髪を上げておでこを出す</li>
      <li><span>03</span>カメラのレンズを目の高さ・顔から40cmくらいに合わせ、顔の輪郭を枠に合わせる</li>
      <li><span>04</span>口を閉じて正面を向き、画面の顔ではなくカメラのレンズを見る</li>
      <li><span>05</span>目は見開かず、普段どおりに。まばたきは自然にする</li>
    </ul>
  </section>`;
}

function renderResult(rec, { latest }) {
  if (!rec) { renderWelcome(); return; }
  const r = evaluate(rec);
  const attraction = r.attractiveness;
  const primaryResearch = attractivenessModel ? null : r.research;

  view.innerHTML = `
    ${latest ? '' : '<a class="chip" href="#history" style="display:inline-block;margin:2px 0 8px">← 記録へ戻る</a>'}
    <section class="hero fade-in">
      <div class="hero-date">${dateText(rec.at)}</div>
      <div class="small">${attractivenessModel ? '日本人男性の魅力相対点' : '研究の相対スコア'}</div>
      ${attraction ? gauge(attraction.percentile, 'RELATIVE / 100') : primaryResearch ? gauge(primaryResearch.total, 'RESEARCH / 100', primaryResearch.interval) : '<h1>未算出</h1>'}
      ${primaryResearch?.interval ? `<div class="range-text">参考範囲 <b>${Math.round(primaryResearch.interval[0])}〜${Math.round(primaryResearch.interval[1])}</b> 点<span>（推定）</span></div>${levelBlock(primaryResearch)}${recentBlock(rec, primaryResearch)}` : ''}
      ${primaryResearch ? `<p class="score-context">基準 ${RESEARCH_REF.n} 人内の目安</p>` : ''}
      ${attraction?.outsideReference ? '<p class="small" role="status">今回の値は、取り込んだ基準分布の範囲外です。</p>' : ''}
      ${r.attractivenessError ? `<p class="small" role="alert">${esc(r.attractivenessError)}</p>` : !attraction && !primaryResearch ? `<p class="small" role="${rec.raw ? 'alert' : 'status'}">${rec.raw ? 'この記録の主点は計算できませんでした。' : 'この古い記録には元の点がないため、主点は未算出です。'}</p>` : ''}
    </section>
    <div class="seg" role="tablist" aria-label="結果の切り替え">
      ${[['score', 'スコア'], ['hair', '髪型'], ['eyewear', 'アクセサリー']].map(([k, t]) =>
        `<button type="button" role="tab" aria-selected="${ui.tab === k}" class="${ui.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('')}
    </div>
    <div id="tabBody" class="fade-in">${tabBody(rec, r)}</div>
    ${resultNotes(rec, r)}
    ${latest ? '' : `<div class="actions"><button class="btn danger block" type="button" data-act="delete" data-id="${esc(rec.id)}">この記録を削除</button></div>`}
  `;
  void hydrateFrameImages();
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
    ${attractivenessModel ? '' : researchCard(r)}
    ${attractivenessModel ? '' : effectsCard(rec, r)}
    ${attractivenessModel ? '' : scaleCard(r)}
    ${attractivenessModel ? '' : partsCard(r)}
    <h2 class="section-title">顔の形 <span>${esc(r.shape.main.name)}</span></h2>
    <div class="card portrait">
      ${portraitSVG(r.points, m, ui.portrait)}
      <div class="portrait-tools"><div class="seg mini">${modes.map(([k, t]) =>
        `<button type="button" aria-pressed="${ui.portrait === k}" class="${ui.portrait === k ? 'on' : ''}" data-portrait="${k}">${t}</button>`).join('')}</div></div>
    </div>
    <details class="ref-details">
      <summary>参考：比率スコア <b>${one(r.score.total)}</b>（主点とは別の古い指標・調整中）</summary>
    <div class="items">${items}</div>
    <p class="small" style="margin-top:14px">左右対称・縦のバランスは「左右がそろう・縦3等分」との差、横のバランス・パーツの配置・輪郭は「平均顔（東アジア人男性の顔画像 204 枚を同じ方法で測った平均）との近さ」で採点しています。およそ 50 点が基準データの中央値になるのは、横・パーツ・輪郭の3項目です。総合点の中央値は 50 点ではなく、日本人全体の順位や魅力そのものを表す点数でもありません。</p>
    </details>
  `;
}

// 10段階の目安：日本人の評価者の評定から作られた CG の顔（Nakamura & Watanabe 2020、CC0）を、このアプリで測った段階
function scaleNotes(r) {
  const R = r.research, A = RESEARCH_REF.anchors;
  if (!R || !A) return '';
  const lv = levelOf(R.total);
  const cap = { '-3': '低く評価される向き', '0': 'CGの中間設定（0 SD）', '3': '高く評価される向き' };
  const img = { '-3': 'cg-minus3', '0': 'cg-0', '3': 'cg-plus3' };
  return `
    <div class="label">Scale</div>
    <div class="card anchors">
      <div class="anchor-row">${A.map((a) => `<figure>
        <img src="img/${img[a.sd]}.jpg" width="240" height="300" alt="${cap[a.sd]}の CG の顔（実在の人ではない）" loading="lazy">
        <figcaption><b>${a.level}</b><span>${cap[a.sd]}</span></figcaption></figure>`).join('')}</div>
      <p class="small">あなたは <b>${lv}</b>。上の3つは実在の人ではなく、日本人の大学生の評定から作られた CG の顔です（早稲田大 Nakamura & Watanabe 2020。データは自由に使える CC0）。同じ顔を、魅力が下がる向き・上がる向きに動かしたもので、このアプリで測ると ${A.map((a) => a.level).join('・')} になります。中間設定の顔は日本人男性全体の中央値を表していません。このCGと公開写真では撮影条件も異なるため、目安として見てください。10段階は基準 ${RESEARCH_REF.n} 人（著名人・スポーツ選手が中心）の中の位置です。</p>
    </div>`;
}

// 部位ごとのプラス・マイナス：日本人の評価者が好む向き（Nakamura & Watanabe 2020 の「魅力」の向き）に、各部位がどれだけ寄っているか
const ELEMENT_FEATURES = { eyes: ['eyeOpen', 'eyeWidth'], brows: ['browEye'], jaw: ['jaw', 'lowerFace', 'chinH'], nose: ['nose'], lips: ['lips'] };
const FEATURE_WORDS = {
  eyeOpen: ['目の縦の開き', '大きい', '小さい'], eyeWidth: ['目の横幅', '大きい', '小さい'],
  browEye: ['眉と目の距離', '離れている', '近い'],
  jaw: ['あごの幅', '広い', '狭い'], lowerFace: ['鼻の下〜あごの長さ', '長い', '短い'], chinH: ['口〜あごの長さ', '長い', '短い'],
  nose: ['小鼻の幅', '広い', '狭い'], lips: ['唇の厚さ', '厚い', '薄い'],
};
function partsNotes(r) {
  const D = r.research?.partsDetail;
  if (!D) return '';
  const mark = (v) => (v >= 1 ? ['＋＋', 'plus'] : v >= 0.4 ? ['＋', 'plus'] : v <= -1 ? ['−−', 'minus'] : v <= -0.4 ? ['−', 'minus'] : ['±', '']);
  const eff = (w) => (w >= 0.4 ? '大' : w >= 0.1 ? '中' : '小');
  const sd = (z) => `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}`;
  const word = (k, z) => (Math.abs(z) < 0.3 ? 'ふつう' : z > 0 ? FEATURE_WORDS[k][1] : FEATURE_WORDS[k][2]);
  const rows = D.slice().sort((a, b) => b.influence - a.influence).map((p) => {
    const [m, cls] = p.influence < 0.05 ? ['・', ''] : mark(p.score);
    const lines = p.items.map((it) => {
      // 根拠：日本人の評価者（CG の顔の変化）と、中国の評価者（SCUT・撮影条件をそろえて前半・後半とも同じ向き）が同じ向きか
      const ev = RESEARCH_REF.partEvidence?.[it.key];
      const cn = ev && Math.abs(ev.rhoA) >= 0.1 && Math.abs(ev.rhoB) >= 0.1 && Math.sign(ev.rhoA) === Math.sign(ev.rhoB) ? Math.sign(ev.rhoA) : 0;
      const jp = Math.abs(it.weight) >= 0.05 ? Math.sign(it.weight) : 0;
      const side = (d) => (d > 0 ? FEATURE_WORDS[it.key][1] : FEATURE_WORDS[it.key][2]);
      const pref = !jp ? (cn ? `日本人の評価者では影響なし（中国の評価者は${side(cn)}方を好む）` : '評価への影響はほとんどない')
        : `好まれるのは${side(jp)}方（${cn === jp ? '日本人・中国の評価者とも同じ向き' : cn ? '評価者で向きが逆' : '日本人の評価者の向き。中国の評価者では差なし'}）`;
      return `${FEATURE_WORDS[it.key][0]}：平均より ${sd(it.z)} SD（${word(it.key, it.z)}）。${pref}`;
    });
    return `<div class="part">
      <div class="part-head"><span class="part-name">${esc(p.name)}<span class="item-weight">効き ${eff(p.influence)}</span></span><span class="part-mark ${cls}">${m}</span></div>
      <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
  }).join('');
  const strong = D.filter((p) => p.influence >= 0.05 && p.score >= 0.4).map((p) => p.name);
  const weak = D.filter((p) => p.influence >= 0.05 && p.score <= -0.4).map((p) => p.name);
  return `
    <div class="label">Parts</div>
    <div class="card parts">
      <p class="parts-sum">強み：<b>${strong.length ? esc(strong.join('、')) : 'とくになし'}</b>　弱み：<b>${weak.length ? esc(weak.join('、')) : 'とくになし'}</b></p>
      ${rows}
      <p class="small">この部位ごとの合計が、総合点の「部位の特徴」（${Math.round(RESEARCH_REF.weights.featureJapanese * 100)}%）です。日本人の評価者が魅力的と感じる向き（Nakamura & Watanabe 2020 の CG の顔の変化）に、各部位が日本人男性の平均からどれだけ寄っているか。＋＋/＋＝好まれる向き、−/−−＝反対の向き、±＝平均くらい。「効き」はその部位が魅力の向きにどれだけ効くか（目が最も大きい）。SD は日本人男性 ${RESEARCH_REF.n} 人の中のばらつきの単位。鼻すじの高さ・鷲鼻などは正面の写真では測れないため入っていません。</p>
    </div>`;
}

// 研究の知見による相対点の内訳（平均顔への近さ・男らしさのバランス・日本人の好みの向き・参考の左右対称）
function researchNotes(r) {
  const R = r.research;
  if (!R) return '';
  const w = RESEARCH_REF.weights, p = R.parts, V = RESEARCH_REF.validity;
  const mi = p.masculinity.mascIndex;
  const mascSide = mi > 0.5 ? '平均より男性寄り' : mi < -0.5 ? '平均より女性寄り' : '平均くらい';
  const opt = RESEARCH_REF.mascPreference.optimum;
  const rangeOf = (key) => percentileInterval(RESEARCH_REF.sortedParts[key], p[key].z).map(Math.round).join('〜');
  const row = (name, weight, pct, notes, tag = '', key = null) => `<div class="item open">
      <div class="item-head" role="group"><span class="item-name">${name}${tag}<span class="research-note-meta">${weight != null ? `<span>総合点への重み ${Math.round(weight * 100)}%</span>` : '<span>総合点には含めない</span>'}${key ? `<span>参考範囲 ${rangeOf(key)} 点</span>` : ''}</span></span>
        <span class="item-score ${level(pct)}">${Math.round(pct)}</span>${meter(pct)}</div>
      <div class="item-body"><ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div></div>`;
  return `
    <div class="label">Research</div>
    <div class="items">
      ${row('部位の特徴（日本人の好み）', w.featureJapanese, p.featureJapanese.pct, [
        '目の大きさ・眉と目の距離・小鼻の幅・あごの幅など8つの特徴が、日本人の評価者の好む向き（Nakamura & Watanabe 2020）にどれだけ寄っているかの合計。下の「部位ごとのプラス・マイナス」の合計にあたります。',
        `重みは日本人の評価者の CG の顔の変化だけから決め、評価データには合わせていません。それでも実在のアジア系男性の評価と最もよく一致した要素です（撮影条件をそろえて ρ＝${V.featureRhoB.toFixed(2)}）。`,
        `日本人男性 ${RESEARCH_REF.n} 人の中の順位で ${Math.round(p.featureJapanese.pct)} 点（50点が真ん中）。`], '', 'featureJapanese')}
      ${row('日本人の好みの向き（形）', w.japanese, p.japanese.pct, [
        '目・眉・鼻・口の点の並び（形）全体が、日本人の評価者の「魅力が上がる顔の変化」の向きにどれだけ寄っているか。',
        `実在のアジア系男性の評価データでも当たることを確認しました（ρ＝${V.japaneseRhoB.toFixed(2)}）。日本人男性 ${RESEARCH_REF.n} 人の中の順位で ${Math.round(p.japanese.pct)} 点。`], '', 'japanese')}
      ${row('平均顔への近さ', w.averageness, p.averageness.pct, [
        `目・眉・鼻・口の形と配置が、日本人男性の平均顔にどれだけ近いか（輪郭は撮影距離で変わりやすいので使わない）。`,
        `日本人男性 ${RESEARCH_REF.n} 人の中の順位で ${Math.round(p.averageness.pct)} 点（50点が真ん中）。平均性は研究で魅力と関係が確かめられた要素（Rhodes 2006 のまとめで r≈0.4、日本人の顔でも同じ：Rhodes ら 2001）。`], '', 'averageness')}
      ${row('男らしさのバランス', w.masculinity, p.masculinity.pct, [
        `男らしさ ${mi >= 0 ? '+' : ''}${mi.toFixed(1)}（標準偏差の単位。${mascSide}）。あごの幅・眉と目の距離・目の大きさ・唇の厚さ・小鼻の幅などから計算。`,
        `評価データ（撮影条件をそろえたもの）では、男性的すぎると評価が下がり、女性寄りに ${Math.abs(opt).toFixed(1)} 標準偏差ほどのところで最も高い（日本人の評価者も女性寄りの男性顔を好んだ：Perrett ら 1998、Nakamura & Watanabe 2020）。`], '', 'masculinity')}
      ${row('左右対称', null, p.symmetry.pct, [
        '研究では魅力と関係があるとされる要素ですが、このアプリの測り方では評価データとの関係が確認できなかったため（ρ≈0.04）、総合点には入れていません。',
        '顔の点の検出は左右をそろえた形を出しやすく、本当の左右差を取りきれないことが一因と考えられます。'], '<span class="item-tag">参考</span>', 'symmetry')}
    </div>
    <p class="small" style="margin-top:10px">総合点＝部位の特徴 ${Math.round(w.featureJapanese * 100)}%・日本人の好みの向き（形）${Math.round(w.japanese * 100)}%・平均顔への近さ ${Math.round(w.averageness * 100)}%・男らしさのバランス ${Math.round(w.masculinity * 100)}% を合わせ、日本人男性 ${RESEARCH_REF.n} 人の中の順位にしたもの。重みはアジア系男性の評価データ（研究用）の前半で、撮影条件の影響を除いて決め、後半で繰り返し開発中の確認を行いました（ρ＝${V.rhoB.toFixed(2)}、95% 区間 ${V.ci95B.map((v) => v.toFixed(2)).join('〜')}。部位の特徴を入れる前は ${V.withoutFeatureRhoB.toFixed(2)}、前の版は ${V.previousVersionRhoB.toFixed(2)}）。基準の日本人男性は公開写真のある著名人・スポーツ選手が中心です。</p>`;
}

// 内訳ごとの「なぜこの点数か」を一文で（測定値から作る）
function componentReason(key, R) {
  const z = R.parts[key]?.z ?? 0;
  if (key === 'featureJapanese') {
    const phrase = (d) => {
      const it = d.items.slice().sort((a, b) => Math.abs(b.weight * b.z) - Math.abs(a.weight * a.z))[0];
      return `${FEATURE_WORDS[it.key][0]}が${it.z > 0 ? FEATURE_WORDS[it.key][1] : FEATURE_WORDS[it.key][2]}`;
    };
    const D = R.partsDetail || [];
    const up = D.filter((d) => d.influence >= 0.05 && d.score >= 0.4).map(phrase);
    const down = D.filter((d) => d.influence >= 0.05 && d.score <= -0.4).map(phrase);
    if (!up.length && !down.length) return '日本人の評価者が好む向きに対して、目立って上げ下げしている部位はなく平均的です。';
    return [up.length ? `点数を上げている：${up.join('、')}` : '', down.length ? `下げている：${down.join('、')}` : ''].filter(Boolean).join('。') + '（日本人の評価者が好む向きとの比較）。';
  }
  if (key === 'japanese') return z >= 0.4 ? '目・眉・鼻・口の並び全体が、日本人の評価者が好む形に近いです。' : z <= -0.4 ? '目・眉・鼻・口の並び全体が、日本人の評価者が好む形から離れています。' : '目・眉・鼻・口の並び全体は、日本人の評価者が好む形との近さが平均くらいです。';
  if (key === 'averageness') return z >= 0.4 ? 'パーツの形と配置が日本人男性の平均顔に近いです（平均に近い顔ほど魅力的に見えやすい）。' : z <= -0.4 ? 'パーツの形と配置が平均顔から離れていて個性的です（平均に近いほど点が高くなる要素のため低め）。' : 'パーツの形と配置の、平均顔への近さは平均くらいです。';
  if (key === 'masculinity') {
    const mi = R.parts.masculinity.mascIndex, opt = RESEARCH_REF.mascPreference.optimum;
    const side = mi > 0.5 ? '男性寄り' : mi < -0.5 ? '女性寄り' : '平均くらい';
    const rel = Math.abs(mi - opt) < 0.5 ? 'そこに近いです' : mi > opt ? 'それより男性寄りです' : 'それより女性寄りです';
    return `顔立ちの男らしさは${side}（${mi >= 0 ? '+' : ''}${mi.toFixed(1)}）。評価が最も高いのは少し女性寄り（${opt.toFixed(1)}）で、${rel}。`;
  }
  return '';
}

// 数値の結果は短く見せ、説明は全タブ共通の末尾へまとめる。
function researchCard(r) {
  const R = r.research;
  if (!R) return '';
  const names = { featureJapanese: '顔のパーツの特徴', japanese: '顔全体の形', averageness: '平均顔への近さ', masculinity: '男らしさのバランス' };
  return `<section class="research-overview" aria-label="点数の内訳">
    <h2 class="section-title">点数の内訳 <span>基準 ${RESEARCH_REF.n} 人内</span></h2>
    <div class="component-list">${Object.entries(names).map(([key, name]) => {
      const p = R.parts[key];
      if (!p) return '';
      const interval = percentileInterval(RESEARCH_REF.sortedParts[key], p.z).map(Math.round);
      return `<article class="component-card">
        <div class="component-heading"><h3>${name}</h3><b>${Math.round(p.pct)}<small>点</small></b></div>
        ${meter(p.pct)}
        <p class="component-why">${esc(componentReason(key, R))}</p>
        <div class="component-meta"><span>重み ${Math.round(RESEARCH_REF.weights[key] * 100)}%</span><span>参考 ${interval[0]}〜${interval[1]} 点</span></div>
      </article>`;
    }).join('')}</div>
  </section>`;
}

// 点数を上げ下げしている要素（v0.11）：要素ごとに「日本人男性の基準の平均だったら総合点が何点変わるか」を逆にした値
// （＋＝その要素で点を得ている、−＝失っている）。1回ごとの揺れ（主に目の開き）で順番が入れ替わらないよう、
// 直近の平均と同じ記録（この記録まで、最大5回）で平均する。
let sensitivityCache = null;
function effectsCard(rec, r) {
  if (!r.research) return '';
  const evs = store.records().filter((x) => x.raw && x.at <= rec.at).slice(0, 5).map((x) => evaluate(x).research).filter(Boolean);
  const list = evs.length ? evs : [r.research];
  const avg = (fn) => list.reduce((t, e) => t + fn(e), 0) / list.length;
  const rows = elementImpacts(list[0], RESEARCH_REF).map((it) => ({ ...it, gain: avg((e) => -elementImpacts(e, RESEARCH_REF).find((x) => x.key === it.key).points) }));
  const feat = (k) => avg((e) => e.features[k]);
  const zOf = (k) => avg((e) => e.parts[k]?.z ?? 0);
  const note = (it) => {
    const part = ELEMENT_FEATURES[it.key];
    if (part) return part.map((k) => { const z = feat(k); return `${FEATURE_WORDS[k][0]}が${Math.abs(z) < 0.3 ? '平均くらい' : z > 0 ? FEATURE_WORDS[k][1] : FEATURE_WORDS[k][2]}`; }).join('・');
    const z = zOf(it.key);
    if (it.key === 'japanese') return `目・眉・鼻・口の並び全体が、日本人の評価者が好む形に${z >= 0.4 ? '近い' : z <= -0.4 ? '遠い' : '平均くらいの近さ'}`;
    return `パーツの形と配置が、日本人男性の平均顔に${z >= 0.4 ? '近い' : z <= -0.4 ? '遠い（個性的）' : '平均くらいの近さ'}`;
  };
  const scale = Math.max(10, ...rows.map((it) => Math.abs(it.gain)));
  const row = (it) => {
    const kind = it.gain <= -1 ? 'minus' : it.gain >= 1 ? 'plus' : 'flat', w = (50 * Math.min(1, Math.abs(it.gain) / scale)).toFixed(1);
    const pts = Math.round(it.gain);
    return `<div class="effect-row ${kind}">
        <span class="effect-name">${esc(it.name)}</span>
        <span class="effect-bar" role="img" aria-label="${esc(it.name)}：${pts > 0 ? '+' : ''}${pts}点"><i style="${it.gain >= 0 ? 'left:50%' : `left:${(50 - w).toFixed(1)}%`};width:${w}%"></i></span>
        <b class="effect-pts">${pts > 0 ? '+' : pts < 0 ? '−' : '±'}${Math.abs(pts)}<small>点</small></b>
        <span class="effect-note">${esc(note(it))}</span>
      </div>`;
  };
  const minus = rows.filter((it) => it.gain <= -1).sort((a, b) => a.gain - b.gain);
  const plus = rows.filter((it) => it.gain >= 1).sort((a, b) => b.gain - a.gain);
  const flat = rows.filter((it) => Math.abs(it.gain) < 1);
  const group = (title, xs) => (xs.length ? `<p class="effect-group">${title}</p>${xs.map(row).join('')}` : '');
  sensitivityCache ??= elementSensitivity(RESEARCH_REF);
  const top = sensitivityCache.slice(0, 4).map((e) => `${e.name}（約${Math.round(e.points)}点）`).join('・');
  return `<section aria-label="点数を上げ下げしている要素">
    <h2 class="section-title">点数を上げ下げしている要素 <span>${list.length >= 2 ? `直近${list.length}回の平均` : 'この記録'}</span></h2>
    <p class="section-lead">それぞれの要素が日本人男性（基準 ${RESEARCH_REF.n} 人）の平均だった場合と比べて、総合点を何点上げているか・下げているかです。−の要素が、点数を下げている所です。1つずつ平均に置き換えて計算した目安なので、足し合わせても総合点とは一致しません。</p>
    <div class="card effects">${group('点数を下げている', minus)}${group('点数を上げている', plus)}${group('ほとんど影響なし（±1点未満）', flat)}</div>
    <p class="small effects-foot">基準の人で点数を左右しやすい順（平均の人が、日本人の評価者が好む向きと反対に1標準偏差ずれたときに下がる点）：${top}。目の縦の開きは、撮影のたびの開き方でも変わります（点数の揺れの主な原因）。</p>
  </section>`;
}

function scaleCard(r) {
  if (!r.research || !RESEARCH_REF.anchors) return '';
  const image = { '-3': 'cg-minus3', '0': 'cg-0', '3': 'cg-plus3' };
  const caption = { '-3': '低い設定', '0': '中間設定', '3': '高い設定' };
  return `<section aria-label="10段階の目安">
    <h2 class="section-title">10段階の位置 <span>あなたは ${levelOf(r.research.total)} / 10</span></h2>
    <p class="section-lead">基準の ${RESEARCH_REF.n} 人を点数の順に10のグループ（1グループ約${Math.round(RESEARCH_REF.n / 10)}人）に分けたとき、あなたが入るグループです。10が最上位、1が最下位で、5〜6が真ん中です。下の3つは、日本人の評価者が「魅力が低い・中間・高い」と感じる方向に動かした CG の顔を、このアプリで測った段階です。点数の高さのイメージとして見てください（実在の人ではありません）。</p>
    <div class="card visual-scale"><div class="anchor-row">${RESEARCH_REF.anchors.map(a => `<figure>
      <img src="img/${image[a.sd]}.jpg" width="240" height="300" alt="${caption[a.sd]}のCG見本。アプリでの段階${a.level}" loading="lazy">
      <figcaption><b>${a.level}<small> / 10</small></b><span>${caption[a.sd]}</span></figcaption>
    </figure>`).join('')}</div><p class="visual-caption">同じCGの設定違い。本人の写真ではありません。</p></div>
  </section>`;
}

function partIcon(key) {
  const paths = {
    eyes: '<path d="M5 20Q20 4 35 20Q20 36 5 20Z"/><circle cx="20" cy="20" r="6"/>',
    brows: '<path d="M6 10Q19 3 33 10M6 26Q20 14 34 26"/><path d="M20 11v8M17 15l3 4 3-4"/>',
    jaw: '<path d="M7 5v12q1 13 13 19 12-6 13-19V5M10 20l10 11 10-11"/>',
    nose: '<path d="M17 5l-6 23q9 9 18 0L23 5M12 28q4-5 8 0 4-5 8 0"/>',
    lips: '<path d="M4 20q10-11 16-4 6-7 16 4-16 18-32 0ZM4 20h32"/>',
  };
  return `<svg viewBox="0 0 40 40" aria-hidden="true">${paths[key] || ''}</svg>`;
}

function partsCard(r) {
  const parts = r.research?.partsDetail;
  if (!parts) return '';
  return `<section aria-label="部位の特徴">
    <h2 class="section-title">部位の特徴 <span>研究の基準に対する傾向</span></h2>
    <div class="visual-parts">${parts.slice().sort((a,b) => b.influence-a.influence).map(p => {
      const effect = p.influence < .05 ? 'small' : p.score >= .4 ? 'plus' : p.score <= -.4 ? 'minus' : 'neutral';
      const label = { small: '影響小', plus: '＋ プラス寄り', minus: '− マイナス寄り', neutral: '± 標準付近' }[effect];
      const detail = p.items.map(it => {
        const word = Math.abs(it.z) < .3 ? '標準付近' : it.z > 0 ? FEATURE_WORDS[it.key][1] : FEATURE_WORDS[it.key][2];
        return `<span>${esc(FEATURE_WORDS[it.key][0])}：${esc(word)}</span>`;
      }).join('');
      const position = Math.max(4, Math.min(96, 50 + 22 * p.score));
      return `<article class="visual-part ${effect}">
        <div class="part-symbol">${partIcon(p.key)}</div>
        <div class="part-copy"><h3>${esc(p.name)}</h3></div>
        <b class="part-verdict">${label}</b>
        <div class="part-description">${detail}</div>
        <div class="part-axis" role="img" aria-label="${esc(p.name)}：${label}"><span class="axis-mid"></span><i style="left:${position.toFixed(1)}%"></i></div>
      </article>`;
    }).join('')}</div>
    <div class="axis-legend"><span>− 反対方向</span><span>研究で好まれる方向 ＋</span></div>
  </section>`;
}

function resultNotes(rec, r) {
  const a = r.attractiveness;
  const camera = r.calibrated == null ? '遠近補正なし（古い記録）' : r.calibrated ? `較正済み${calibCount(rec) ? `・${calibCount(rec)}回` : ''}` : rec.imported ? '未較正（元の端末）' : '未較正';
  const explanation = a
    ? `基準：${esc(a.cohort)}。日本人男性の評価データを学んだ形状からの推定です。50点が校正用${a.referenceImages}画像の真ん中。一般の日本人男性全体の順位は未検証です。学習写真と同じく遠近補正前の形状を使うため、撮影距離の影響は残ります。`
    : attractivenessModel ? '取り込んだ日本人男性の評価モデルを主点に使います。計算できない記録を別の主点へ置き換えることはありません。'
    : `日本人の評価者が好む部位の特徴と顔の形の方向、平均顔への近さ、男らしさのバランスを合わせ、基準${RESEARCH_REF.n}人内の順位にした点数です。50点が真ん中です。一般の日本人男性全体の順位ではありません。`;
  return `<details class="result-notes" id="resultNotes"><summary>採点の根拠・測定の詳細</summary>
    <div class="notes-content"><h2>この点数について</h2><p class="small">${explanation}</p>
    ${!attractivenessModel ? `<p class="small">参考範囲は基準の人数と撮影ごとのばらつきから推定したものです。3回からの推定には不確かさがあり、90%の確率で真の順位を含む保証はありません。モデル自体の誤差、撮影条件のずれ、著名人中心の基準の偏りは含みません。</p>
    <p class="small">10段階は基準集団の10分位です。10＝基準${RESEARCH_REF.n}人の上位10%、1＝下位10%。段階の薄い部分は参考範囲です。</p>` : ''}
    <h2>測定の状態</h2><dl class="measurement-facts"><div><dt>遠近補正</dt><dd>${camera}</dd></div><div><dt>生え際</dt><dd>${r.measures.thirds.hairlineSet ? '指定' : '推定'}</dd></div>${r.spread != null ? `<div><dt>参考比率のぶれ</dt><dd>±${one(r.spread)}</dd></div>` : ''}${!attractivenessModel && r.research?.spread != null ? `<div><dt>相対点のぶれ</dt><dd>±${one(r.research.spread)}</dd></div>` : ''}${rec.imported ? '<div><dt>記録の出所</dt><dd>この端末へ読み込んだ記録</dd></div>' : ''}</dl>
    ${!attractivenessModel ? researchNotes(r) + scaleNotes(r) + partsNotes(r) : ''}
    ${!attractivenessModel ? `<h2>基準集団について</h2><p class="small">現在は、公開写真と出典を確認した日本国籍の男性${RESEARCH_REF.n}人が基準です。著名人・スポーツ選手が中心で、一般男性の無作為標本ではありません。撮影時年齢に未成年・不明が含まれ、成人だけの基準ではありません。${RESEARCH_REF.provenance?.stagedCohort?.remeasuredRows ? `このうち${RESEARCH_REF.provenance.stagedCohort.remeasuredRows}人は、手元の同じ写真で最初は顔が小さく見つからず、写真を区切って測り直して加えた人で、撮影時に成人だと記録で確かめられた人だけです。` : ''}追加候補は国籍・性別・成人の出典、利用条件、人物の重複、撮影品質を確認してから組み込みます。本人の繰り返し撮影を別人として基準人数に足すことはありません。</p>` : ''}
    </div></details>`;
}

function rankList(list, all, kind = 'hair') {
  const shown = all ? list : list.slice(0, 5);
  return `<div class="rank">${shown.map((h, i) => `
    <article class="rank-card${i === 0 ? ' best' : ''}">
      <div class="rank-top">
        <span class="rank-no">${pad2(i + 1)}</span>
        <span class="rank-name">${esc(h.name)}${i === 0 ? '<span class="rank-tag">BEST</span>' : ''}</span>
        <span class="rank-score">${Math.round(h.score)}</span>
      </div>
      ${kind === 'eyewear' ? `<figure class="frame-product"><img data-frame="${esc(h.id)}" alt="${esc(h.name)}の立体的な形の見本" width="900" height="560" hidden><span class="frame-loading">3D見本を準備しています</span><figcaption>形の3D見本・実在商品の写真ではありません</figcaption></figure>` : ''}
      ${meter(h.score)}
      <div class="rank-tip"><b>${kind === 'hair' ? '美容室での頼み方' : '選ぶときのポイント'}</b>${esc(h.tip)}</div>
      ${kind === 'eyewear' ? `<button class="btn ghost tryon-btn" type="button" data-act="tryon" data-id="${esc(h.id)}">この形を自分の顔で試す</button>` : ''}
      <div class="rank-reasons"><b>この点数の理由</b><ul class="rank-why">${h.reasons.map((t) => typeof t === 'string' ? `<li>${esc(t)}</li>` : `<li><span class="why-src ${t.src === 'rule' ? '' : t.v > 0 ? 'plus' : 'minus'}${t.src === 'research' ? ' research' : ''}">${t.src === 'rule' ? '定番' : t.src === 'research' ? '研究' : '測定'}</span>${esc(t.text)}</li>`).join('')}</ul>
      </div>
    </article>`).join('')}</div>`;
}

function hairTab(r) {
  return `
    <div class="label">Hair style</div>
    ${rankList(r.hair, ui.allHair, 'hair')}
    ${r.hair.length > 5 && !ui.allHair ? `<button class="more" type="button" data-act="allHair">すべて見る（${r.hair.length}）</button>` : ''}
    <p class="small" style="margin-top:14px">点数＝顔の形との相性（「定番」：美容室で定番の考え方による目安）に、あなたの測定値（「測定」：縦横の比率・おでこの広さ・あごの幅、部位の強み・弱み）をどれだけ生かせるか・整えられるかを足したもの。目元・眉と目の距離の向き（どちらが好まれるか）は、日本人の評価者の研究（Nakamura & Watanabe 2020）と評価データで確かめたものです。</p>`;
}

function eyewearTab(r) {
  const list = r.glasses.filter((g) => g.kind === (ui.eyewear === 'sun' ? 'sunglasses' : 'glasses'));
  const s = r.size;
  return `
    <div class="seg mini">
      <button type="button" aria-pressed="${ui.eyewear === 'glasses'}" class="${ui.eyewear === 'glasses' ? 'on' : ''}" data-eyewear="glasses">メガネ</button>
      <button type="button" aria-pressed="${ui.eyewear === 'sun'}" class="${ui.eyewear === 'sun' ? 'on' : ''}" data-eyewear="sun">サングラス</button>
    </div>
    <div class="card tryon-cta">
      <p><b>立体フレームを試着</b>見本の顔・カメラ・自分で選んだ写真に重ねて見られます。写真はこの画面が開いている間だけ使い、閉じると消えます。保存・送信・採点には使いません。</p>
      <button class="btn block" type="button" data-act="tryon" data-id="${esc(list[0]?.id || '')}">試着をはじめる</button>
    </div>
    <h2 class="section-title">似合う${ui.eyewear === 'sun' ? 'サングラス' : 'メガネ'}</h2>
    ${rankList(list, true, 'eyewear')}
    <h2 class="section-title">サイズの目安</h2>
    <div class="card">
      ${s ? `<div class="size-grid">
        <div><b>${s.pd}</b><span>瞳孔間 mm</span></div>
        <div><b>${s.lensPlusBridge[0]}–${s.lensPlusBridge[1]}</b><span>レンズ＋ブリッジ mm</span></div>
        <div><b>${s.lens[0]}–${s.lens[1]}</b><span>レンズ幅 mm</span></div>
      </div>
      <p class="small" style="margin:0">${esc(s.bridge)}<br>黒目の大きさから推定した目安です（±5% 程度）。メガネの「52□18」のような表記は、レンズ幅□ブリッジ幅です。</p>` : '<p class="small">この記録には黒目の点がないため、mmでのサイズ目安は表示できません。</p>'}
      <p class="small" style="margin:6px 0 0">「定番」は美容室・メガネ店で定番の考え方による目安、「測定」はあなたの測定値（縦横比・あご幅・目元・眉と目の距離）、「研究」は研究の結果にもとづく理由です。顔の形の判定は平均顔のデータにもとづきます。</p>
      <p class="small" style="margin:6px 0 0">研究の知見：メガネをかけると知的に見える一方、魅力はやや下がって見えやすい。ただしフチなしでは信頼感が上がり、魅力は下がらなかった。メガネは目元に視線を集める（Leder・Forster・Gerger 2011、ヨーロッパでの実験）。</p>
    </div>
`;
}

// ---------- 記録 ----------
function cameraSettings() {
  return `<section class="camera-settings" aria-labelledby="cameraSettingsTitle">
    <h2 id="cameraSettingsTitle">遠近の補正</h2>
    <p class="small">撮影する端末のカメラを較正します。複数回の結果で値の安定を確かめられます。</p>
    <button class="btn ghost block" type="button" data-act="calib">遠近の補正（カメラの較正）</button>
  </section>`;
}
function renderHistory() {
  const recs = store.records();
  if (!recs.length) {
    view.innerHTML = `<div class="empty fade-in">まだ記録がありません。<br><br><button class="btn" type="button" data-act="shoot">測定をはじめる</button><div style="margin-top:12px"><button class="btn ghost" type="button" data-act="import">書き出した記録を読み込む（JSON）</button></div></div>${cameraSettings()}`;
    return;
  }
  const rows = recs.map((rec) => { const r = evaluate(rec); return { rec, r, value: displayedScore(r) }; });
  const totals = rows.map((x) => x.value).filter(Number.isFinite);
  // 1回ごとの点数は揺れるので「最高」は出さず、直近5回の平均を出す（2026-10-20）
  const recentAvg = attractivenessModel ? null : (recentAverage(rows[0].rec).total ?? null);
  const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  const num = (v) => v == null ? '—' : one(v);
  const chrono = rows.filter((x) => x.value != null).slice(0, 30).reverse().map((x) => ({ at: x.rec.at, total: x.value }));
  view.innerHTML = `
    <div class="fade-in">
      <div class="label" style="margin-top:8px">Summary</div>
      <p class="small">${metricLabel()}。比率スコアは主点の集計に含みません。各記録の参考範囲は、2つの記録の差を検定したものではありません。小さな点差だけで変化を断定しないでください。元の点がない古い記録（v0.1）も集計に含みません。</p>
      <div class="stats">
        <div><b>${num(rows[0].value)}</b><span>最新</span></div>
        <div><b>${num(recentAvg)}</b><span>直近5回の平均</span></div>
        <div><b>${num(avg)}</b><span>平均</span></div>
        <div><b>${recs.length}</b><span>回数</span></div>
      </div>
      ${chrono.length ? `<div class="card chart">${chartSVG(chrono)}</div>` : '<p class="small">主点を計算できる記録がありません。元の点がある記録（v0.2 以降）で計算します。</p>'}
      <details class="history-fold" id="historyList"${ui.historyOpen ? ' open' : ''}>
      <summary><span class="fold-copy"><strong>記録一覧<span class="fold-count">${recs.length}件</span></strong><span class="fold-hint">History · <span class="when-closed">タップして開く</span><span class="when-open">タップして閉じる</span></span></span>${icon.chev}</summary>
      <div class="list">${rows.map(({ rec, r, value }, i) => {
        const prev = rows[i + 1];
        const d = prev?.value != null && value != null ? value - prev.value : null;
        return `<a class="row" href="#r/${encodeURIComponent(rec.id)}">
          <div><div class="row-date">${dateText(rec.at)}</div><div class="row-sub">${rec.imported ? '読み込み・' : ''}${esc(r.shape.main.name)}・生え際${r.measures.thirds.hairlineSet ? '指定' : '推定'}${!attractivenessModel && r.research?.interval ? `・10段階で ${levelOf(r.research.total)}・範囲 ${r.research.interval.map(Math.round).join('〜')}` : ''}・参考比率 ${one(r.score.total)}</div></div>
          <div class="row-delta${d != null && d > 0 ? ' up' : ''}">${d == null ? '' : `${d >= 0 ? '+' : ''}${one(d)}`}</div>
          <div class="row-score">${num(value)}</div>
        </a>`;
      }).join('')}</div></details>
      <div class="actions">
        <button class="btn ghost block" type="button" data-act="export">データを書き出す（JSON）</button>
        <button class="btn ghost block" type="button" data-act="import">書き出した記録を読み込む（JSON）</button>
        <button class="btn danger block" type="button" data-act="clear">すべての記録を削除</button>
      </div>
      ${cameraSettings()}
    </div>`;
}

view.addEventListener('toggle', (event) => {
  if (event.target.id === 'historyList') ui.historyOpen = event.target.open;
}, true);

// ---------- 画面の切り替え ----------
function route() {
  const hash = location.hash || '#result';
  if (hash.startsWith('#r/')) {
    try { decodeURIComponent(hash.slice(3)); } catch { location.hash = '#history'; return; }
  }
  const destination = hash === '#history' || hash.startsWith('#r/') ? 'history' : 'result';
  document.querySelectorAll('.tab').forEach((t) => {
    const active = t.dataset.tab === destination;
    t.classList.toggle('active', active);
    if (active) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
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

// いま表示している記録（#r/… ならその記録、そうでなければ最新）
function currentRecord() {
  const hash = location.hash || '#result';
  try { return hash.startsWith('#r/') ? store.get(decodeURIComponent(hash.slice(3))) : store.latest(); } catch { return null; }
}

function rerenderTab() {
  const body = $('#tabBody');
  const hash = location.hash || '#result';
  if (hash.startsWith('#r/')) {
    try { decodeURIComponent(hash.slice(3)); } catch { location.hash = '#history'; return; }
  }
  let rec;
  try { rec = hash.startsWith('#r/') ? store.get(decodeURIComponent(hash.slice(3))) : store.latest(); } catch { location.hash = '#history'; return; }
  if (!body || !rec) return;
  body.innerHTML = tabBody(rec, evaluate(rec));
  void hydrateFrameImages();
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
  if (act === 'tryon') {
    const rec = currentRecord();
    const r = rec ? evaluate(rec) : null;
    if (r) {
      const items = ['glasses', 'sunglasses'].flatMap((k) => r.glasses.filter((g) => g.kind === k)).map((g) => ({ id: g.id, name: g.name, kind: g.kind, score: g.score }));
      openTryOn({ items, startId: t.dataset.id || items[0]?.id, pd: r.size?.pd ?? null });
    }
  }
  if (act === 'import') importData();
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

// 別の端末（iPhone など）で書き出した記録を読み込む。写真は含まれない（点の座標と較正値だけ）
function importData() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      if (file.size > IMPORT_LIMITS.bytes) throw new Error('ファイルが大きすぎます');
      const { records, skipped } = parseExport(await file.text());
      if (!records.length) throw new Error('読み込める記録がありませんでした');
      const res = store.importRecords(records);
      if (!res) throw new Error('保存できませんでした。端末の保存領域を確認してください');
      memo.clear(); route();
      const note = skipped ? `・${skipped}件は形式が合わず読み込みませんでした` : '';
      toast(res.added || res.updated ? `${res.added}件を読み込みました${res.updated ? `（${res.updated}件は較正値を更新）` : ''}${note}` : `すべて読み込み済みの記録でした${note}`);
    } catch (err) { toast(err.message || '読み込めませんでした'); }
  });
  input.click();
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
  <p>日本人男性を基準に、自分の顔を相対点で見るための個人用アプリです。</p>
  <h3>主点：研究の知見による相対点</h3>
  <ul>
    <li>研究で魅力との関係が確かめられた3要素（平均顔への近さ・左右対称・男らしさ）を候補にし、このアプリの測り方で人の評価と本当に一致するかを確かめてから使っています。</li>
    <li>平均顔への近さ：目・眉・鼻・口の形と配置が日本人男性の平均顔にどれだけ近いか。輪郭は撮影距離（遠近）で大きく変わり、撮り方の違う写真どうしで比べると意味を失うため使いません。</li>
    <li>男らしさのバランス：あごの幅・眉と目の距離・目の大きさ・唇の厚さ・小鼻の幅など、研究で性差が報告されている特徴から計算。評価データでは男性的すぎると評価が下がり、やや女性寄りで最も高くなりました（日本人の評価者で女性寄りが好まれた Perrett ら 1998 と同じ向き）。</li>
    <li>日本人の好みの向き：早稲田大の研究（Nakamura & Watanabe 2020、Scientific Reports。データは自由に使える CC0）で、日本人の大学生の評定から作られた「魅力が上がる顔の変化」の動画（CG の東アジア人男性の顔）を同じ方法で測り、目・眉・鼻・口の形が動く向きを求めたもの。本人の形がその向きにどれだけ寄っているかを見ます。実在の人の写真は使っていません。</li>
    <li>顔の写る大きさ（解像度）の補正：同じ顔を大きさだけ変えて測る実験（基準の写真の人を顔の幅90〜450画素に縮めて測定）で、測定値がほとんど変わらないことを確かめ、その実測の変化だけを補正します。v0.10 より前は基準の人どうしの比較から補正していたため、遠くから撮った写真の写り方の違いまで大きさのせいにしてしまい、顔を大きく写すこのアプリの撮影では同じ顔でも約3点低く出ていました。</li>
    <li>点数を上げ下げしている要素：目・眉と目の間・あご・小鼻・唇・顔全体の形・平均顔への近さのそれぞれについて、その要素だけを日本人男性の基準の平均に置き換えたら総合点が何点変わるかを計算し、＋（得している）・−（下げている）で示します。1回ごとの揺れを抑えるため、直近の平均と同じ最大5回の記録で平均します。基準の人では、点数を最も左右するのは目でした（10段階で1〜3の人の多くは、目が点数を下げている一番の要素）。</li>
    <li>左右対称：研究では魅力と関係がありますが、このアプリの測り方では評価との関係が確認できなかったため、総合点には入れず参考として表示します。</li>
    <li>重み（部位の特徴 ${Math.round(RESEARCH_REF.weights.featureJapanese * 100)}%・日本人の好みの向き（形）${Math.round(RESEARCH_REF.weights.japanese * 100)}%・平均顔 ${Math.round(RESEARCH_REF.weights.averageness * 100)}%・男らしさ ${Math.round(RESEARCH_REF.weights.masculinity * 100)}%）は、アジア系男性の顔に60人が付けた評価（SCUT-FBP5500。研究用データ。日本人女性の評価ではない）の半分で決め、残りの半分で確かめました。人の評価との一致は ρ＝${RESEARCH_REF.validity.rhoB.toFixed(2)}（95% 区間 ${RESEARCH_REF.validity.ci95B.map((v) => v.toFixed(2)).join('〜')}）。この評価データでは顔の上下の向きそのものが評価と相関するため、向き・笑顔・解像度の影響を点数と評価の両方から除いた値です（v0.4 の表示 0.29 はこの影響を含んでいました）。v0.7 で、重みと男らしさの山の位置もこのやり方で決め直しました。同じ後半の結果を複数版の開発で参照しているため、完全に未知のデータでの検証ではありません。新しい人物単位での検証は未完了です。</li>
    <li>順位の基準は、公開写真（Wikimedia Commons）のある日本国籍の男性 ${RESEARCH_REF.n} 人です（国籍・性別は Wikidata の記載。顔や名前から推定していません）。v0.10 で、手元の同じ写真のうち最初は顔が小さく測れなかったものを測り直し、98人から増やしました（追加は撮影時に成人と確かめられた人だけ）。著名人・スポーツ選手が中心で、一般の日本人男性全体の順位ではありません。点数には、基準の人数と撮影ごとのばらつきから計算した「参考範囲」を添えます。式は名目90%の係数を使いますが、3回から推定したばらつきには不確かさがあり、合成実験でも90%を下回る場合がありました。実際の誤差を90%含むという保証ではありません。モデル自体の誤差・撮影条件のずれ・基準の偏りは含まず、2つの記録の差の有意性も示しません。</li>
    <li>10段階：基準 ${RESEARCH_REF.n} 人を10人に1人ずつに分けた位置です（10＝上位10%、1＝下位10%）。参考範囲にあたる段階も薄く示します。目安として、日本人の大学生の評定から作られた CG の顔（実在の人ではない）を、魅力が下がる向き・平均・上がる向きに動かした3つの顔を、このアプリで測った段階と一緒に表示します。</li>
    <li>部位ごとのプラス・マイナス：日本人の評価者が魅力的と感じる顔の変化（Nakamura & Watanabe 2020）で、各特徴がどちらへ動くか（目は大きい方・眉と目は近い方・あごと小鼻は狭い方など）を重みにし、自分の各部位が日本人男性の平均からその向きにどれだけ寄っているかを示します。鼻すじの高さ・鷲鼻などは正面の写真では測れないため入っていません。</li>
    <li>魅力の正解でも、人としての価値の評価でもありません。</li>
  </ul>
  <h3>撮影の条件</h3>
  <p>鏡に正対するような自然な正面顔を、同じ条件で測ります。レンズ自体を目の高さに合わせ、画面の顔ではなくレンズを見てください。目は見開かず普段どおりに。目線や目の開き方によっても測定値が動く可能性があります。緑の表示は、レンズを見ていることを確認した表示ではありません。</p>
  <h3>参考：比率スコアの出し方</h3>
  <ul>
    <li>顔の478点の位置をスマホの中で検出し、顔の向きを正面にそろえてから測ります。</li>
    <li>左右対称 30%、縦のバランス 20%、横のバランス 20%、パーツの配置 15%、輪郭 15% の重みで総合点にします。</li>
    <li>左右対称・縦のバランスは「左右がそろう・縦3等分」との差で採点します。</li>
    <li>横のバランス・パーツの配置・輪郭は「平均顔との近さ」で採点します。平均顔は、公開データ FairFace（CC BY 4.0）の東アジア人男性 20〜39歳・正面・無表情の顔画像 204 枚を、このアプリと同じ方法で測った平均です。この3項目の中央値がおよそ 50 点になる目盛りで、手加減はしていません。総合点の中央値を 50 点にする目盛りではなく、日本人全体での順位も表していません。</li>
    <li>比率の点数であり、魅力そのものや人としての価値の評価ではありません。</li>
  </ul>
  <h3>日本人男性の評価付き採点基準（取り込み）</h3>
  <p>取り込むと、上の研究の知見による相対点に代わって主点になります。学習・校正・検証それぞれの集団が日本人男性と出典で確認できる、評価付きの採点基準だけを受け付けます。アジア男性という区分だけの基準は使いません。基準をこの端末へ取り込むと、顔の形状から人の平均評価を予測します。一般の日本人男性全体の順位や、肌・髪を含む印象は未検証です。学習写真と同じ遠近補正前の形状で計算するため、撮影距離による影響は残ります。カメラの較正は参考の比率スコア側に適用されます。</p>
  ${attractivenessModel ? `<p class="small">現在の基準：${esc(attractivenessModel.cohort.label)}<br>校正用${attractivenessModel.reference.values.length}画像内の順位。${attractivenessModel.evaluation?.model?.pearson_r != null ? `独立テストとの相関 ${Number(attractivenessModel.evaluation.model.pearson_r).toFixed(2)}（正解率ではありません）。` : ''}</p>` : '<p class="small">評価付きの採点基準は取り込まれていません。主点は研究の知見による相対点です。</p>'}
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
  <p class="small">カメラの較正は「記録」のいちばん下にある「遠近の補正」から行えます。</p>
  <h3>データ</h3>
  <ul>
    <li>写真は保存せず、どこにも送りません。採点で保存するのは顔の点の座標と点数のもとになる数値だけで、この端末の中にあります。試着で選んだ写真はその画面のメモリ内だけで使い、閉じると消えます。採点や記録の書き出しには使いません。</li>
    <li>顔の検出には Google の MediaPipe（Apache-2.0）をアプリに同梱して使っています。利用状況の送信もアプリ側で止めています。</li>
  </ul>
  <p class="small" style="margin-top:18px">バージョン ${VERSION}・3枚×${CAPTURE.framesPerShot}フレームの平均</p>
`));
sheet.addEventListener('click', (e) => {
  if (e.target.id === 'importAttractiveness') $('#attractivenessFile').click();
  if (e.target.id === 'removeAttractiveness') {
    if (!store.setSetting('attractivenessModel', null)) { toast('表示の設定を保存できませんでした'); return; }
    attractivenessModel = null; memo.clear(); closeSheet(); route(); toast('採点基準を解除しました。研究の相対スコアに戻しました');
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

const HINT = '鏡に向かうように正面へ。レンズを目の高さ・顔から40cmくらいに合わせ、画面の顔ではなくレンズを見てください。目は見開かず普段どおりに';

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
      cap.status.textContent = s.calibrated && !capOpts.mode && Number.isFinite(s.distance) ? `${s.text}　約${Math.round(s.distance)}cm` : s.text;
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
      if (!n) return;
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
    <ul><li>ふだん測るときと同じ 40cm くらいで構える（ひじを軽く曲げる）</li><li>2〜3回くり返して値の安定を確かめます（複数回の結果を平滑化）</li><li>案内に合わせて、正面 → 横 → 反対の横 → 上か下 → 反対 の順に向く</li><li>口を閉じ、目は見開かず普段どおりに。まばたきは自然にして、首をゆっくり回す</li></ul>
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
  toast(`較正しました（${n >= 4 ? '過去の結果を平滑化' : `${n + 1}回分を平均`}・水平の画角 約${Math.round(fovDegrees(fe * zs, w, h).h)}°）`);
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
    // 次のコマで描く前に画面が閉じられ、撮影画像を破棄済みのときは何もしない
    if (!el.isConnected || !snap.width || !snap.height) return;
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

window.addEventListener('storage', (event) => {
  if (event.key !== 'face-score:v1' && event.key !== null) return;
  store.refresh(); memo.clear();
  attractivenessModel = null;
  try { attractivenessModel = validateJapaneseMaleModel(store.setting('attractivenessModel')); } catch { /* 未取り込み */ }
  if ($('#capture').hidden && !document.querySelector('.hairline')) route();
  toast('別の画面で記録・設定が変更されました');
});
