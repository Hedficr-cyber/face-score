// 軽量な静止画の形・色見本。顔写真やWebGLを使わず、採点と分離する。
import { PRODUCTS, PRODUCTS_CHECKED, OFFICIAL_LISTS, AVAILABILITY_CHECKED } from './eyewear-products.js';

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
// ---- 実商品の厳選（v0.16、v0.17 で強化）----
// 本人の測定に合う商品だけを出す。
// ① 形の相性：advice.js の rankGlasses の点数（顔の形・縦横比・あご幅・目元から）。おすすめは 70 点以上の形からだけ選ぶ。
// ② サイズ：瞳孔間距離から出した「レンズ幅＋ブリッジ幅」の目安（frameSize、瞳孔間距離＋2〜8mm）に、商品の公式サイズの合計が入るか（±1mm）。
// ③ いま売っている：公式ページの商品データで「在庫あり（InStock）」を確かめたものだけ（本人の指示、2026-10-21）。
// ④ 限定品を出さない：店舗限定（Limited Edition）と、オンラインと専門店だけの＜RIM＞（本人の指示）。
// ⑤ 「ホンマに似合うんか？」を出さない（本人の指示）：形が独特なコラボ・スポーツ向けなどを外し、フレームは落ち着いた定番色
//   （黒・茶・べっ甲・紺・グレー・ガンメタル・シルバー・ゴールド）、サングラスのレンズはグレー・ブラウン・グリーンだけ。
//   定番色に絞るのは、本人が見せた参考画像（大人の上品さ・落ち着いた色味）に合わせるため。測定で色の似合いは決められない。
// ⑥ 天地幅（レンズの縦）：顔の縦横比が平均より長いときは深め、短いときは浅めを先に出す（rankGlasses の depth の考え方を商品ごとに）。
const PRODUCT_FIRST = 4;
export const MIN_SHAPE_SCORE = 70;
const CLASSIC_FRAME = /ブラック|ブラウン|デミ|べっ甲|ササ|ネイビー|グレー|ガンメタル|シルバー|ゴールド|シャンパン|ブラッシュド|ポリッシュ|アリスタ/;
const LOUD = /ピンク|レッド|イエロー|パープル|オレンジ|ホワイト|ベージュ|カーキ|グリーン|ボルドー|バーガンディ|ワイン|ペール|サーモン|ブルー|シアン|ターコイズ|ミント|ラベンダー|マスタード|クリア|ライト|ファーン|ヌード/;
const CLASSIC_LENS = /グレー|ブラウン|グリーン|G-15/;
const LOUD_LENS = /ピンク|イエロー|パープル|オレンジ|ブルー|クリア|ミラー|バイオレット/;
export function classicColor(p) {
  // ホワイトゴールドは金属の落ち着いた色（白いフレームではない）
  const frame = (p.frameColor || '').replace(/ホワイトゴールド/g, 'ゴールド');
  const frameOk = CLASSIC_FRAME.test(frame) && !LOUD.test(frame);
  const lensOk = !p.lensColor || (CLASSIC_LENS.test(p.lensColor) && !LOUD_LENS.test(p.lensColor));
  return frameOk && lensOk;
}
export const onSale = (p) => p.avail === 'InStock' && !p.limited && !p.novel;
// サングラス（度なし）は、レンズの中心を瞳に合わせる必要がないので、目安より 3mm 大きいものまで認める（メガネは ±1mm）
export const isSunglasses = (p) => p.frames.some((f) => f.endsWith('-sun')) || (p.frames.includes('teardrop') && !!p.lensColor);
export function sizeFit(p, size) {
  const lb = size?.lensPlusBridge;
  if (!Array.isArray(lb) || !(p.lens > 0 && p.bridge > 0)) return null;
  const total = Math.round((p.lens + p.bridge) * 10) / 10, mid = (lb[0] + lb[1]) / 2, sun = isSunglasses(p);
  return { total, ok: total >= lb[0] - 1 && total <= lb[1] + (sun ? 3 : 1), loose: sun && total > lb[1] + 1, off: Math.abs(total - mid), range: lb };
}
// 天地幅の向き：顔の縦横比のずれ（標準偏差の単位）。0.5 より長ければ深め、−0.5 より短ければ浅めを先に
function depthNote(p, size) {
  const lean = size?.lengthLean;
  if (!(p.height > 0) || !Number.isFinite(lean) || Math.abs(lean) < 0.5) return null;
  const ratio = p.height / p.lens, want = lean > 0 ? 'deep' : 'shallow';
  const good = want === 'deep' ? ratio >= 0.78 : ratio <= 0.72;
  return { good, text: want === 'deep' ? `天地 ${p.height}mm：顔が縦長めなので、深めのレンズが縦の長さを和らげる` : `天地 ${p.height}mm：顔が短めなので、浅めのレンズがつり合う` };
}
// ⑦ 特定の顔の形の人向けとして売られている型（「for 丸顔」など）は、あなたの顔の形が同じときだけ。
//   「中顔面短縮」として売られている型は、顔が縦に長め（縦横比のずれ 0.5 以上）のときだけ
export function faceOk(p, size) {
  if (p.forFace && p.forFace !== size?.faceShape) return false;
  if (p.midface && !(size?.lengthLean >= 0.5)) return false;
  return true;
}
// この形の、いま売っていて・限定でなく・定番色で・顔の形の向きが合い・サイズが合う商品（天地幅の向きが合うものを先に、次に目安の中央に近い順）
export function fittingProducts(frameId, size) {
  const all = PRODUCTS.filter(p => p.frames.includes(frameId));
  const ok = all.filter(p => onSale(p) && classicColor(p) && faceOk(p, size));
  if (!Array.isArray(size?.lensPlusBridge)) return { all, fit: ok, sized: false };
  const fit = ok.map(p => ({ p, f: sizeFit(p, size), d: depthNote(p, size) })).filter(x => x.f?.ok)
    .sort((a, b) => (b.d?.good ? 1 : 0) - (a.d?.good ? 1 : 0) || a.f.off - b.f.off).map(x => x.p);
  return { all, fit, sized: true };
}
const fitLine = (p, size) => { const f = sizeFit(p, size); return f ? `<p class="product-fit">サイズ ${p.lens}□${p.bridge}＝${f.total}mm（あなたの目安 ${f.range[0]}〜${f.range[1]}mm${f.loose ? '。度なしのサングラスなので少し大きめも可' : ''}）</p>` : ''; };
const productCard = (p, size = null, extra = '') => `<article class="eyewear-product">${extra}<div class="product-brand">${esc(p.brand)}<span>${esc(p.sku || '')}</span></div><h4>${esc(p.name)}</h4>${p.spec ? `<p class="product-spec">${esc(p.spec)}</p>` : ''}${fitLine(p, size)}<p>${esc(p.note)}</p><a class="btn ghost block" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">公式の商品写真を見る<span aria-hidden="true"> ↗</span><span class="sr-only">（新しいタブ）</span></a></article>`;
// 似合う理由の行：形（測定から出た一番の理由）・色・天地幅
function whyLines(h, p, size) {
  const measured = (h.reasons || []).filter((r) => typeof r === 'object' && r.src === 'measure' && r.v > 0).map((r) => r.text)[0];
  const rule = (h.reasons || []).find((r) => typeof r === 'object' && r.src === 'rule')?.text;
  const lines = [`<li><b>形</b>${esc(h.name)}・相性 ${Math.round(h.score)}点。${esc(measured || rule || '')}</li>`];
  lines.push(`<li><b>色</b>${esc(p.frameColor || '')}${p.lensColor ? `／レンズ ${esc(p.lensColor)}` : ''}（落ち着いた定番色）</li>`);
  const d = depthNote(p, size);
  if (d?.good) lines.push(`<li><b>天地</b>${esc(d.text)}</li>`);
  if (p.forFace) lines.push(`<li><b>向き</b>あなたと同じ顔の形の人向けとして売られている型</li>`);
  if (p.midface) lines.push(`<li><b>向き</b>顔の中央を短く見せる設計として売られている型（顔が縦に長めなので）</li>`);
  return `<ul class="pick-why">${lines.join('')}</ul>`;
}
// あなたに似合う商品（厳選）：相性 70 点以上の形を似合う順に、条件をすべて満たす商品を形ごとに2件まで、合計6件
export const PICK_COUNT = 6;
export function pickProducts(list, size) {
  const picks = [];
  for (const h of safeItems(list).filter(h => h.score >= MIN_SHAPE_SCORE)) {
    let n = 0;
    for (const p of fittingProducts(h.id, size).fit) {
      if (n >= 2 || picks.length >= PICK_COUNT) break;
      if (picks.some((x) => x.p.sku === p.sku)) continue; // 同じ型の色違いは1件だけ
      picks.push({ h, p }); n++;
    }
    if (picks.length >= PICK_COUNT) break;
  }
  return picks;
}
export function renderPicks(list, size) {
  const picks = pickProducts(list, size);
  const lb = size?.lensPlusBridge;
  const lead = `似合う形（相性 ${MIN_SHAPE_SCORE} 点以上）の中から、${Array.isArray(lb) ? `フレームの大きさ（レンズ幅＋ブリッジ幅）があなたの目安 ${lb[0]}〜${lb[1]}mm に入り、` : ''}いま公式で在庫があり、限定品ではなく、落ち着いた定番色で、別の顔の形向けとして売られていないものだけを選びました${AVAILABILITY_CHECKED ? `（在庫は ${esc(AVAILABILITY_CHECKED)} に確認）` : ''}。`;
  // 似合う形なのに条件に合う商品がなかった形は、黙って飛ばさずに書く
  const missing = safeItems(list).filter(h => h.score >= MIN_SHAPE_SCORE && !fittingProducts(h.id, size).fit.length);
  const missingNote = missing.length ? `<p class="small pick-missing">${missing.map(h => `${esc(h.name)}（${Math.round(h.score)}点）`).join('・')}は、いまの条件に合う商品が見つからなかったので外しています。形は下の見本と公式一覧で確かめられます。</p>` : '';
  return `<section class="eyewear-picks card" aria-label="あなたに似合う商品（厳選）">
    <div class="gallery-heading"><div class="label">Selected for you</div><h2>あなたに似合う商品</h2><p>${lead}</p></div>
    ${picks.length ? `<div class="eyewear-products">${picks.map(({ h, p }) => productCard(p, size, whyLines(h, p, size))).join('')}</div>` : '<p class="small">いまの条件に合う商品が見つかりませんでした。下の形ごとの公式一覧で探せます。</p>'}
    ${missingNote}
  </section>`;
}
function productHTML(frame, size) {
  const { all, fit, sized } = fittingProducts(frame.id, size);
  const brands = [...new Set(fit.map(p => p.brand))].join('・');
  const first = fit.slice(0, PRODUCT_FIRST), rest = fit.slice(PRODUCT_FIRST);
  const lb = size?.lensPlusBridge;
  return `<h3 class="gallery-products-title">${sized ? 'あなたに合う商品' : '実際の商品を見る'}<span class="gallery-products-count">${fit.length}件</span></h3><p class="small gallery-product-note">この形の商品${all.length}件のうち、いま在庫があり・限定品ではなく・落ち着いた定番色${sized ? `で、フレームの大きさ（レンズ幅＋ブリッジ幅）があなたの目安 ${lb[0]}〜${lb[1]}mm に入る` : ''}ものだけを出しています（別の顔の形向けとして売られている型も除く）。${fit.length ? `${esc(brands)}の公式ページで確かめた商品です。` : ''}実物の写真は、各ブランドの公式ページで見られます。</p>
    <div class="eyewear-products">${first.map(p => productCard(p, size)).join('') || `<p class="small">この形で、いまの条件に合う商品は見つかりませんでした。下の公式一覧で探せます。</p>`}</div>
    ${rest.length ? `<details class="product-more"><summary>ほかの商品をあと${rest.length}件見る</summary><div class="eyewear-products">${rest.map(p => productCard(p, size)).join('')}</div></details>` : ''}
    ${(OFFICIAL_LISTS[frame.id] || []).length ? `<div class="official-lists"><p class="small">公式の一覧で、この形をもっと見る</p>${OFFICIAL_LISTS[frame.id].map(l => `<a class="official-list" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><b>${esc(l.brand)}</b>${esc(l.label)}<span aria-hidden="true"> ↗</span><span class="sr-only">（新しいタブ）</span></a>`).join('')}</div>` : ''}
    <p class="small gallery-product-foot">商品情報の確認：${esc(PRODUCTS_CHECKED)}${AVAILABILITY_CHECKED ? `、在庫の確認：${esc(AVAILABILITY_CHECKED)}` : ''}。色見本と同一の商品ではありません。選べるレンズ・度数・価格・最新の在庫は公式ページで確認できます。</p>`;
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
