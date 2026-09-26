/* Reportes: planilla por persona (horas, puntualidad, ventas y multas) para liquidar pagos. */
import { esc, fCorta, nombreBonito, soles, sumarDias, horasMin, pct } from '../../core/util.js';

const ui = { desde: '', hasta: '', tienda: '' };

export default {
  id: 'reportes', titulo: 'Reportes', icono: 'reporte', grupo: 'Gestión',
  async cargar(P) {
    const hoy = P.ahora.fecha;
    ui.desde ||= hoy.slice(0, 8) + '01'; ui.hasta ||= hoy;
    const [p, t] = await Promise.all([P.api.get(`/panel/planilla?desde=${ui.desde}&hasta=${ui.hasta}&tienda=${ui.tienda}`), P.api.get('/panel/tiendas')]);
    return { ...p, tiendas: t };
  },
  render(d, P) {
    const f = d.filas, ventas = P.ajustes.registrarVentas;
    const tot = f.reduce((a, p) => ({ turnos: a.turnos + p.turnos, aTiempo: a.aTiempo + p.aTiempo, tarde: a.tarde + p.tarde, faltas: a.faltas + p.faltas, coberturas: a.coberturas + p.coberturas, minutos: a.minutos + p.minutos, ventas: a.ventas + p.ventas, monto: a.monto + p.monto, multas: a.multas + p.multas, pendiente: a.pendiente + p.pendiente }),
      { turnos: 0, aTiempo: 0, tarde: 0, faltas: 0, coberturas: 0, minutos: 0, ventas: 0, monto: 0, multas: 0, pendiente: 0 });
    const q = `desde=${d.desde}&hasta=${d.hasta}&tienda=${ui.tienda}`;
    const atajos = [['Este mes', P.ahora.fecha.slice(0, 8) + '01', P.ahora.fecha], ['Mes pasado', sumarDias(P.ahora.fecha.slice(0, 8) + '01', -1).slice(0, 8) + '01', sumarDias(P.ahora.fecha.slice(0, 8) + '01', -1)], ['Últimos 15 días', sumarDias(P.ahora.fecha, -14), P.ahora.fecha]];
    return `<div class="card no-print"><div class="filtros"><label class="f">Desde<input type="date" id="rDesde" value="${d.desde}" data-fijo="1"></label><label class="f">Hasta<input type="date" id="rHasta" value="${d.hasta}" data-fijo="1"></label>
      ${d.tiendas.length > 1 ? `<label class="f">Tienda<select id="rTienda" data-fijo="1"><option value="">Todas</option>${d.tiendas.map((t) => `<option value="${t.id}" ${String(t.id) === ui.tienda ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></label>` : ''}
      <div class="fchips">${atajos.map(([t, a, b]) => `<button type="button" data-accion="rango" data-a="${a}" data-b="${b}" aria-pressed="${a === d.desde && b === d.hasta}">${t}</button>`).join('')}</div></div>
      <div class="row"><a class="btn btn-p" href="/api/panel/export/planilla.csv?${q}">Descargar planilla (Excel)</a><a class="btn" href="/api/panel/export/asistencia.csv?${q}">Detalle de turnos (Excel)</a><a class="btn" href="/api/panel/export/multas.csv?estado=todas">Multas (Excel)</a><button type="button" data-accion="imprimir">Imprimir / PDF</button></div></div>
    <div class="card"><div><h2>Planilla del ${fCorta(d.desde)} al ${fCorta(d.hasta)}</h2><span class="small muted">Base para liquidar pagos por turno, descontar multas y reconocer a quienes más venden.</span></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Colaboradora</th><th class="r">Turnos</th><th class="r">A tiempo</th><th class="r">Tarde</th><th class="r">Faltas</th><th class="r">Cubrió</th><th class="r">Horas</th><th class="r">Asistencia</th><th class="r">Puntualidad</th><th class="r">GPS en tienda</th>
        ${ventas ? '<th class="r">Ventas</th><th class="r">Vendido</th><th class="r">S/ por hora</th>' : ''}<th class="r">Multas período</th><th class="r">Deuda total</th></tr></thead><tbody>
      ${f.map((p) => `<tr><td><b>${esc(nombreBonito(p.nombre))}</b> <span class="tiny muted">${esc(p.codigo)}</span></td><td class="r">${p.turnos}</td><td class="r">${p.aTiempo}</td><td class="r">${p.tarde}</td><td class="r">${p.faltas}</td><td class="r">${p.coberturas}</td>
        <td class="r">${horasMin(p.minutos)}</td><td class="r">${pct(p.asistencia)}</td><td class="r"><span class="chip ${p.puntualidad == null ? 'grey' : p.puntualidad >= 90 ? 'ok' : p.puntualidad >= 70 ? 'warn' : 'bad'}">${pct(p.puntualidad)}</span></td><td class="r">${pct(p.gpsEnLocal)}</td>
        ${ventas ? `<td class="r">${p.ventas}</td><td class="r">${soles(p.monto)}</td><td class="r">${p.ventaPorHora != null ? soles(p.ventaPorHora) : '—'}</td>` : ''}<td class="r">${p.multas ? soles(p.multas) : '—'}</td><td class="r">${p.pendiente ? `<b style="color:var(--bad-ink)">${soles(p.pendiente)}</b>` : '—'}</td></tr>`).join('') || '<tr><td colspan="15" class="muted">No hay turnos en este período.</td></tr>'}</tbody>
      ${f.length ? `<tfoot><tr><td>Total</td><td class="r">${tot.turnos}</td><td class="r">${tot.aTiempo}</td><td class="r">${tot.tarde}</td><td class="r">${tot.faltas}</td><td class="r">${tot.coberturas}</td><td class="r">${horasMin(tot.minutos)}</td><td class="r">${pct(tot.turnos ? Math.round(((tot.aTiempo + tot.tarde) / tot.turnos) * 100) : null)}</td><td class="r">${pct(tot.turnos ? Math.round((tot.aTiempo / tot.turnos) * 100) : null)}</td><td></td>
        ${ventas ? `<td class="r">${tot.ventas}</td><td class="r">${soles(tot.monto)}</td><td class="r">${tot.minutos ? soles(tot.monto / (tot.minutos / 60)) : '—'}</td>` : ''}<td class="r">${soles(tot.multas)}</td><td class="r">${soles(tot.pendiente)}</td></tr></tfoot>` : ''}</table></div></div>`;
  },
  accion(a, el, P) {
    if (a === 'rango') { ui.desde = el.dataset.a; ui.hasta = el.dataset.b; return P.refrescar(); }
    if (a === 'imprimir') return window.print();
  },
  alCambiar(el, P) {
    if (el.id === 'rDesde') { ui.desde = el.value; return P.refrescar(); }
    if (el.id === 'rHasta') { ui.hasta = el.value; return P.refrescar(); }
    if (el.id === 'rTienda') { ui.tienda = el.value; return P.refrescar(); }
  },
};
