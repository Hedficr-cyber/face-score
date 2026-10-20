// オフラインでも開けるようにする。版を上げたら CACHE の名前も変える。
const CACHE = 'face-score-0.7.4';
// 顔の検出のライブラリとモデル（約15MB）は版と別に持つ。MediaPipe やモデルを入れ替えたときだけ名前を変える
const ASSETS = 'face-score-assets-mp1.0.1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/store.js', 'js/analysis.js', 'js/advice.js', 'js/catalog.js', 'js/config.js',
  'js/geometry.js', 'js/mesh-data.js', 'js/portrait.js', 'js/chart.js', 'js/capture.js', 'js/detector.js', 'js/version.js', 'js/hairline.js', 'js/calibration.js',
  'js/attractiveness-features.js', 'js/relative-score.js', 'js/research-score.js', 'js/research-reference.js', 'js/import.js', 'js/record-camera.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png', 'img/cg-minus3.jpg', 'img/cg-0.jpg', 'img/cg-plus3.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('face-score-') && k !== CACHE && k !== ASSETS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 大きいライブラリとモデルは一度取ったら手元のものを使う
  if (url.pathname.includes('/vendor/') || url.pathname.includes('/models/')) {
    e.respondWith(caches.open(ASSETS).then((c) => c.match(e.request)).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(e.request, copy)); }
      return res;
    })));
    return;
  }
  // それ以外は新しいものを優先し、つながらないときは手元のものを使う
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html'))));
});
