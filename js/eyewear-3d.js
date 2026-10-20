// メガネ・サングラスの3D描画（v0.13・2026-10-20）。three.js r160（vendor/three、MIT）を端末の中だけで使う。外部への通信はしない。
// ・buildFrame：eyewear-models.js の仕様（mm）から、セル（面取り＋上塗りの光沢）・金属線・ブリッジ・鋲・ヒンジ・つる・鼻パッド・
//   光を通すレンズを組み立てる。原点＝ブリッジの中央（玉型の中心の高さ）、x＝右、y＝上、z＝手前。
// ・renderProduct：明るい背景で斜め前から撮った商品写真風の画像（data URL）を作る。
// ・TryOnStage：写真（または映像）の上に、顔の点から求めた向き・位置・実寸でフレームを重ねる。顔の面に影を落とし、
//   顔と頭の面で奥のつるを隠す。
import * as THREE from '../vendor/three/three.module.min.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { FRAMES, MATERIALS, LENSES, lensOutline, fittedSize } from './eyewear-models.js';
import { FACE_TRIANGLES } from './face-triangles.js';
import { alignToCanonical } from './geometry.js';

const v2 = ([x, y]) => new THREE.Vector2(x, y);

// 外形を外側へ広げる（反時計回りの点列。widthAt(点, 番号) の幅だけ外へ）
function offsetOutline(pts, widthAt) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const w = widthAt(p, i);
    return [p[0] + ty * w, p[1] - tx * w];
  });
}
const mirror = (pts) => pts.map(([x, y]) => [-x, y]).reverse();
const shift = (pts, dx) => pts.map(([x, y]) => [x + dx, y]);

// べっ甲柄（決まった乱数で毎回同じ柄）
let tortoiseTex = null;
function tortoiseTexture() {
  if (tortoiseTex || typeof document === 'undefined') return tortoiseTex;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#9a6430'; g.fillRect(0, 0, 512, 512);
  const blob = (x, y, r, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col.replace('A', a)); gr.addColorStop(1, col.replace('A', 0)); g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * (0.45 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2); g.fill(); };
  for (let i = 0; i < 70; i++) blob(rnd() * 512, rnd() * 512, 30 + rnd() * 70, 'rgba(206,150,74,A)', 0.55);
  for (let i = 0; i < 160; i++) blob(rnd() * 512, rnd() * 512, 10 + rnd() * 46, 'rgba(38,18,8,A)', 0.85);
  for (let i = 0; i < 90; i++) blob(rnd() * 512, rnd() * 512, 6 + rnd() * 18, 'rgba(18,8,3,A)', 0.9);
  tortoiseTex = new THREE.CanvasTexture(c);
  tortoiseTex.wrapS = tortoiseTex.wrapT = THREE.RepeatWrapping;
  tortoiseTex.repeat.set(1 / 34, 1 / 34);
  tortoiseTex.colorSpace = THREE.SRGBColorSpace;
  return tortoiseTex;
}
// グラデーションのレンズ（上が濃く下が薄い）
const gradientTex = new Map();
function lensGradient(top, bottom) {
  const key = top + bottom;
  if (gradientTex.has(key) || typeof document === 'undefined') return gradientTex.get(key) || null;
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(0.45, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  gradientTex.set(key, t); return t;
}

function material(key, { brow = false } = {}) {
  const m = MATERIALS[key];
  if (m.kind === 'metal') return new THREE.MeshStandardMaterial({ color: m.color, metalness: 1, roughness: 0.24, envMapIntensity: 1.25 });
  const opts = { color: m.color, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.55 };
  if (m.pattern === 'tortoise') { opts.map = tortoiseTexture(); opts.color = '#ffffff'; }
  if (m.clear) Object.assign(opts, { transmission: 0.75, thickness: 4, roughness: 0.12 });
  if (brow) opts.roughness = 0.26;
  return new THREE.MeshPhysicalMaterial(opts);
}
function lensMaterial(key) {
  const L = LENSES[key];
  const opts = { color: L.tint, transmission: 1, thickness: 1.2, ior: 1.5, roughness: 0.03, metalness: 0, specularIntensity: 1, envMapIntensity: 1.35, side: THREE.DoubleSide };
  if (L.tintBottom) { opts.map = lensGradient(L.tint, L.tintBottom); opts.color = '#ffffff'; }
  return new THREE.MeshPhysicalMaterial(opts);
}
const rivetMat = () => new THREE.MeshStandardMaterial({ color: '#d8dade', metalness: 1, roughness: 0.18, envMapIntensity: 1.3 });
const padMat = () => new THREE.MeshPhysicalMaterial({ color: '#f4f4f2', transmission: 0.85, thickness: 2, roughness: 0.25, envMapIntensity: 0.8 });
const tipMat = () => new THREE.MeshPhysicalMaterial({ color: '#141414', roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.1 });

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
// セルの板を面取りして押し出す（前面が z＝+depth/2）
function slab(shape, depth, mat, bevel = 0.7) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.2, depth - 2 * bevel), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4, curveSegments: 6, steps: 1 });
  geo.translate(0, 0, -depth / 2 + bevel);
  const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; return mesh;
}
// レンズ：玉型の面を、ベースカーブ（半径 120mm）の球面に沿わせる
function lensMesh(outline, mat, A, B, curveR = 120) {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(outline.map(v2)), 1);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, -(x * x + y * y) / (2 * curveR));
    uv.setXY(i, (x + A / 2) / A, (y + B / 2) / B);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 2; return mesh;
}
function tube(points, radius, mat, closed = false, seg = 64) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, seg, radius, 10, closed), mat); mesh.castShadow = true; return mesh;
}

