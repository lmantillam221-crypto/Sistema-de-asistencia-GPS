/* Gráficos SVG livianos (sin librerías), con tooltips accesibles. */
import { esc } from './util.js';

/** Barras verticales. items: [{etiqueta, valor, color, tip, marca?}] */
export function barras(items, { alto = 240, lineas = [], unidad = '', max = null, etiquetaCada = null, aria = 'Gráfico de barras' } = {}) {
  const W = 720, H = alto, L = 44, R = 12, T = 16, B = 34, iw = W - L - R, ih = H - T - B;
  const maxY = (max ?? Math.max(1, ...items.map((i) => i.valor), ...lineas.map((l) => l.valor))) * 1.1;
  const y = (v) => T + ih - (v / maxY) * ih;
  const paso = items.length ? iw / items.length : 0, bw = Math.max(2, Math.min(34, paso - 3));
  const cada = etiquetaCada || Math.max(1, Math.ceil(items.length / 12));
  const ticks = [0, Math.round(maxY / 1.1 / 2), Math.round(maxY / 1.1)].filter((v, i, a) => a.indexOf(v) === i);
  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#f0dbe4"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10.5" fill="#7a5b6b">${v}</text>`).join('')}
    ${lineas.map((l) => `<line x1="${L}" x2="${W - R}" y1="${y(l.valor)}" y2="${y(l.valor)}" stroke="${l.color || '#e0a100'}" stroke-dasharray="5 4" stroke-width="1.5"/>`).join('')}
    ${items.map((it, i) => {
      const x = L + i * paso + (paso - bw) / 2, h = Math.max(it.valor > 0 ? 3 : 2, T + ih - y(it.valor));
      return `<g data-tip="${esc(it.tip || `${it.etiqueta}: ${it.valor}${unidad}`)}"><rect x="${L + i * paso}" y="${T}" width="${paso}" height="${ih}" fill="transparent"/>
        <rect x="${x}" y="${T + ih - h}" width="${bw}" height="${h}" rx="${Math.min(4, bw / 3)}" fill="${it.color || '#ff6f98'}"/>
        ${it.marca && bw > 10 ? `<text x="${x + bw / 2}" y="${T + ih - h + 13}" text-anchor="middle" font-size="10" font-weight="800" fill="#fff">${esc(it.marca)}</text>` : ''}</g>`;
    }).join('')}
    ${items.map((it, i) => (i % cada ? '' : `<text x="${L + i * paso + paso / 2}" y="${H - 12}" text-anchor="middle" font-size="10.5" fill="#7a5b6b">${esc(it.etiqueta)}</text>`)).join('')}
    ${unidad ? `<text x="4" y="${T + 4}" font-size="10" fill="#7a5b6b">${esc(unidad.trim())}</text>` : ''}
  </svg>`;
}

/** Dona con texto central. segs: [[etiqueta, valor, color]] */
export function dona(segs, { centro = '', sub = '' } = {}) {
  const total = segs.reduce((s, x) => s + x[1], 0);
  const Rr = 70, rr = 46, cx = 85, cy = 85;
  let ang = -Math.PI / 2;
  const vis = segs.filter((s) => s[1] > 0);
  const arcos = vis.map(([t, n, c]) => {
    const frac = n / total, gap = vis.length > 1 ? 0.025 : 0, a0 = ang + gap, a1 = ang + frac * Math.PI * 2 - gap;
    ang += frac * Math.PI * 2;
    if (vis.length === 1) return `<circle cx="${cx}" cy="${cy}" r="${(Rr + rr) / 2}" fill="none" stroke="${c}" stroke-width="${Rr - rr}" data-tip="${esc(t)}: ${n} (100%)"/>`;
    const big = a1 - a0 > Math.PI ? 1 : 0, P = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    return `<path d="M ${P(Rr, a0)} A ${Rr} ${Rr} 0 ${big} 1 ${P(Rr, a1)} L ${P(rr, a1)} A ${rr} ${rr} 0 ${big} 0 ${P(rr, a0)} Z" fill="${c}" data-tip="${esc(t)}: ${n} (${Math.round(frac * 100)}%)"/>`;
  }).join('');
  return `<div class="donut-wrap"><svg viewBox="0 0 170 170" width="170" height="170" role="img" aria-label="Distribución">
      ${total ? arcos : `<circle cx="${cx}" cy="${cy}" r="${(Rr + rr) / 2}" fill="none" stroke="#f3d9e3" stroke-width="${Rr - rr}"/>`}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="24" font-weight="900" fill="#3b1e2f">${esc(centro)}</text>
      <text x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="11" font-weight="700" fill="#7a5b6b">${esc(sub)}</text></svg>
    <div class="stack" style="gap:8px">${segs.map(([t, n, c]) => `<div class="row between" style="font-weight:700"><span><i style="display:inline-block;width:12px;height:12px;border-radius:4px;background:${c};margin-right:8px;vertical-align:-1px"></i>${esc(t)}</span><span class="num">${n} · ${total ? Math.round((n / total) * 100) : 0}%</span></div>`).join('')}</div></div>`;
}

/** Barras horizontales. items: [{nombre, pct (0-100), valor (texto), tip, clase}] */
export const hbarras = (items, vacio = 'Sin datos.') => items.length
  ? items.map((x) => `<div class="hbar" data-tip="${esc(x.tip || '')}"><span class="n">${esc(x.nombre)}</span><div class="track"><div class="fill ${x.clase || ''}" style="width:${Math.max(0, Math.min(100, x.pct))}%"></div></div><span class="v">${esc(x.valor)}</span></div>`).join('')
  : `<div class="small muted">${esc(vacio)}</div>`;
