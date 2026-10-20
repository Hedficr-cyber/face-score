// 軽量な静止画の形・色見本。顔写真やWebGLを使わず、採点と分離する。
import { PRODUCTS, PRODUCTS_CHECKED } from './eyewear-products.js';

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
// 実商品：最初の4件を見せ、残りは開いて見る（形ごとに10件以上あるため）
const PRODUCT_FIRST = 4;
const productCard = p => `<article class="eyewear-product"><div class="product-brand">${esc(p.brand)}<span>${esc(p.sku || '')}</span></div><h4>${esc(p.name)}</h4>${p.spec ? `<p class="product-spec">${esc(p.spec)}</p>` : ''}<p>${esc(p.note)}</p><a class="btn ghost block" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">公式の商品写真を見る<span aria-hidden="true"> ↗</span><span class="sr-only">（新しいタブ）</span></a></article>`;
function productHTML(frame) {
  const matches = PRODUCTS.filter(p => p.frames.includes(frame.id));
  const brands = [...new Set(matches.map(p => p.brand))].join('・');
  const first = matches.slice(0, PRODUCT_FIRST), rest = matches.slice(PRODUCT_FIRST);
  return `<h3 class="gallery-products-title">実際の商品を見る<span class="gallery-products-count">${matches.length}件</span></h3><p class="small gallery-product-note">${matches.length ? `${esc(brands)}の公式ページで確かめた、この形の商品です。` : ''}実物の写真は、各ブランドの公式ページで見られます。</p>
    <div class="eyewear-products">${first.map(productCard).join('') || '<p class="small">この形の商品例は準備中です。ほかの形も選んでみてください。</p>'}</div>
    ${rest.length ? `<details class="product-more"><summary>ほかの商品をあと${rest.length}件見る</summary><div class="eyewear-products">${rest.map(productCard).join('')}</div></details>` : ''}
    <p class="small gallery-product-foot">商品情報の確認：${esc(PRODUCTS_CHECKED)}。色見本と同一の商品ではありません。選べるレンズ・度数・価格・在庫は公式ページで確認できます（売り切れ・終売になっていることもあります）。</p>`;
}
export function renderEyewearGallery(list, state = {}) {
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
    <div data-gallery-products>${productHTML(frame)}</div>
  </section>`;
}
export function updateEyewearGallery(root, list, state) {
  const { frame, color } = selected(list, state);
  if (!frame || !root) return;
  root.querySelectorAll('[data-gallery-shape]').forEach(b => { const on = b.dataset.galleryShape === frame.id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  root.querySelectorAll('[data-gallery-color]').forEach(b => { const on = b.dataset.galleryColor === color.id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.querySelector('b').textContent = on ? '✓' : ''; });
  root.querySelector('[data-gallery-name]').textContent = frame.name;
  root.querySelector('[data-gallery-score]').textContent = `形の相性 ${Math.round(frame.score)}`;
  const img = root.querySelector('[data-gallery-image]'); img.src = image(frame.id, color.id); img.alt = `${frame.name}・${color.name}の色見本`;
  root.querySelector('[data-gallery-color-name]').textContent = color.name;
  root.querySelector('[data-gallery-color-note]').textContent = color.note;
  root.querySelector('[data-gallery-products]').innerHTML = productHTML(frame);
}
