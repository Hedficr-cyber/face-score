// 総合点の推移（SVG）。points は古い順の [{at, total}]
export function chartSVG(points) {
  const W = 340, H = 170, L = 30, R = 12, T = 14, B = 26;
  const vals = points.map((p) => p.total);
  let lo = Math.floor((Math.min(...vals) - 4) / 10) * 10;
  let hi = Math.ceil((Math.max(...vals) + 4) / 10) * 10;
  lo = Math.max(0, lo); hi = Math.min(100, Math.max(hi, lo + 20));
  const x = (i) => (points.length === 1 ? (L + W - R) / 2 : L + (i / (points.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const grid = [];
  for (let v = lo; v <= hi; v += 10) {
    grid.push(`<path class="grid" d="M${L} ${y(v)}H${W - R}"/><text class="axis" x="${L - 8}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`);
  }
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join('');
  const area = points.length > 1 ? `${line}L${x(points.length - 1)} ${H - B}L${x(0)} ${H - B}Z` : '';
  const dots = points.map((p, i) => `<circle class="dot${i === points.length - 1 ? ' last' : ''}" cx="${x(i)}" cy="${y(p.total)}" r="${i === points.length - 1 ? 3.6 : 2.6}"/>`).join('');
  const d0 = new Date(points[0].at), d1 = new Date(points[points.length - 1].at);
  const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="総合点の推移">
    <defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    ${grid.join('')}
    ${area ? `<path class="area" d="${area}"/>` : ''}
    <path class="line" d="${line}"/>
    ${dots}
    <text class="axis" x="${L}" y="${H - 6}">${md(d0)}</text>
    <text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${md(d1)}</text>
  </svg>`;
}
