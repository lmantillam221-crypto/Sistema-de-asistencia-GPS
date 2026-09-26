/* En vivo: qué está pasando hoy en cada tienda. */
import { esc, cap, fLarga, fCorta, nombreBonito, aHora, fmtDist, soles, horasMin, waLink, CLASE_ESTADO, ETIQUETA_ESTADO, NOMBRE_ALERTA, GRAVES, DIAS, hora12 } from '../../core/util.js';
import { toast } from '../../core/ui.js';
import { crearMapa } from '../mapa.js';

const ui = { fecha: null, tienda: '', texto: null };

const chipMarca = (m) => (m.estado === 'dentro' ? '<span class="chip ok">en tienda</span>' : m.estado === 'fuera' ? `<span class="chip bad">${fmtDist(m.distancia_m)} fuera</span>` : '<span class="chip warn">impreciso</span>');
const mapaLink = (m) => `<a href="https://www.google.com/maps?q=${m.lat},${m.lng}" target="_blank" rel="noopener">ver en mapa</a>`;

function lineaTiempo(p, turno) {
  const ev = p.ev, filas = [];
  const linea = (m, et) => `<div class="slot"><span class="t">${m.hora.slice(0, 5)}</span><span>${et}</span>${chipMarca(m)}<span class="det"><span class="num">±${Math.round(m.precision_m)} m</span>${mapaLink(m)}${m.observaciones.map((o) => `<span style="color:var(--bad-ink)">${esc(o)}</span>`).join('')}</span></div>`;
  const ent = p.marcas.find((m) => m.tipo === 'entrada'), sal = p.marcas.find((m) => m.tipo === 'salida');
  const porId = new Map(p.marcas.map((m) => [m.id, m]));
  if (ent) filas.push([ent.hora, linea(ent, 'Entrada')]);
  const usadas = new Set();
  for (const f of ev.franjas) {
    const hh = f.hora + ':00';
    if (f.marcaId) { const m = porId.get(f.marcaId); usadas.add(f.marcaId); filas.push([hh, linea(m, `Reporte automático${m.hora.slice(0, 5) !== f.hora ? ` <span class="tiny muted">(esperado ${f.hora})</span>` : ''}`)]); }
    else if (f.estado === 'falta') filas.push([hh, `<div class="slot"><span class="t">${f.hora}</span><span>Reporte automático</span><span class="chip bad">No llegó</span></div>`]);
    else if (f.estado === 'pendiente') filas.push([hh, `<div class="slot"><span class="t">${f.hora}</span><span>Reporte automático</span><span class="chip warn">Esperando…</span></div>`]);
    else filas.push([hh, `<div class="slot futuro"><span class="t">${f.hora}</span><span class="muted">Próximo reporte</span><span></span></div>`]);
  }
  for (const m of p.marcas) if (m.tipo === 'control' && !usadas.has(m.id)) filas.push([m.hora, linea(m, 'Ubicación adicional')]);
  if (sal) filas.push([sal.hora + '~', linea(sal, 'Salida')]);
  filas.sort((a, b) => a[0].localeCompare(b[0]));
  return filas.length ? filas.map((x) => x[1]).join('') : `<div class="small muted">Sin marcas todavía. El turno empieza a las ${turno.inicio}.</div>`;
}

