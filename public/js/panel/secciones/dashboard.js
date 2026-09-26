/* Dashboard: asistencia, puntualidad, GPS y ventas del período. */
import { esc, fCorta, nombreBonito, soles, solesCorto, sumarDias, lunesDe, aMin, horasMin, COLOR_RES, CLASE_RES, pct, diaDe, DIAS_C } from '../../core/util.js';
import { barras, dona, hbarras } from '../../core/graficos.js';

const ui = { preset: 'mes', desde: '', hasta: '', tienda: '', personas: new Set(), resultados: new Set(['a tiempo', 'tarde', 'falta', 'cubrió']), orden: { col: 'fecha', dir: -1 } };

function periodo(hoy) {
  if (ui.preset === 'semana') return [lunesDe(hoy), hoy];
  if (ui.preset === 'semanaPasada') { const l = sumarDias(lunesDe(hoy), -7); return [l, sumarDias(l, 6)]; }
  if (ui.preset === 'mes') return [hoy.slice(0, 8) + '01', hoy];
  if (ui.preset === 'mesPasado') { const f = sumarDias(hoy.slice(0, 8) + '01', -1); return [f.slice(0, 8) + '01', f]; }
  if (ui.preset === '30') return [sumarDias(hoy, -29), hoy];
  let a = ui.desde || sumarDias(hoy, -29), b = ui.desde ? ui.hasta || hoy : hoy;
  if (a > b) [a, b] = [b, a];
  return [a, b];
}
const total = (r) => r.montoVentas || 0;