// 右半分（+x）を作り、左右反転したものと合わせる。cx＝玉型の中心の x
function buildHalf(spec, A, B, bridge, side, mats) {
  const half = new THREE.Group();
  const cx = side * (A / 2 + bridge / 2);
  const base = lensOutline(spec.shape, A);
  const lens = side > 0 ? shift(base, cx) : shift(mirror(base), cx);
  const isMetal = MATERIALS[spec.material].kind === 'metal';
  const hb = B / 2;
  // 外側の上（ヒンジ）の位置
  const outerX = Math.max(...lens.map((p) => side * p[0])) * side;
  let hingeY = hb - Math.min(6, B * 0.18), hingeX, frontDepth;
  if (spec.rimless) {
    // フチなし：縁を磨いたレンズ（厚み 2mm）と、外側・鼻側の留め具
    const lm = lensMesh(lens.map(([x, y]) => [x - cx, y]), mats.lens, A, B); lm.position.x = cx; half.add(lm);
    const edge = tube(lens.map(([x, y]) => [x, y, -0.2]), 0.35, new THREE.MeshPhysicalMaterial({ color: '#dfe6e8', transmission: 0.6, roughness: 0.15, thickness: 1, envMapIntensity: 1.2 }), true, 200);
    edge.castShadow = false; half.add(edge);
    hingeX = outerX + side * 4; frontDepth = 2;
    const mount = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 2.4), mats.frame); mount.position.set(outerX + side * 1.5, hingeY, 0); mount.castShadow = true; half.add(mount);
    for (const dy of [-0.9, 0.9]) { const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 2.8, 12), mats.rivet); screw.rotation.x = Math.PI / 2; screw.position.set(outerX - side * 1.2, hingeY + dy, 0.3); half.add(screw); }
  } else if (isMetal) {
    // 金属の縁：玉型に沿った丸線（レンズの縁が線の中に入るよう少し外へ）
    const wire = spec.metal.wire;
    const rim = offsetOutline(lens, () => wire * 0.55);
    half.add(tube(rim.map(([x, y]) => [x, y, 0]), wire, mats.frame, true, 220));
    const lm = lensMesh(lens.map(([x, y]) => [x - cx, y]), mats.lens, A, B); lm.position.x = cx; half.add(lm);
    hingeX = outerX + side * (wire + 3.2); frontDepth = wire * 2;
    // 外側の留め具（智）とヒンジ
    half.add(tube([[outerX, hingeY, 0], [outerX + side * 1.8, hingeY + 0.2, -0.6], [hingeX, hingeY, -2]], wire * 0.95, mats.frame, false, 12));
    const hinge = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.6, 3.2), mats.frame); hinge.position.set(hingeX, hingeY, -2.6); hinge.castShadow = true; half.add(hinge);
  } else {
    // セルの縁：上を太く下を細く
    const r = spec.rim;
    const rim = offsetOutline(lens, ([, y]) => { const s = y / hb; return r.side + (s > 0 ? (r.top - r.side) * s * s : (r.bottom - r.side) * s * s); });
    const shape = new THREE.Shape(rim.map(v2)); shape.holes.push(new THREE.Path(lens.map(v2)));
    half.add(slab(shape, r.depth, mats.frame));
    // 鼻側のくぼみの奥に見えるレンズ
    const lm = lensMesh(lens.map(([x, y]) => [x - cx, y]), mats.lens, A, B); lm.position.x = cx; half.add(lm);
    // 外側の上の張り出し（智）
    const rimOuterX = Math.max(...rim.map((p) => side * p[0])) * side;
    const endW = 5.5, endH = Math.min(7, r.top + 3.5);
    const end = slab(roundedRect(endW, endH, 1.4), r.depth, mats.frame, 0.6);
    end.position.set(rimOuterX - side * (endW / 2 - 2.2), hb - endH / 2 + r.top * 0.55, 0); half.add(end);
    hingeY = end.position.y; hingeX = rimOuterX + side * 2; frontDepth = r.depth;
    // 鋲（前面の飾りピン）
    for (let k = 0; k < (spec.rivets || 0); k++) {
      const rv = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.7, 16), mats.rivet); rv.rotation.x = Math.PI / 2;
      rv.position.set(rimOuterX - side * (2.6 + k * 2.6), hingeY + 0.2, r.depth / 2 + 0.05); half.add(rv);
    }
  }
  // サーモント：上半分にセルの眉
  if (spec.brow) {
    const up = lens.filter(([, y]) => y > -B * 0.04);
    const ordered = up.slice().sort((p, q) => side * (q[0] - p[0]));
    const outer = offsetOutline(lens, ([, y]) => 1.2 + (spec.brow.top - 1.2) * Math.max(0, y / hb) ** 1.4).filter((_, i) => lens[i][1] > -B * 0.04);
    const outerOrdered = outer.slice().sort((p, q) => side * (q[0] - p[0]));
    const shape = new THREE.Shape([...outerOrdered, ...ordered.slice().reverse()].map(v2));
    const brow = slab(shape, spec.brow.depth, mats.brow, 0.8); brow.position.z = 0.4; half.add(brow);
    for (let k = 0; k < (spec.rivets || 0); k++) {
      const rv = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.7, 16), mats.rivet); rv.rotation.x = Math.PI / 2;
      rv.position.set(outerX - side * 4, hb + 1.2, spec.brow.depth / 2 + 0.45); half.add(rv);
    }
    hingeY = hb - 1; frontDepth = spec.brow.depth;
  }
  // 鼻パッド（金属・フチなし・サーモント）
  if (spec.pads) {
    const nasal = lens.reduce((best, p) => (side * p[0] < side * best[0] && p[1] < hb * 0.2 && p[1] > -hb * 0.6 ? p : best), [cx, 0]);
    const start = [nasal[0] - side * 0.4, nasal[1] - 1, -0.6], end = [nasal[0] - side * 3.2, nasal[1] - 5, -7];
    half.add(tube([start, [start[0] - side * 1.5, start[1] - 2.5, -3], end], 0.42, mats.frame, false, 16));
    const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mats.pad);
    pad.scale.set(2.3, 3.8, 0.85); pad.position.set(end[0] - side * 0.6, end[1] - 0.5, end[2] - 0.6); pad.rotation.y = side * 0.55; pad.castShadow = true; half.add(pad);
  }
  // つる：ヒンジを軸に回せるよう、ヒンジに置いた入れ物の中に作る（後ろへ、少し外へ開き、耳の後ろで下へ曲がる）。
  // 試着では、耳の位置（TEMPLE_EAR 番目の点）が本人の耳の付け根に来るように入れ物を回す（aimTemples）
  const L = spec.size.temple;
  const pivot = new THREE.Group(); pivot.position.set(hingeX, hingeY, -frontDepth / 2 - 1.2); half.add(pivot);
  const path = [[0, 0, 0], [side * 2, -0.3, -L * 0.25], [side * 5, -1.4, -L * 0.6], [side * 6.5, -3.5, -L * 0.8], [side * 5.5, -16, -L * 0.97]];
  let tip;
  if (isMetal || spec.rimless || spec.brow) {
    const wire = (spec.metal?.wire || 0.7) * 1.05;
    pivot.add(tube(path.slice(0, 4), wire, mats.frame, false, 48));
    tip = tube(path.slice(3), wire * 2.1, mats.tip, false, 24);
  } else {
    const prof = roundedRect(2.4, 4.2, 0.9);
    const along = (pts, steps) => { const t = new THREE.Mesh(new THREE.ExtrudeGeometry(prof, { steps, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal') }), mats.frame); t.castShadow = true; return t; };
    pivot.add(along(path.slice(0, 4), 70));
    tip = along([path[2], path[3], path[4]], 24);
  }
  pivot.add(tip);
  half.userData.temple = { pivot, side, tip, ear: new THREE.Vector3(...path[3]) };
  return half;
}

function buildBridge(spec, A, B, bridge, mats) {
  const g = new THREE.Group();
  const hb = B / 2, xn = bridge / 2;
  const isMetal = MATERIALS[spec.material].kind === 'metal' || spec.rimless;
  if (!isMetal && spec.bridge !== 'metal') {
    // セルの山（鍵穴は下側のアーチを高く）
    const r = spec.rim, key = spec.bridge === 'keyhole';
    const xe = xn - r.side * 0.5; // 鼻側の縁の中ほど（レンズの内側には入らない）
    const top = hb + r.top * 0.55, low = hb - (key ? 9 : 6.5), apex = top - (key ? 3.2 : 3.9);
    const s = new THREE.Shape();
    s.moveTo(-xe, top); s.quadraticCurveTo(0, top - 0.4, xe, top);
    s.lineTo(xe, low);
    if (key) { s.lineTo(xe - 1.6, low); s.quadraticCurveTo(xe - 2.4, apex - 1.4, 0, apex); s.quadraticCurveTo(-xe + 2.4, apex - 1.4, -xe + 1.6, low); }
    else s.quadraticCurveTo(0, apex - 1, -xe, low);
    s.lineTo(-xe, top);
    g.add(slab(s, r.depth - 0.4, mats.frame));
    return g;
  }
  const wire = (spec.metal?.wire || 0.6) * 1.1, y = hb - Math.min(5, B * 0.14);
  // ブリッジ幅は玉型の外接矩形どうしの距離。丸型の上寄りでは鼻側の縁が外接矩形より内へ離れるので、
  // 実際の輪郭との交点まで線を伸ばす（固定の bridge/2 ではブリッジが宙に浮いてしまう）。
  const outline = lensOutline(spec.shape, A);
  const nasalX = (atY) => {
    const intersections = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      if ((a[1] <= atY && b[1] > atY) || (b[1] <= atY && a[1] > atY)) intersections.push(a[0] + (b[0] - a[0]) * (atY - a[1]) / (b[1] - a[1]));
    }
    return A / 2 + xn + Math.min(...intersections);
  };
  const ends = nasalX(y);
  g.add(tube([[ends, y, 0], [ends * 0.45, y + 2.2, 0.8], [0, y + 2.8, 1], [-ends * 0.45, y + 2.2, 0.8], [-ends, y, 0]], wire, mats.frame, false, 40));
  if (spec.bridge === 'double') {
    const yTop = hb - Math.min(1.5, B * 0.03), endsTop = nasalX(yTop);
    g.add(tube([[endsTop, yTop, 0], [0, hb + 1.6, 0.6], [-endsTop, yTop, 0]], wire * 0.95, mats.frame, false, 40));
  }
  return g;
}

// 組み立て。pdMm：本人の瞳孔間距離（mm）。あればレンズ幅を合わせる
export function buildFrame(id, { pdMm = null } = {}) {
  const spec = Object.hasOwn(FRAMES, id) ? FRAMES[id] : null;
  if (!spec) throw new Error('unknown frame ' + id);
  const size = fittedSize(spec, pdMm);
  const A = size.lens, B = size.height, bridge = size.bridge;
  const mats = { frame: material(spec.material), brow: spec.browMaterial ? material(spec.browMaterial, { brow: true }) : null, lens: lensMaterial(spec.lens), rivet: rivetMat(), pad: padMat(), tip: tipMat() };
  const root = new THREE.Group(), temples = [];
  const wrap = THREE.MathUtils.degToRad(5);
  for (const side of [1, -1]) {
    const half = buildHalf(spec, A, B, bridge, side, mats);
    const pivot = new THREE.Group(); pivot.add(half); pivot.rotation.y = side * wrap * 0.5; root.add(pivot);
    temples.push(half);
  }
  root.add(buildBridge(spec, A, B, bridge, mats));
  root.userData = { id, size, spec, temples };
  return root;
}

// つるを耳へ向ける。ears：{ right, left }（世界座標。right＝見る人から見て右）
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion();
export function aimTemples(frame, ears) {
  // 顔のアンカーもこのフレームで更新してから世界座標→局所座標を計算する。
  frame.updateWorldMatrix(true, true);
  for (const half of frame.userData.temples || []) {
    const t = half.userData.temple, target = t.side > 0 ? ears.right : ears.left;
    if (!target) continue;
    t.tip.visible = false;
    t.pivot.quaternion.identity(); t.pivot.updateMatrixWorld(true);
    _a.copy(t.ear).normalize();
    _b.copy(target); t.pivot.worldToLocal(_b); _b.normalize();
    _q.setFromUnitVectors(_a, _b); t.pivot.quaternion.copy(_q);
  }
}

// ---- 環境光（スタジオの映り込み）----
function studio(renderer) {
  const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment(renderer);
  try { return pm.fromScene(room, 0.04); }
  finally { room.dispose(); pm.dispose(); }
}
function makeRenderer(canvas, alpha = false) {
  let r;
  try { r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); }
  catch (cause) { const e = new Error('この環境では3D表示を使えません。WebGLに対応したブラウザで開いてください。', { cause }); e.code = 'WEBGL_UNAVAILABLE'; throw e; }
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.NoToneMapping;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  return r;
}
function disposeTree(o) {
  const resources = new Set();
  o.traverse((c) => { if (c.geometry) resources.add(c.geometry); if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => resources.add(m)); });
  for (const resource of resources) resource.dispose();
}

