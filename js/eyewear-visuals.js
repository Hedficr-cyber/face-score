// Front-view frame diagrams. These show shape only, never the user's face or actual fit.
// Kept as native SVG so each recommendation has a precise, lightweight example.
export const EYEWEAR_SHOWCASE = './img/eyewear-showcase-2026-10-20.png';

const SHAPES = {
  wellington: {
    name: 'ウェリントン', description: '上辺が広い、角のある逆台形', thickness: 7,
    lens: 'M 47 43 Q 88 34 135 43 Q 143 45 142 57 L 134 96 Q 132 108 119 111 L 70 111 Q 57 110 54 98 L 43 58 Q 40 47 47 43 Z',
  },
  boston: {
    name: 'ボストン', description: '上が広く、下へ丸くすぼまる形', thickness: 5,
    lens: 'M 49 43 Q 89 28 129 43 Q 145 49 140 72 Q 132 110 99 117 Q 65 118 49 91 Q 34 67 43 50 Q 45 46 49 43 Z',
  },
  round: {
    name: 'ラウンド', description: '真円に近い、丸いレンズ', thickness: 2.8,
    lens: 'M 137 77 A 42 42 0 1 1 53 77 A 42 42 0 1 1 137 77 Z',
  },
  square: {
    name: 'スクエア', description: '天地幅が浅い、横長の四角', thickness: 4,
    lens: 'M 49 49 L 135 49 Q 143 49 142 57 L 138 94 Q 137 102 129 102 L 54 102 Q 47 102 46 95 L 42 58 Q 41 50 49 49 Z',
  },
  oval: {
    name: 'オーバル', description: '横に長い、なめらかな楕円', thickness: 2.8,
    lens: 'M 142 77 A 49 30 0 1 1 44 77 A 49 30 0 1 1 142 77 Z',
  },
  browline: {
    name: 'サーモント（ブロー）', description: '上半分が太く、下半分が細いフレーム', thickness: 2.5,
    lens: 'M 48 46 Q 90 35 133 46 Q 142 49 140 62 L 135 91 Q 130 111 100 114 Q 65 114 55 95 L 44 60 Q 42 50 48 46 Z',
    brow: 'M 41 53 Q 56 39 91 39 Q 124 39 141 50 L 139 62 Q 124 48 93 48 Q 62 48 46 62 Z',
  },
  rimless: {
    name: 'フチなし（リムレス）', description: 'レンズの周囲を囲まず、留め具だけで支える形', thickness: 0.9,
    lens: 'M 48 49 Q 91 41 135 49 Q 142 51 140 60 L 135 94 Q 133 104 122 106 L 62 106 Q 52 104 49 95 L 43 60 Q 41 52 48 49 Z',
  },
  teardrop: {
    name: 'ティアドロップ', description: '外側の下へふくらむ、しずく形', thickness: 2.8,
    lens: 'M 48 44 Q 91 24 130 48 Q 145 58 140 76 Q 133 104 106 116 Q 86 125 68 110 Q 40 89 41 66 Q 40 51 48 44 Z',
  },
};

function styleOf(id, type) {
  if (typeof id !== 'string') return null;
  const shapeId = id.endsWith('-sun') ? id.slice(0, -4) : id;
  const shape = SHAPES[shapeId];
  if (!shape) return null;
  return { ...shape, shapeId, tinted: type === 'sunglasses' || id.endsWith('-sun') || id === 'teardrop' };
}

export function eyewearExampleLabel(id, type = 'glasses') {
  const s = styleOf(id, type);
  return s ? `${s.name}${s.tinted && s.shapeId !== 'teardrop' ? '型サングラス' : ''}：${s.description}。形の例で、本人の試着画像ではありません。` : '';
}

export function eyewearSVG(id, type = 'glasses') {
  const s = styleOf(id, type);
  if (!s) return '';
  const label = eyewearExampleLabel(id, type);
  const metal = '#d9c79e';
  const frame = s.thickness > 4 ? '#a79578' : metal;
  const lensFill = s.tinted ? '#52606a' : '#b8d6e3';
  const opacity = s.tinted ? '.72' : '.10';
  const rimOpacity = s.shapeId === 'rimless' ? '.44' : '1';
  const bridge = s.shapeId === 'teardrop'
    ? `<path d="M 140 59 Q 160 47 180 59 M 129 37 Q 160 29 191 37"/>`
    : `<path d="M 140 61 Q 160 49 180 61"/>`;
  const half = `<path d="${s.lens}" fill="${lensFill}" fill-opacity="${opacity}" stroke="${frame}" stroke-opacity="${rimOpacity}" stroke-width="${s.thickness}"/>`
    + (s.brow ? `<path d="${s.brow}" fill="${frame}"/>` : '')
    + `<path d="M 59 58 Q 75 51 92 52" stroke="#fff" stroke-opacity="${s.tinted ? '.19' : '.32'}" stroke-width="1.5" fill="none"/>`;
  const pads = s.thickness <= 3
    ? `<path d="M 140 76 L 144 88 M 180 76 L 176 88" stroke="${metal}" stroke-opacity=".55" stroke-width="3"/>`
    : '';
  const joints = s.shapeId === 'rimless'
    ? `<path d="M 40 63 L 50 63 M 140 63 L 145 63 M 175 63 L 180 63 M 270 63 L 280 63" stroke="${metal}" stroke-width="3"/>`
    : `<path d="M 45 56 L 51 56 M 269 56 L 275 56" stroke="${metal}" stroke-width="2.4"/>`;
  return `<svg class="eyewear-example" viewBox="0 0 320 150" width="320" height="150" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg">
    <title>${label}</title>
    <ellipse cx="160" cy="129" rx="113" ry="4" fill="#000" fill-opacity=".14" stroke="none"/>
    <g stroke-linecap="round" stroke-linejoin="round">
      <g stroke="${frame}" stroke-width="${s.thickness > 4 ? 5 : 2.6}" fill="none"><path d="M 22 72 L 43 55 M 298 72 L 277 55"/>${bridge}</g>
      ${half}<g transform="translate(320 0) scale(-1 1)">${half}</g>${pads}${joints}
    </g>
  </svg>`;
}