export default {
  id: 'dashboard', titulo: 'Dashboard', icono: 'grafico', grupo: 'Operación',
  async cargar(P) {
    const [a, b] = periodo(P.ahora.fecha);
    const [p, t] = await Promise.all([P.api.get(`/panel/periodo?desde=${a}&hasta=${b}&tienda=${ui.tienda}`), P.api.get('/panel/tiendas')]);
    return { ...p, tiendas: t.filter((x) => x.activa) };
  },
  render(d, P) {
    const tol = P.ajustes.toleranciaMin;
    const todas = d.filas;
    const personas = [...new Map(todas.map((r) => [r.usuarioId, r.nombre])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const filas = todas.filter((r) => (!ui.personas.size || ui.personas.has(r.usuarioId)) && (ui.resultados.has(r.resultado) || r.resultado === 'en curso'));
    const cerradas = filas.filter((r) => !['en curso', 'cubrió'].includes(r.resultado));
    const n = cerradas.length, nOk = cerradas.filter((r) => r.resultado === 'a tiempo').length, nTarde = cerradas.filter((r) => r.resultado === 'tarde').length, nFalta = cerradas.filter((r) => r.resultado === 'falta').length;
    const nCub = filas.filter((r) => r.resultado === 'cubrió').length;
    const asist = n ? Math.round(((nOk + nTarde) / n) * 100) : null, punt = n ? Math.round((nOk / n) * 100) : null;
    const tardes = cerradas.filter((r) => r.resultado === 'tarde'), promTarde = tardes.length ? Math.round(tardes.reduce((s, r) => s + r.minutosTarde, 0) / tardes.length) : null;
    const minutos = filas.reduce((s, r) => s + (r.minutosEnLocal || 0), 0);
    const vendido = filas.reduce((s, r) => s + total(r), 0), nVentas = filas.reduce((s, r) => s + (r.ventas || 0), 0);
    const conCuadre = filas.filter((r) => r.ventas != null).length, conEntrada = filas.filter((r) => r.entrada).length;
    const multas = filas.reduce((s, r) => s + r.multa, 0);
    const rep = filas.reduce((a, r) => [a[0] + r.reportes, a[1] + r.reportesDentro], [0, 0]);
    const presets = [['semana', 'Esta semana'], ['semanaPasada', 'Semana pasada'], ['mes', 'Este mes'], ['mesPasado', 'Mes pasado'], ['30', 'Últimos 30 días'], ['custom', 'Personalizado']];

    const filtros = `<div class="card no-print"><div class="filtros">
      <div class="grow"><div class="eyebrow" style="margin-bottom:6px">Período</div><div class="fchips">${presets.map(([k, t]) => `<button type="button" data-accion="preset" data-v="${k}" aria-pressed="${ui.preset === k}">${t}</button>`).join('')}</div></div>
      <label class="f" style="min-width:140px">Desde<input type="date" id="dDesde" value="${d.desde}" data-fijo="1"></label><label class="f" style="min-width:140px">Hasta<input type="date" id="dHasta" value="${d.hasta}" data-fijo="1"></label>
      ${d.tiendas.length > 1 ? `<label class="f">Tienda<select id="dTienda" data-fijo="1"><option value="">Todas</option>${d.tiendas.map((t) => `<option value="${t.id}" ${String(t.id) === ui.tienda ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></label>` : ''}</div>
      <div class="filtros"><div class="grow"><div class="eyebrow" style="margin-bottom:6px">Colaboradoras</div><div class="fchips"><button type="button" data-accion="persona" data-v="" aria-pressed="${!ui.personas.size}">Todas</button>${personas.map(([id, nm]) => `<button type="button" data-accion="persona" data-v="${id}" aria-pressed="${ui.personas.has(id)}">${esc(nombreBonito(nm))}</button>`).join('')}</div></div>
      <div><div class="eyebrow" style="margin-bottom:6px">Resultado</div><div class="fchips">${[['a tiempo', 'A tiempo'], ['tarde', 'Tarde'], ['falta', 'Falta'], ['cubrió', 'Coberturas']].map(([k, t]) => `<button type="button" data-accion="resultado" data-v="${k}" aria-pressed="${ui.resultados.has(k)}">${t}</button>`).join('')}</div></div></div>
      <div class="row between"><span class="small muted">${filas.length} registro(s) · ${fCorta(d.desde)} al ${fCorta(d.hasta)}</span><span class="row"><button type="button" class="btn-sm" data-accion="limpiar">Limpiar filtros</button><button type="button" class="btn-sm" data-accion="imprimir">Imprimir / PDF</button><a class="btn btn-sm" href="/api/panel/export/asistencia.csv?desde=${d.desde}&hasta=${d.hasta}&tienda=${ui.tienda}">Descargar Excel (CSV)</a></span></div></div>`;

    const kpis = `<div class="kpis">
      <div class="kpi k-berry"><span>Turnos</span><b>${n}</b><small>${filas.length - n - nCub > 0 ? `+${filas.length - n - nCub} en curso · ` : ''}${nCub} coberturas</small></div>
      <div class="kpi k-ok"><span>Asistencia</span><b>${pct(asist)}</b><small>${nOk + nTarde} de ${n} asistieron</small></div>
      <div class="kpi k-ok"><span>Puntualidad</span><b>${pct(punt)}</b><small>${nOk} a tiempo</small></div>
      <div class="kpi k-warn"><span>Tardanzas</span><b>${nTarde}</b><small>${promTarde == null ? 'sin tardanzas' : `promedio ${promTarde} min`}</small></div>
      <div class="kpi k-bad"><span>Faltas</span><b>${nFalta}</b><small>${n ? Math.round((nFalta / n) * 100) : 0}% de los turnos</small></div>
      <div class="kpi k-info"><span>Horas en tienda</span><b>${Math.round(minutos / 60)}</b><small>GPS en tienda: ${rep[0] ? Math.round((rep[1] / rep[0]) * 100) + '%' : '—'}</small></div>
      ${P.ajustes.registrarVentas ? `<div class="kpi"><span>Vendido</span><b style="font-size:1.45rem">${solesCorto(vendido)}</b><small>${nVentas} ventas · ticket ${nVentas ? soles(vendido / nVentas) : '—'}</small></div>` : ''}
      <div class="kpi k-berry"><span>Multas del período</span><b style="font-size:1.45rem">${soles(multas)}</b><small>${conEntrada ? `cuadre de caja en ${Math.round((conCuadre / conEntrada) * 100)}%` : ''}</small></div></div>`;
    if (!filas.length) return `${filtros}${kpis}<div class="vacio">No hay turnos con estos filtros.${P.demo ? '<br>En modo demostración puedes crear datos de ejemplo en <button type="button" class="btn-link" data-ir="ajustes">Configuración</button>.' : ''}</div>`;

    // 1. Tardanza por turno
    const orden = cerradas.slice().sort((a, b) => a.fecha.localeCompare(b.fecha) || a.inicio.localeCompare(b.inicio));
    const maxT = Math.max(tol + 15, ...orden.map((r) => r.minutosTarde || 0));
    const c1 = `<div class="card ancho"><div class="card-h"><div><h2>Minutos de tardanza por turno</h2><span class="small muted">Cada barra es un turno. Línea punteada: tolerancia de ${tol} min.</span></div>
      <div class="leyenda"><span><i style="background:${COLOR_RES['a tiempo']}"></i>A tiempo (${nOk})</span><span><i style="background:${COLOR_RES.tarde}"></i>Tarde (${nTarde})</span><span><i style="background:${COLOR_RES.falta}"></i>Falta (${nFalta})</span></div></div>
      ${barras(orden.map((r) => ({ etiqueta: fCorta(r.fecha).slice(4), valor: r.resultado === 'falta' ? maxT : r.resultado === 'a tiempo' ? Math.max(1.5, r.minutosTarde) : r.minutosTarde, color: COLOR_RES[r.resultado], marca: r.resultado === 'falta' ? 'F' : '',
        tip: `${fCorta(r.fecha)} · ${r.inicio}–${r.fin}\n${nombreBonito(r.nombre)}\n${r.resultado === 'falta' ? 'Falta' : `Entró ${r.entrada} · ${r.resultado === 'tarde' ? r.minutosTarde + ' min tarde' : 'a tiempo'}`}${r.multa ? `\nMulta ${soles(r.multa)}` : ''}` })),
      { lineas: [{ valor: tol }], max: maxT, unidad: 'min', aria: 'Minutos de tardanza por turno' })}</div>`;
    // 2. Dona
    const c2 = `<div class="card"><h2>Resultado de los turnos</h2>${dona([['A tiempo', nOk, COLOR_RES['a tiempo']], ['Tarde', nTarde, COLOR_RES.tarde], ['Falta', nFalta, COLOR_RES.falta]], { centro: pct(punt), sub: 'puntualidad' })}</div>`;
    // Por persona
    const por = new Map();
    for (const r of filas) {
      if (!por.has(r.usuarioId)) por.set(r.usuarioId, { nombre: nombreBonito(r.nombre), n: 0, ok: 0, rep: 0, dentro: 0, vendido: 0, ventas: 0, min: 0, multa: 0, difE: [], difS: [] });
      const p = por.get(r.usuarioId);
      if (!['en curso', 'cubrió'].includes(r.resultado)) { p.n++; if (r.resultado === 'a tiempo') p.ok++; }
      p.rep += r.reportes; p.dentro += r.reportesDentro; p.vendido += total(r); p.ventas += r.ventas || 0; p.min += r.minutosEnLocal || 0; p.multa += r.multa;
      if (r.entrada) p.difE.push(aMin(r.entrada) - aMin(r.inicio));
      if (r.salida) p.difS.push(aMin(r.salida) - aMin(r.fin));
    }
    const ps = [...por.values()];
    const c3 = `<div class="card"><h2>Puntualidad por colaboradora</h2><span class="small muted" style="margin-top:-8px">% de sus turnos en que llegó a tiempo</span>
      ${hbarras(ps.filter((x) => x.n).sort((a, b) => b.ok / b.n - a.ok / a.n).map((x) => ({ nombre: x.nombre, pct: (x.ok / x.n) * 100, valor: Math.round((x.ok / x.n) * 100) + '%', clase: 'verde', tip: `${x.nombre}\n${x.ok} a tiempo de ${x.n} turnos` })), 'Sin turnos cerrados.')}</div>`;
    const maxV = Math.max(1, ...ps.map((x) => x.vendido));
    const c4 = P.ajustes.registrarVentas ? `<div class="card"><h2>Ventas por colaboradora</h2><span class="small muted" style="margin-top:-8px">Total vendido en sus turnos (cuadre de caja)</span>
      ${hbarras(ps.filter((x) => x.vendido).sort((a, b) => b.vendido - a.vendido).map((x) => ({ nombre: x.nombre, pct: (x.vendido / maxV) * 100, valor: solesCorto(x.vendido), tip: `${x.nombre}\n${soles(x.vendido)} en ${x.ventas} ventas\n${x.min ? soles(x.vendido / (x.min / 60)) + ' por hora' : ''}` })), 'Aún no hay cuadres de caja.')}</div>` : '';
    // Ventas por día
    const porDia = new Map();
    for (const r of filas) porDia.set(r.fecha, (porDia.get(r.fecha) || 0) + total(r));
    const dias = [...porDia.entries()].sort();
    const c5 = P.ajustes.registrarVentas && vendido ? `<div class="card ancho"><div class="card-h"><div><h2>Ventas por día</h2><span class="small muted">Suma de los cuadres de caja de cada día</span></div>
      <div class="leyenda"><span><i style="background:#ff6f98"></i>Lunes a viernes</span><span><i style="background:#6a2f55"></i>Fin de semana</span></div></div>
      ${barras(dias.map(([f, v]) => ({ etiqueta: fCorta(f).slice(4), valor: Math.round(v), color: [0, 6].includes(diaDe(f)) ? '#6a2f55' : '#ff6f98', tip: `${DIAS_C[diaDe(f)]} ${fCorta(f).slice(4)}\n${soles(v)}` })), { unidad: 'S/', aria: 'Ventas por día' })}</div>` : '';
    const c6 = `<div class="card"><h2>Reportes GPS dentro de la tienda</h2><span class="small muted" style="margin-top:-8px">% de reportes automáticos dentro de la geocerca</span>
      ${hbarras(ps.filter((x) => x.rep).sort((a, b) => b.dentro / b.rep - a.dentro / a.rep).map((x) => ({ nombre: x.nombre, pct: (x.dentro / x.rep) * 100, valor: Math.round((x.dentro / x.rep) * 100) + '%', clase: 'berry', tip: `${x.nombre}\n${x.dentro} de ${x.rep} reportes en tienda` })), 'Sin reportes GPS.')}</div>`;
    const prom = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null);
    const fmt = (m, antes, despues) => (m == null ? '—' : m === 0 ? 'en punto' : `${Math.abs(m)} min ${m > 0 ? despues : antes}`);
    const c7 = `<div class="card"><h2>Ingreso y salida promedio</h2><span class="small muted" style="margin-top:-8px">Respecto al horario de cada turno</span>
      <div class="table-wrap"><table class="t"><thead><tr><th>Colaboradora</th><th class="r">Ingreso</th><th class="r">Salida</th><th class="r">Multas</th></tr></thead><tbody>
      ${ps.map((x) => { const e = prom(x.difE), s = prom(x.difS); return `<tr><td>${esc(x.nombre)}</td><td class="r"><span class="chip ${e > tol ? 'warn' : 'ok'}">${fmt(e, 'antes', 'tarde')}</span></td><td class="r"><span class="chip ${s != null && s < -tol ? 'warn' : 'grey'}">${fmt(s, 'antes', 'después')}</span></td><td class="r">${x.multa ? soles(x.multa) : '—'}</td></tr>`; }).join('')}</tbody></table></div></div>`;

    // Tabla detalle
    const cols = [['fecha', 'Fecha'], ['nombre', 'Colaboradora'], ...(d.tiendas.length > 1 ? [['tienda', 'Tienda']] : []), ['turno', 'Turno'], ['entrada', 'Entrada'], ['salida', 'Salida'], ['horas', 'En tienda'], ['tarde', 'Min tarde'], ['gps', 'GPS'], ['resultado', 'Resultado'], ...(P.ajustes.registrarVentas ? [['venta', 'Vendido']] : []), ['multa', 'Multa']];
    const val = (r, c) => ({ fecha: r.fecha + r.inicio, nombre: r.nombre, tienda: r.tienda, turno: r.inicio, entrada: r.entrada || '', salida: r.salida || '', horas: r.minutosEnLocal ?? -1, tarde: r.entrada ? r.minutosTarde : -1, gps: r.esperados ? r.recibidos / r.esperados : -1, resultado: r.resultado, venta: r.montoVentas ?? -1, multa: r.multa }[c]);
    const o = ui.orden;
    const ord = filas.slice().sort((a, b) => { const x = val(a, o.col), y = val(b, o.col); return (x > y ? 1 : x < y ? -1 : 0) * o.dir; });
    const der = new Set(['horas', 'tarde', 'gps', 'venta', 'multa']);
    const tabla = `<div class="card ancho"><h2>Detalle de turnos</h2><div class="table-wrap" id="tDet" data-scroll><table class="t"><thead><tr>${cols.map(([k, t]) => `<th class="${der.has(k) ? 'r' : ''}"><button type="button" data-accion="ordenar" data-v="${k}">${t}${o.col === k ? (o.dir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('')}</tr></thead><tbody>
      ${ord.map((r) => `<tr><td class="num">${fCorta(r.fecha)}</td><td>${esc(nombreBonito(r.nombre))}</td>${d.tiendas.length > 1 ? `<td>${esc(r.tienda)}</td>` : ''}<td class="num">${r.inicio}–${r.fin}</td><td class="num">${r.entrada || '—'}</td><td class="num">${r.salida || '—'}</td>
        <td class="r">${r.minutosEnLocal != null ? horasMin(r.minutosEnLocal) + (r.horasEstimadas ? '*' : '') : '—'}</td><td class="r">${r.entrada ? r.minutosTarde : '—'}</td><td class="r">${r.esperados ? `${r.recibidos}/${r.esperados}` : '—'}</td>
        <td><span class="chip ${CLASE_RES[r.resultado] || 'grey'}">${r.resultado}</span></td>${P.ajustes.registrarVentas ? `<td class="r">${r.montoVentas != null ? soles(r.montoVentas) : '—'}</td>` : ''}<td class="r">${r.multa ? soles(r.multa) : '—'}</td></tr>`).join('')}</tbody></table></div>
      <span class="tiny muted">* Sin salida marcada: se estima hasta el fin del turno.</span></div>`;
    return `${filtros}${kpis}<div class="charts">${c1}${c2}${c3}${c4}${c5}${c6}${c7}${tabla}</div>`;
  },
  async accion(a, el, P) {
    const v = el.dataset.v;
    if (a === 'preset') { ui.preset = v; if (v === 'custom') { const [x, y] = periodo(P.ahora.fecha); ui.desde ||= x; ui.hasta ||= y; } return P.refrescar(); }
    if (a === 'persona') { if (!v) ui.personas.clear(); else { const id = Number(v); ui.personas.has(id) ? ui.personas.delete(id) : ui.personas.add(id); } return P.pintar(); }
    if (a === 'resultado') { const r = ui.resultados; r.has(v) ? r.delete(v) : r.add(v); if (!r.size) r.add(v); return P.pintar(); }
    if (a === 'ordenar') { ui.orden = { col: v, dir: ui.orden.col === v ? -ui.orden.dir : -1 }; return P.pintar(); }
    if (a === 'limpiar') { Object.assign(ui, { preset: 'mes', desde: '', hasta: '', tienda: '', personas: new Set(), resultados: new Set(['a tiempo', 'tarde', 'falta', 'cubrió']) }); return P.refrescar(); }
    if (a === 'imprimir') return window.print();
  },
  async alCambiar(el, P) {
    if (el.id === 'dDesde' || el.id === 'dHasta') {
      const [x, y] = periodo(P.ahora.fecha);
      ui.preset = 'custom'; ui.desde = el.id === 'dDesde' ? el.value : ui.desde || x; ui.hasta = el.id === 'dHasta' ? el.value : ui.hasta || y;
      return P.refrescar();
    }
    if (el.id === 'dTienda') { ui.tienda = el.value; return P.refrescar(); }
  },
};