function tarjeta(it, P) {
  const t = it.turno, a = it.asignado, e = a?.ev;
  const tol = P.ajustes.toleranciaMin;
  const quien = t.usuario_nombre ? nombreBonito(t.usuario_nombre) : 'Sin asignar';
  const estado = e?.estado || (t.usuario_id ? 'PROGRAMADO' : 'SIN ASIGNAR');
  const rep = a?.reporte;
  const venta = rep && rep.ventas != null ? `${rep.ventas} · ${soles((rep.efectivo || 0) + (rep.digital || 0) + (rep.tarjeta || 0))}` : '—';
  return `<div class="card hero aparece"><div><div class="eyebrow">${esc(nombreBonito(t.tienda_nombre))} · ${t.inicio}–${t.fin}</div>
      <div class="quien" style="margin-top:6px">${esc(quien)}</div>${t.usuario_telefono ? `<a class="small" href="${waLink(t.usuario_telefono, `Hola ${nombreBonito(t.usuario_nombre).split(' ')[0]}, `)}" target="_blank" rel="noopener">WhatsApp +51 ${esc(t.usuario_telefono)}</a>` : ''}</div>
    <span class="estado ${CLASE_ESTADO[estado] || 'grey'}">${esc(ETIQUETA_ESTADO[estado] || estado)}</span>
    ${a ? `<div class="hechos"><div class="hecho"><span>Entrada</span><b>${e.entrada || '—'}</b>${e.minutosTarde > tol ? `<div class="tiny" style="color:var(--warn-ink);font-weight:800">${e.minutosTarde} min tarde</div>` : ''}</div>
      <div class="hecho"><span>Último reporte</span><b>${e.ultimo || '—'}</b></div>
      <div class="hecho"><span>Reportes GPS</span><b>${e.esperados ? `${e.recibidos}/${e.esperados}` : '—'}</b></div>
      <div class="hecho"><span>Salida</span><b>${e.salida || '—'}</b>${e.minutosEnLocal != null ? `<div class="tiny muted">${horasMin(e.minutosEnLocal)}</div>` : ''}</div>
      ${P.ajustes.registrarVentas ? `<div class="hecho"><span>Ventas</span><b style="font-size:1rem">${venta}</b></div>` : ''}</div>
      ${rep?.nota ? `<div class="msg pink small" style="grid-column:1/-1">📝 ${esc(rep.nota)}</div>` : ''}
      <details style="grid-column:1/-1" id="det-t${t.id}"><summary class="small" style="cursor:pointer;font-weight:800">Línea de tiempo del turno</summary>${lineaTiempo(a, t)}
        ${rep ? `<div class="small muted" style="margin-top:8px">Apertura: ${rep.apertura.length ? rep.apertura.map(esc).join(' · ') : '—'}<br>Cierre: ${rep.cierre.length ? rep.cierre.map(esc).join(' · ') : '—'}</div>` : ''}</details>` : '<div class="small muted" style="grid-column:1/-1">Nadie eligió este turno. Asígnalo en <button type="button" class="btn-link" data-ir="horarios">Horarios</button>.</div>'}
    ${it.cubrieron.map((c) => `<div class="msg info small" style="grid-column:1/-1">Cubrió: <b>${esc(nombreBonito(c.nombre))}</b> · entrada ${c.ev.entrada}${c.ev.salida ? ` · salida ${c.ev.salida}` : ''}</div>`).join('')}
  </div>`;
}

function textoReporte(d, P) {
  const lin = [`*${P.empresa.nombre} · Reporte del día*`, cap(fLarga(d.fecha))];
  for (const it of d.items) {
    const t = it.turno, e = it.asignado?.ev;
    lin.push('', `📍 ${nombreBonito(t.tienda_nombre)} · ${t.inicio}–${t.fin}: *${t.usuario_nombre ? nombreBonito(t.usuario_nombre) : 'sin asignar'}*${e ? ` — ${ETIQUETA_ESTADO[e.estado] || e.estado}` : ''}`);
    if (e?.entrada) lin.push(`Entrada ${e.entrada}${e.minutosTarde > P.ajustes.toleranciaMin ? ` (${e.minutosTarde} min tarde)` : ' (a tiempo)'}${e.salida ? ` · Salida ${e.salida}` : ''}`);
    if (e?.esperados) lin.push(`Reportes GPS: ${e.recibidos}/${e.esperados}`);
    const r = it.asignado?.reporte;
    if (r?.ventas != null) lin.push(`Ventas: ${r.ventas} (${soles((r.efectivo || 0) + (r.digital || 0) + (r.tarjeta || 0))})`);
    for (const c of it.cubrieron) lin.push(`Cubrió ${nombreBonito(c.nombre)} (entrada ${c.ev.entrada})`);
  }
  const al = d.alertas.filter((a) => a.tipo !== 'TARDANZA');
  if (al.length) { lin.push('', 'Alertas:'); al.forEach((a) => lin.push(`- ${NOMBRE_ALERTA[a.tipo]}: ${nombreBonito(a.nombre)} · ${a.detalle}`)); }
  return lin.join('\n');
}