// ---- 商品写真風の画像 ----
let product = null;
const productCache = new Map();
function productStudio() {
  if (product) return product;
  const canvas = document.createElement('canvas');
  const renderer = makeRenderer(canvas);
  renderer.setPixelRatio(1); renderer.setSize(900, 560, false);
  const scene = new THREE.Scene();
  const environment = studio(renderer); scene.environment = environment.texture;
  // 背景の壁（レンズを透かして見えるよう不透明の面として置く）と、影を受ける床
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4000, 3000), new THREE.MeshBasicMaterial({ color: '#ecebe7', toneMapped: false }));
  wall.position.set(0, 0, -400); scene.add(wall);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.ShadowMaterial({ opacity: 0.16 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const key = new THREE.DirectionalLight('#ffffff', 1.9); key.position.set(-160, 340, 260); key.castShadow = true;
  Object.assign(key.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 10, far: 1200 });
  key.shadow.mapSize.set(2048, 2048); key.shadow.radius = 6; key.shadow.bias = -0.0004;
  scene.add(key, key.target, new THREE.HemisphereLight('#ffffff', '#d8d4cc', 0.5));
  const camera = new THREE.PerspectiveCamera(20, 900 / 560, 10, 3000);
  product = { canvas, renderer, scene, camera, floor, environment };
  return product;
}
export async function renderProduct(id) {
  if (!Object.hasOwn(FRAMES, id)) throw new Error('unknown frame ' + id);
  if (productCache.has(id)) return productCache.get(id);
  const P = productStudio(), frame = buildFrame(id);
  const holder = new THREE.Group(); holder.add(frame);
  holder.rotation.set(0.1, -0.5, 0);
  P.scene.add(holder);
  try {
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    P.floor.position.y = box.min.y - 4;
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const dist = (Math.max(sz.x / P.camera.aspect, sz.y) * 1.32) / (2 * Math.tan(THREE.MathUtils.degToRad(P.camera.fov / 2)));
    P.camera.position.set(c.x, c.y + dist * 0.2, c.z + dist);
    P.camera.lookAt(c.x, c.y - sz.y * 0.05, c.z);
    P.renderer.render(P.scene, P.camera);
    const url = P.canvas.toDataURL('image/jpeg', 0.9);
    productCache.set(id, url);
    return url;
  } finally { P.scene.remove(holder); disposeTree(holder); }
}
// カードを離れる際にGPUを解放。商品画像のキャッシュは顔を含まないdata URLだけ。
export function disposeProductRenderer({ clearCache = false } = {}) {
  if (product) {
    disposeTree(product.scene); product.scene.environment = null; product.environment.dispose();
    product.scene.traverse((o) => o.shadow?.dispose());
    product.renderer.dispose(); product.renderer.forceContextLoss(); product = null;
  }
  if (clearCache) productCache.clear();
}

