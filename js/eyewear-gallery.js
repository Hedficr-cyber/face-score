// 軽量な静止画の形・色見本。顔写真やWebGLを使わず、採点と分離する。
import { PRODUCTS, PRODUCTS_CHECKED, OFFICIAL_LISTS } from './eyewear-products.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const LENS_COLORS = [
  { id: 'clear', name: 'クリア', color: '#eef3f4', note: '素顔の印象を残す、透明なレンズ。' },
  { id: 'light-gray', name: '薄いグレー', color: '#a4a8ad', note: '色の主張を抑えて、すっきりした印象に。' },
  { id: 'light-blue', name: '薄いブルー', color: '#9fc5dd', note: '涼しげで、軽やかなアクセントに。' },
  { id: 'light-brown', name: '薄いブラウン', color: '#c6ab90', note: '温かみのある、やわらかな雰囲気に。' },
  { id: 'light-green', name: '薄いグリーン', color: '#afc1aa', note: '落ち着いた、さりげない色のアクセントに。' },
  { id: 'light-purple', name: '薄いパープル', color: '#c4b1cc', note: '淡く色づく、少し個性のある雰囲気に。' },
  { id: 'dark-gray', name: '濃いグレー', color: '#43464d', note: '目元をしっかり隠す、シャープな雰囲気に。' },
  { id: 'dark-brown', name: '濃いブラウン', color: '#72533e', note: '深いブラウンで、クラシックな雰囲気に。' },
];
const FRAME_IDS = new Set(['wellington', 'boston', 'round', 'square', 'oval', 'browline', 'rimless', 'teardrop', 'wellington-sun', 'round-sun', 'square-sun', 'boston-sun']);
const safeItems = list => list.filter(h => FRAME_IDS.has(h.id));
const defaultColor = h => h.kind === 'sunglasses' ? 'dark-gray' : 'clear';
const image = (id, color) => `img/eyewear/${id}-${color}.webp`;
function selected(list, state) {
  const items = safeItems(list), frame = items.find(h => h.id === state.frame) || items[0];
  const color = LENS_COLORS.find(c => c.id === state.color) || LENS_COLORS.find(c => c.id === defaultColor(frame || {}));
  return { items, frame, color };
}
// ---- 実商品の厳選（v0.16）----
// 本人の測定に合う商品だけを出す。基準は2つ：① 形の相性（advice.js の rankGlasses の点数。顔の形・縦横比・あご幅・目元から）
// ② サイズ：瞳孔間距離から出した「レンズ幅＋ブリッジ幅」の目安（frameSize の lensPlusBridge、瞳孔間距離＋2〜8mm）に、
// 商品の公式サイズの「レンズ幅＋ブリッジ幅」が入るか（±1mm まで）。目安の中央に近い順に並べる。
// 測定にサイズの目安がないとき（古い記録など）は、形だけで選び、サイズでは絞らない。
const PRODUCT_FIRST = 4;
export function sizeFit(p, size) {
  const lb = size?.lensPlusBridge;
  if (!Array.isArray(lb) || !(p.lens > 0 && p.bridge > 0)) return null;
  const total = Math.round((p.lens + p.bridge) * 10) / 10, mid = (lb[0] + lb[1]) / 2;
  return { total, ok: total >= lb[0] - 1 && total <= lb[1] + 1, off: Math.abs(total - mid), range: lb };
}
// この形の商品のうち、サイズが合うもの（目安の中央に近い順）。サイズの目安がなければ全部
export function fittingProducts(frameId, size) {
  const all = PRODUCTS.filter(p => p.frames.includes(frameId));
  if (!Array.isArray(size?.lensPlusBridge)) return { all, fit: all, sized: false };
  const fit = all.map(p => ({ p, f: sizeFit(p, size) })).filter(x => x.f?.ok).sort((a, b) => a.f.off - b.f.off).map(x => x.p);
  return { all, fit, sized: true };
}
const fitLine = (p, size) => { const f = sizeFit(p, size); return f ? `<p class="product-fit">サイズ ${p.lens}□${p.bridge}＝${f.total}mm（あなたの目安 ${f.range[0]}〜${f.range[1]}mm）</p>` : ''; };
const productCard = (p, size = null, extra = '') => `<article class="eyewear-product">${extra}<div class="product-brand">${esc(p.brand)}<span>${esc(p.sku || '')}</span></div><h4>${esc(p.name)}</h4>${p.spec ? `<p class="product-spec">${esc(p.spec)}</p>` : ''}${fitLine(p, size)}<p>${esc(p.note)}</p><a class="btn ghost block" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">公式の商品写真を見る<span aria-hidden="true"> ↗</span><span class="sr-only">（新しいタブ）</span></a></article>`;
// あなたに似合う商品（厳選）：形の相性が高い順に、サイズが合う商品を形ごとに2件まで、合計6件
export const PICK_COUNT = 6;
export function renderPicks(list, size) {
  const picks = [];
  for (const h of safeItems(list)) {
    for (const p of fittingProducts(h.id, size).fit.slice(0, 2)) if (picks.length < PICK_COUNT) picks.push({ h, p });
    if (picks.length >= PICK_COUNT) break;
  }
  if (!picks.length) return '';
  const lb = size?.lensPlusBridge;
  return `<section class="eyewear-picks card" aria-label="あなたに似合う商品（厳選）">
    <div class="gallery-heading"><div class="label">Selected for you</div><h2>あなたに似合う商品</h2><p>形の相性が高い順に、${Array.isArray(lb) ? `フレームの大きさ（レンズ幅＋ブリッジ幅）があなたの目安 ${lb[0]}〜${lb[1]}mm に入る商品を、形ごとに2件まで選びました。` : '形ごとに2件まで選びました（この記録にはサイズの目安がないので、大きさでは絞っていません）。'}</p></div>
    <div class="eyewear-products">${picks.map(({ h, p }) => productCard(p, size, `<p class="pick-why"><b>${esc(h.name)}</b>形の相性 ${Math.round(h.score)}</p>`)).join('')}</div>
  </section>`;
}
function productHTML(frame, size) {
  const { all, fit, sized } = fittingProducts(frame.id, size);
  const brands = [...new Set(fit.map(p => p.brand))].join('・');
  const first = fit.slice(0, PRODUCT_FIRST), rest = fit.slice(PRODUCT_FIRST);
  const lb = size?.lensPlusBridge;
  return `<h3 class="gallery-products-title">${sized ? 'あなたのサイズに合う商品' : '実際の商品を見る'}<span class="gallery-products-count">${fit.length}件</span></h3><p class="small gallery-product-note">${sized ? `この形の商品${all.length}件のうち、フレームの大きさ（レンズ幅＋ブリッジ幅）があなたの目安 ${lb[0]}〜${lb[1]}mm に入るものだけを、目安の中央に近い順に出しています。` : ''}${fit.length ? `${esc(brands)}の公式ページで確かめた商品です。` : ''}実物の写真は、各ブランドの公式ページで見られます。</p>
    <div class="eyewear-products">${first.map(p => productCard(p, size)).join('') || `<p class="small">${sized ? 'この形で、あなたのサイズに合う商品は見つかりませんでした。下の公式一覧で探せます。' : 'この形の商品例は準備中です。ほかの形も選んでみてください。'}</p>`}</div>
    ${rest.length ? `<details class="product-more"><summary>ほかの商品をあと${rest.length}件見る</summary><div class="eyewear-products">${rest.map(p => productCard(p, size)).join('')}</div></details>` : ''}
    ${(OFFICIAL_LISTS[frame.id] || []).length ? `<div class="official-lists"><p class="small">公式の一覧で、この形をもっと見る</p>${OFFICIAL_LISTS[frame.id].map(l => `<a class="official-list" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><b>${esc(l.brand)}</b>${esc(l.label)}<span aria-hidden="true"> ↗</span><span class="sr-only">（新しいタブ）</span></a>`).join('')}</div>` : ''}
    <p class="small gallery-product-foot">商品情報の確認：${esc(PRODUCTS_CHECKED)}。色見本と同一の商品ではありません。選べるレンズ・度数・価格・在庫は公式ページで確認できます（売り切れ・終売になっていることもあります）。</p>`;
}
export function renderEyewearGallery(list, state = {}, size = null) {
  const { items, frame, color } = selected(list, state);
  if (!frame) return '';
  return `<section class="eyewear-gallery card" aria-label="メガネの形とレンズ色を見比べる">
    <div class="gallery-heading"><div class="label">Shape & Color</div><h2>形と色を見比べる</h2><p>気になる形とレンズの色をタップ</p></div>
    <div class="gallery-shapes" role="group" aria-label="フレームの形">${items.map(h => `<button type="button" data-gallery-shape="${esc(h.id)}" aria-pressed="${h.id === frame.id}" class="gallery-shape${h.id === frame.id ? ' on' : ''}"><img src="${image(h.id, defaultColor(h))}" alt="" width="600" height="372" loading="lazy" decoding="async"><span>${esc(h.name.replace('型サングラス', '').replace('（ブロー）', ''))}</span><small>相性 ${Math.round(h.score)}</small></button>`).join('')}</div>
    <div class="gallery-selection" role="status" aria-live="polite"><h3 data-gallery-name>${esc(frame.name)}</h3><span data-gallery-score>形の相性 ${Math.round(frame.score)}</span></div>
    <figure class="gallery-preview"><img data-gallery-image src="${image(frame.id, color.id)}" alt="${esc(frame.name)}・${color.name}の色見本" width="600" height="372" decoding="async"><figcaption>形・色の見本画像</figcaption></figure>
    <div class="gallery-color-label">レンズの色 <b data-gallery-color-name>${color.name}</b></div>
    <div class="gallery-colors" role="group" aria-label="レンズの色">${LENS_COLORS.map(c => `<button type="button" data-gallery-color="${c.id}" aria-pressed="${c.id === color.id}" class="gallery-color${c.id === color.id ? ' on' : ''}"><i style="--swatch:${c.color}" aria-hidden="true"></i><span>${c.name}</span><b aria-hidden="true">${c.id === color.id ? '✓' : ''}</b></button>`).join('')}</div>
    <p class="gallery-color-note" data-gallery-color-note>${color.note}</p>
    <p class="small gallery-disclaimer">形のおすすめは測定結果から。色は印象の見本で、色ごとの相性点は付けていません。</p>
    <div data-gallery-products>${productHTML(frame, size)}</div>
  </section>`;
}
export function updateEyewearGallery(root, list, state, size = null) {
  const { frame, color } = selected(list, state);
  if (!frame || !root) return;
  root.querySelectorAll('[data-gallery-shape]').forEach(b => { const on = b.dataset.galleryShape === frame.id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  root.querySelectorAll('[data-gallery-color]').forEach(b => { const on = b.dataset.galleryColor === color.id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.querySelector('b').textContent = on ? '✓' : ''; });
  root.querySelector('[data-gallery-name]').textContent = frame.name;
  root.querySelector('[data-gallery-score]').textContent = `形の相性 ${Math.round(frame.score)}`;
  const img = root.querySelector('[data-gallery-image]'); img.src = image(frame.id, color.id); img.alt = `${frame.name}・${color.name}の色見本`;
  root.querySelector('[data-gallery-color-name]').textContent = color.name;
  root.querySelector('[data-gallery-color-note]').textContent = color.note;
  root.querySelector('[data-gallery-products]').innerHTML = productHTML(frame, size);
}