let mapa = null;
export default {
  id: 'hoy', titulo: 'En vivo', icono: 'vivo', grupo: 'Operación',
  async cargar(P) {
    const f = ui.fecha || '';
    const [d, v] = await Promise.all([P.api.get(`/panel/dia?fecha=${f}&tienda=${ui.tienda}`), P.api.get('/panel/en-vivo')]);
    return { ...d, vivo: v };
  },
  render(d, P) {
    const esHoy = d.fecha === d.ahora.fecha;
    const items = d.items;
    const asignados = items.filter((i) => i.asignado);
    const enTienda = asignados.filter((i) => i.asignado.ev.estado === 'EN EL LOCAL').length + items.reduce((s, i) => s + i.cubrieron.filter((c) => c.ev.estado === 'EN EL LOCAL').length, 0);
    const tarde = asignados.filter((i) => i.asignado.ev.resultado === 'tarde').length;
    const faltan = asignados.filter((i) => ['NO LLEGA', 'FALTÓ'].includes(i.asignado.ev.estado)).length;
    const libres = items.filter((i) => !i.turno.usuario_id).length;
    const ventas = asignados.reduce((s, i) => { const r = i.asignado.reporte; return s + (r ? (r.efectivo || 0) + (r.digital || 0) + (r.tarjeta || 0) : 0); }, 0);
    const cab = `<div class="row between"><div><div class="eyebrow">${esHoy ? 'Hoy' : 'Día seleccionado'}</div><h2 style="font-size:1.3rem">${cap(fLarga(d.fecha))}</h2></div>
      <div class="row"><input type="date" id="hoyFecha" value="${d.fecha}" data-fijo="1" aria-label="Día" style="width:auto">${!esHoy ? '<button type="button" data-accion="volverHoy">Volver a hoy</button>' : ''}
      ${d.tiendas.length > 1 ? `<select id="hoyTienda" data-fijo="1" style="width:auto" aria-label="Tienda"><option value="">Todas las tiendas</option>${d.tiendas.map((t) => `<option value="${t.id}" ${String(t.id) === ui.tienda ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select>` : ''}</div></div>`;
    const kpis = `<div class="kpis"><div class="kpi k-berry"><span>Turnos</span><b>${items.length}</b><small>${libres ? `${libres} sin asignar` : 'todos asignados'}</small></div>
      <div class="kpi k-ok"><span>En tienda ahora</span><b>${esHoy ? enTienda : '—'}</b><small>según el último GPS</small></div>
      <div class="kpi k-warn"><span>Tardanzas</span><b>${tarde}</b><small>más de ${P.ajustes.toleranciaMin} min</small></div>
      <div class="kpi k-bad"><span>No llegó / faltó</span><b>${faltan}</b><small>${d.alertas.filter((a) => GRAVES.has(a.tipo)).length} alertas graves</small></div>
      ${P.ajustes.registrarVentas ? `<div class="kpi"><span>Ventas registradas</span><b style="font-size:1.45rem">${soles(ventas)}</b><small>cuadres de caja</small></div>` : ''}</div>`;
    const pend = [];
    if (d.justificacionesPendientes) pend.push(`<div class="msg info"><b>${d.justificacionesPendientes} justificación(es) por revisar.</b> <button type="button" class="btn-link" data-ir="multas">Revisar</button></div>`);
    if (d.coberturas.length) pend.push(`<div class="msg pink"><b>${d.coberturas.length} turno(s) buscan cobertura:</b> ${d.coberturas.map((c) => `${nombreBonito(c.solicitante_nombre)} (${fCorta(c.fecha)} ${c.inicio})`).map(esc).join(', ')}</div>`);
    const alertas = `<div class="card"><h2>Alertas</h2><div>${d.alertas.length ? d.alertas.map((a) => `<div class="alerta"><span class="chip ${GRAVES.has(a.tipo) ? 'bad' : a.tipo === 'CUBRIO' ? 'info' : 'warn'}">${NOMBRE_ALERTA[a.tipo] || a.tipo}</span><span><b>${esc(nombreBonito(a.nombre))}</b> · ${esc(a.detalle)}</span></div>`).join('') : '<div class="small muted">Sin alertas. Todo en orden ✨</div>'}</div>
      ${items.length ? `<div class="row"><button type="button" data-accion="copiar">Copiar reporte del día</button><a class="btn btn-wa" href="${waLink('', textoReporte(d, P))}" target="_blank" rel="noopener">Enviar por WhatsApp</a></div>` : ''}
      ${ui.texto ? `<textarea class="copiar" readonly data-fijo="1">${esc(ui.texto)}</textarea>` : ''}</div>`;
    const recs = d.recordatorios;
    const rec = `<div class="card"><div><h2>Recordatorios por WhatsApp</h2><span class="small muted">${P.ajustes.recordatorioHoras} h antes de cada turno. Toca el botón verde cuando corresponda: se abre WhatsApp con el mensaje listo.</span></div>
      <div>${recs.length ? recs.map((r) => `<div class="rec"><div><b>${esc(nombreBonito(r.turno.usuario_nombre))}</b> <span class="small muted">· ${fCorta(r.turno.fecha)} ${r.turno.inicio}</span><div class="tiny muted">${r.turno.usuario_telefono ? '+51 ' + esc(r.turno.usuario_telefono) : 'Sin celular registrado'} · enviar ${r.envFecha === d.ahora.fecha ? 'hoy' : fCorta(r.envFecha)} ${r.envHora}</div></div>
        <div>${r.estado === 'enviado' ? '<span class="chip ok">Enviado</span>' : r.estado === 'tarde' ? '<span class="chip grey">Ya empezó</span>' : `<a class="btn btn-wa btn-sm ${r.estado === 'ahora' ? 'urgente' : ''}" href="${r.enlace}" target="_blank" rel="noopener" data-accion="aviso" data-clave="${esc(r.clave)}">${r.estado === 'ahora' ? 'Enviar ahora' : 'Enviar'}</a>`}</div></div>`).join('') : '<div class="small muted">No hay turnos asignados hoy ni mañana.</div>'}</div></div>`;
    const mapaCard = `<div class="card"><div class="card-h"><h2>Mapa en vivo</h2><span class="small muted">Geocerca de cada tienda y última ubicación de quienes están en turno</span></div><div class="mapa" id="mapaVivo"></div></div>`;
    const turnos = items.length ? `<div class="turnos-dia">${items.map((i) => tarjeta(i, P)).join('')}</div>`
      : `<div class="card"><h2>No hay turnos este día</h2><p class="muted">El equipo elige horarios el ${DIAS[P.ajustes.ventana.dia]} de ${hora12(P.ajustes.ventana.desde)} a ${hora12(P.ajustes.ventana.hasta)}. También puedes asignarlos en <button type="button" class="btn-link" data-ir="horarios">Horarios</button>.</p></div>`;
    return `${cab}${P.demo ? demoBar(P) : ''}${pend.join('')}${kpis}${turnos}<div class="grid-2"><div class="stack" style="gap:16px">${alertas}${mapaCard}</div>${rec}</div>`;
  },
  alPintar(d) {
    if (!d || !window.L) return;
    const el = document.getElementById('mapaVivo');
    if (!el) return;
    mapa = crearMapa(el, mapa);
    mapa.dibujar(d.vivo.tiendas, d.vivo.posiciones.map((m) => ({
      lat: m.lat, lng: m.lng, texto: m.nombre, color: m.tipo === 'salida' ? '#a88f9c' : m.estado === 'dentro' ? '#1f9d6b' : m.estado === 'fuera' ? '#d93b4a' : '#e0a100',
      popup: `<b>${esc(nombreBonito(m.nombre))}</b><br>${m.tipo === 'salida' ? 'Salió' : m.tipo === 'entrada' ? 'Entrada' : 'Reporte'} ${m.hora.slice(0, 5)} · ${m.estado === 'dentro' ? 'en tienda' : m.estado === 'fuera' ? fmtDist(m.distancia_m) + ' fuera' : 'impreciso'}<br>±${Math.round(m.precision_m)} m`,
    })));
  },
  async accion(a, el, P) {
    if (a === 'volverHoy') { ui.fecha = null; ui.texto = null; return P.refrescar(); }
    if (a === 'copiar') {
      const txt = textoReporte(P.datos.hoy, P);
      try { await navigator.clipboard.writeText(txt); toast('Reporte copiado. Pégalo en WhatsApp.'); ui.texto = null; } catch { ui.texto = txt; }
      return P.pintar();
    }
    if (a === 'aviso') { P.api.post('/panel/avisos', { clave: el.dataset.clave, tipo: 'recordatorio' }).then(() => P.refrescar({ silencioso: true })); return; }
    if (a === 'demoReloj') {
      const f = document.getElementById('demoF').value, h = document.getElementById('demoH').value;
      await P.api.post('/panel/demo/reloj', f ? { fecha: f, hora: h || '12:00' } : {});
      toast(f ? `Reloj simulado: ${f} ${h}` : 'Reloj real.'); return P.refrescar();
    }
    if (a === 'demoReal') { await P.api.post('/panel/demo/reloj', {}); toast('Reloj real.'); return P.refrescar(); }
  },
  async alCambiar(el, P) {
    if (el.id === 'hoyFecha') { ui.fecha = el.value || null; ui.texto = null; return P.refrescar(); }
    if (el.id === 'hoyTienda') { ui.tienda = el.value; return P.refrescar(); }
  },
};

function demoBar(P) {
  if (!P.esAdmin()) return '';
  const a = P.ahora;
  return `<div class="demo-bar no-print"><b>Demostración</b><span>Reloj del sistema:</span>
    <input type="date" id="demoF" value="${a.fecha}"><input type="time" id="demoH" value="${a.hora}">
    <button type="button" class="btn-sm btn-p" data-accion="demoReloj">Simular</button>${P.relojSimulado ? '<button type="button" class="btn-sm" data-accion="demoReal">Volver a la hora real</button>' : ''}
    <span class="tiny muted">Adelanta la hora para ver pasar los reportes de ${P.ajustes.intervaloControlMin} min.</span></div>`;
}