// ---- 写真・映像に重ねる試着 ----
// 顔の点（478点、0〜1の座標。z は x と同じ尺度）を、写真の画素の座標（x 右・y 上・z 手前）にする
function facePoints(lm, W, H) { return lm.map((p) => { const [x, y, z] = Array.isArray(p) ? p : [p.x, p.y, p.z]; return new THREE.Vector3(x * W, (1 - y) * H, -z * W); }); }

export class TryOnStage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = makeRenderer(canvas);
    this.scene = new THREE.Scene();
    this.environment = studio(this.renderer); this.scene.environment = this.environment.texture;
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 20000);
    this.camera.position.set(0, 0, 8000);
    this.key = new THREE.DirectionalLight('#ffffff', 1.7); this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048); this.key.shadow.bias = -0.0006; this.key.shadow.normalBias = 0.6;
    this.scene.add(this.key, this.key.target, new THREE.HemisphereLight('#ffffff', '#b8b0a6', 0.55));
    this.photo = null; this.face = null; this.frame = null; this.frameId = null; this.pdMm = null; this.W = 1; this.H = 1;
    this.anchor = new THREE.Group(); this.anchor.matrixAutoUpdate = false; this.anchor.visible = false; this.scene.add(this.anchor);
    this.disposed = false;
  }
  // 写真（ImageBitmap・画像・canvas）または映像（video）
  setSource(source, W, H) {
    this.assertActive();
    if (!source || ![W, H].every((v) => Number.isFinite(v) && v > 0 && v <= 16384) || W * H > 67108864) throw new Error('invalid source dimensions');
    this.clearFace(); this.W = W; this.H = H;
    if (this.photo) { this.scene.remove(this.photo); this.photo.material.map?.dispose(); this.photo.material.dispose(); this.photo.geometry.dispose(); }
    const tex = typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement ? new THREE.VideoTexture(source) : new THREE.Texture(source);
    tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
    this.photo = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, depthWrite: false }));
    this.photo.renderOrder = -10;
    this.photo.position.set(W / 2, H / 2, -6000); this.scene.add(this.photo);
    Object.assign(this.camera, { left: 0, right: W, top: H, bottom: 0 }); this.camera.updateProjectionMatrix();
  }
  resize(cssW, cssH) {
    this.assertActive();
    if (![cssW, cssH].every((v) => Number.isFinite(v) && v > 0 && v <= 8192)) throw new Error('invalid canvas dimensions');
    this.renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    this.renderer.setSize(cssW, cssH, false);
  }
  setFrame(id) {
    this.assertActive(); if (!Object.hasOwn(FRAMES, id)) throw new Error('unknown frame ' + id);
    if (id === this.frameId && this.frame) return;
    if (this.frame) { this.anchor.remove(this.frame); disposeTree(this.frame); }
    this.frameId = id;
    this.frame = buildFrame(id, { pdMm: this.pdMm });
    this.anchor.add(this.frame);
    if (this.ears) aimTemples(this.frame, this.ears);
  }
  setPd(pdMm) {
    this.assertActive();
    const value = Number.isFinite(pdMm) && pdMm >= 50 && pdMm <= 80 ? pdMm : null;
    if (value !== this.pdMm) {
      this.pdMm = value;
      const id = this.frameId; this.frameId = null; if (id) this.setFrame(id);
      // 倍率も変わるので、すでに検出済みの顔を再配置する。
      if (this.landmarks) this.setFace(this.landmarks);
    }
  }
  // 顔の点から、位置・向き・実寸の倍率を決め、顔の面（影を受ける面と、隠す面）を作り直す
  setFace(landmarks) {
    this.assertActive();
    const valid = Array.isArray(landmarks) && landmarks.length === 478 && Array.from(landmarks).every((p) => {
      const xyz = Array.isArray(p) ? p : p && [p.x, p.y, p.z];
      return xyz && xyz.length >= 3 && xyz.slice(0, 3).every((v) => Number.isFinite(v) && Math.abs(v) <= 100);
    });
    if (!valid || !this.photo) { this.clearFace(); return false; }
    const P = facePoints(landmarks, this.W, this.H);
    const irisR = P[468], irisL = P[473];
    // 顔の向き：標準の顔の形（MediaPipe の標準顔）に重ねたときの回転。R は「検出→正面」なので、頭の向きの軸は R の各行
    if (P[468].distanceTo(P[473]) < 1 || P[234].distanceTo(P[454]) < 1 || P[10].distanceTo(P[152]) < 1) { this.clearFace(); return false; }
    const { R, scale } = alignToCanonical(P.map((p) => [p.x, p.y, p.z]));
    if (!Number.isFinite(scale) || !R.flat().every(Number.isFinite)) { this.clearFace(); return false; }
    const X = new THREE.Vector3(...R[0]).normalize(), Y = new THREE.Vector3(...R[1]).normalize(), Z = new THREE.Vector3(...R[2]).normalize();
    const pdPx = irisR.distanceTo(irisL);
    const pd = Number.isFinite(this.pdMm) ? this.pdMm : 63;
    const s = pdPx / pd; // 1mm あたりの画素
    const mid = new THREE.Vector3().addVectors(irisR, irisL).multiplyScalar(0.5);
    // 玉型の中心は瞳より約3mm下。検出した黒目の奥行きは角膜表面と一致しないので、
    // 瞳から12mmだけ前へ出すと鼻の付け根へ埋まる場合がある。鼻根の表面からも4mm離す
    // 近似を併用する。写真の深さ推定による見本であり、実物の装用位置/寸法の保証ではない。
    const bridgeDepth = P[168].clone().sub(mid).dot(Z);
    const clearance = Math.max(12 * s, bridgeDepth + 4 * s);
    const origin = mid.clone().addScaledVector(Y, -3 * s).addScaledVector(Z, clearance);
    const m = new THREE.Matrix4().makeBasis(X.clone().multiplyScalar(s), Y.clone().multiplyScalar(s), Z.clone().multiplyScalar(s)); m.setPosition(origin);
    this.anchor.matrix.copy(m); this.anchor.matrixWorldNeedsUpdate = true;
    this.scale = s;
    // 顔の面
    if (!this.faceGeo) {
      this.faceGeo = new THREE.BufferGeometry();
      this.faceGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(468 * 3), 3));
      this.faceGeo.setIndex(new THREE.BufferAttribute(FACE_TRIANGLES, 1));
      const occ = new THREE.Mesh(this.faceGeo, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })); occ.renderOrder = -2;
      const shade = new THREE.Mesh(this.faceGeo, new THREE.ShadowMaterial({ opacity: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      shade.receiveShadow = true; shade.renderOrder = -1;
      this.head = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshBasicMaterial({ colorWrite: false })); this.head.renderOrder = -2; this.head.matrixAutoUpdate = false;
      this.occluder = occ; this.shade = shade; this.scene.add(occ, shade, this.head);
    }
    const pos = this.faceGeo.attributes.position;
    for (let i = 0; i < 468; i++) pos.setXYZ(i, P[i].x, P[i].y, P[i].z);
    pos.needsUpdate = true; this.faceGeo.computeBoundingSphere();
    // 頭の奥（耳のあたりまで）を楕円体で隠す：奥のつるが顔の向こうに隠れるように
    const fw = P[234].distanceTo(P[454]), fh = P[10].distanceTo(P[152]);
    const center = new THREE.Vector3().addVectors(P[234], P[454]).multiplyScalar(0.5).addScaledVector(Z, -0.5 * fw);
    const hm = new THREE.Matrix4().makeBasis(X.clone().multiplyScalar(fw * 0.5), Y.clone().multiplyScalar(fh * 0.62), Z.clone().multiplyScalar(fw * 0.6));
    hm.setPosition(center); this.head.matrix.copy(hm); this.head.matrixWorldNeedsUpdate = true;
    // 光：顔の上・少し左・手前から。影の範囲は顔のまわり
    this.key.position.copy(origin).addScaledVector(Y, 700 * s).addScaledVector(X, -180 * s).addScaledVector(Z, 900 * s);
    this.key.target.position.copy(origin);
    const c = this.key.shadow.camera; const r = 110 * s;
    Object.assign(c, { left: -r, right: r, top: r, bottom: -r, near: 10, far: 3000 * s }); c.updateProjectionMatrix();
    // 耳の付け根（顔の横の点 234・454 から、上へ 4mm・後ろへ 6mm・外へ 3mm）。見る人から見て右の点を right に
    const ear = (p, out) => { const q = p.clone(); q.addScaledVector(Y, mid.clone().sub(p).dot(Y) + 2 * s); return q.addScaledVector(Z, -6 * s).addScaledVector(X, out * 3 * s); };
    const rightIs454 = P[454].clone().sub(origin).dot(X) > 0;
    this.ears = { right: ear(rightIs454 ? P[454] : P[234], 1), left: ear(rightIs454 ? P[234] : P[454], -1) };
    if (this.frame) aimTemples(this.frame, this.ears);
    this.face = P; this.landmarks = landmarks;
    this.anchor.visible = this.occluder.visible = this.shade.visible = this.head.visible = true;
    return true;
  }
  // 検出が途切れたフレームでは顔/メガネだけ隠し、元の映像は表示し続ける。
  clearFace() {
    this.face = this.landmarks = this.ears = null; this.scale = null;
    this.anchor.visible = false;
    for (const o of [this.occluder, this.shade, this.head]) if (o) o.visible = false;
  }
  // 画面を閉じる/写真を消すときに、写真テクスチャと顔の座標も解放する。
  clear() {
    if (this.disposed) return;
    this.clearFace();
    if (this.photo) {
      this.scene.remove(this.photo); this.photo.material.map.dispose(); this.photo.material.map = null;
      disposeTree(this.photo); this.photo = null;
    }
    if (this.frame) { this.anchor.remove(this.frame); disposeTree(this.frame); this.frame = null; }
    for (const o of [this.occluder, this.shade, this.head]) if (o) { this.scene.remove(o); disposeTree(o); }
    this.faceGeo = this.occluder = this.shade = this.head = null; this.frameId = null;
    this.anchor.matrix.identity(); this.anchor.matrixWorldNeedsUpdate = true;
    this.key.position.set(0, 1, 1); this.key.target.position.set(0, 0, 0);
    this.pdMm = null; this.W = this.H = 1;
    this.renderer.clear();
  }
  assertActive() { if (this.disposed) throw new Error('3D stage is disposed'); }
  render() { this.assertActive(); this.renderer.render(this.scene, this.camera); }
  snapshot(type = 'image/jpeg', q = 0.92) { this.assertActive(); this.render(); return this.canvas.toDataURL(type, q); }
  dispose() {
    if (this.disposed) return;
    this.clear(); disposeTree(this.scene); this.scene.environment = null; this.environment.dispose();
    this.key.shadow.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss();
    this.scene.clear(); this.disposed = true;
  }
}
