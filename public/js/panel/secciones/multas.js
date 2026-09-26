/* Multas: deudas por persona, justificaciones, cobros y notificaciones. */
import { esc, fCorta, fLarga, nombreBonito, primerNombre, soles, waLink, NOMBRE_MULTA } from '../../core/util.js';
import { toast, abrirCapa, cerrarCapa, confirmar } from '../../core/ui.js';

const ui = { estado: 'pendiente', usuario: '' };

const textoMulta = (m, P, pendiente) => `Hola ${primerNombre(m.usuario_nombre)}, se registró una multa de ${soles(m.monto)} por ${NOMBRE_MULTA[m.tipo].toLowerCase()} el ${fLarga(m.fecha)} (${m.detalle}).${pendiente != null ? ` Total pendiente: ${soles(pendiente)}.` : ''} Si tienes una justificación, envíala desde la app. — ${P.empresa.nombre}`;

export default {
  id: 'multas', titulo: 'Multas', icono: 'multa', grupo: 'Gestión',
  async cargar(P) {
    const [m, j] = await Promise.all([P.api.get(`/panel/multas?estado=${ui.estado}&usuario=${ui.usuario}`), P.api.get('/panel/justificaciones')]);
    return { ...m, justificaciones: j };
  },
  render(d, P) {
    const r = d.resumen, aj = d.ajustes;
    const pendDe = new Map(r.porUsuario.map((u) => [u.id, u.pendiente]));
    const kpis = `<div class="kpis"><div class="kpi k-bad"><span>Pendiente por cobrar</span><b>${soles(r.pendiente)}</b><small>${r.nPendientes} multa${r.nPendientes === 1 ? '' : 's'}</small></div>
      <div class="kpi k-ok"><span>Cobrado este mes</span><b>${soles(r.cobradoMes)}</b><small>${r.nPagadas} pagadas en total</small></div>
      <div class="kpi k-warn"><span>Sin notificar</span><b>${r.sinNotificar}</b><small>avisa por WhatsApp</small></div>
      <div class="kpi k-berry"><span>Montos vigentes</span><b style="font-size:1.1rem;padding-top:6px">Tardanza ${soles(aj.tardanza)}</b><small>Falta ${soles(aj.falta)}${aj.salidaAnticipada ? ` · Salida ant. ${soles(aj.salidaAnticipada)}` : ''}${P.esAdmin() ? ' · <button type="button" class="btn-link" data-ir="ajustes">cambiar</button>' : ''}</small></div></div>`;
    const pendJ = d.justificaciones.filter((j) => j.estado === 'pendiente');
    const just = pendJ.length ? `<div class="card" style="border-color:#b8cdf5"><h2>Justificaciones por revisar (${pendJ.length})</h2>${pendJ.map((j) => `<div class="lista-row" style="align-items:flex-start"><div class="grow"><b>${esc(nombreBonito(j.usuario_nombre))}</b> · ${NOMBRE_MULTA[j.multa_tipo] || ''} del ${j.multa_fecha ? fCorta(j.multa_fecha) : '—'} (${soles(j.multa_monto)})
        <div class="small">“${esc(j.motivo)}”</div><div class="tiny muted">${esc(j.multa_detalle || '')}</div></div>
      <div class="row nw"><button type="button" class="btn-sm btn-ok" data-accion="aprobar" data-id="${j.id}">Aprobar y anular multa</button><button type="button" class="btn-sm btn-bad" data-accion="rechazar" data-id="${j.id}">Rechazar</button></div></div>`).join('')}</div>` : '';
    const deudas = `<div class="deudas">${r.porUsuario.map((u) => {
      const resumen = `Hola ${primerNombre(u.nombre)}, tu total de multas pendientes en ${P.empresa.nombre} es ${soles(u.pendiente)}. Cuando pagues, avísame para registrarlo. Gracias.`;
      return `<div class="deuda ${u.pendiente ? '' : 'cero'}"><div class="row between"><b>${esc(nombreBonito(u.nombre))}</b><span class="chip ${u.pendiente ? 'bad' : 'ok'}">${u.n ? `${u.n} pendiente${u.n > 1 ? 's' : ''}` : 'al día'}</span></div>
        <span class="monto">${soles(u.pendiente)}</span>
        <div class="row">${u.pendiente ? `<button type="button" class="btn-sm btn-ok" data-accion="pagarTodo" data-id="${u.id}" data-monto="${u.pendiente}" data-nombre="${esc(u.nombre)}">Registrar pago</button><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${waLink(u.telefono, resumen)}">Recordar</a>` : '<span class="small muted">Sin deudas</span>'}
        <button type="button" class="btn-link small" data-accion="verDe" data-id="${u.id}">Ver detalle</button></div></div>`;
    }).join('')}</div>`;
    const tabla = `<div class="card"><div class="row between"><h2>Registro de multas</h2>
      <div class="row"><select id="mfEstado" data-fijo="1" style="width:auto">${[['pendiente', 'Pendientes'], ['pagada', 'Pagadas'], ['anulada', 'Anuladas'], ['todas', 'Todas']].map(([k, t]) => `<option value="${k}" ${ui.estado === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="mfUsuario" data-fijo="1" style="width:auto"><option value="">Todo el equipo</option>${r.porUsuario.map((u) => `<option value="${u.id}" ${String(u.id) === ui.usuario ? 'selected' : ''}>${esc(nombreBonito(u.nombre))}</option>`).join('')}</select>
      <button type="button" class="btn-sm" data-accion="manual">Multa manual</button><a class="btn btn-sm" href="/api/panel/export/multas.csv?estado=${ui.estado}">Excel (CSV)</a></div></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Fecha</th><th>Colaboradora</th><th>Tipo</th><th>Detalle</th><th class="r">Monto</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      ${d.lista.map((m) => `<tr><td class="num">${fCorta(m.fecha)}</td><td>${esc(nombreBonito(m.usuario_nombre))}</td><td><span class="chip ${m.tipo === 'falta' ? 'bad' : m.tipo === 'manual' ? 'grey' : 'warn'}">${NOMBRE_MULTA[m.tipo]}</span></td>
        <td class="small">${esc(m.detalle)}${m.motivo_anulada ? `<div class="tiny muted">${esc(m.motivo_anulada)}</div>` : ''}${m.justificacion === 'pendiente' ? '<div><span class="chip info">Justificación pendiente</span></div>' : ''}</td><td class="r"><b>${soles(m.monto)}</b></td>
        <td><span class="chip ${m.estado === 'pendiente' ? 'bad' : m.estado === 'pagada' ? 'ok' : 'grey'}">${m.estado}${m.estado === 'pagada' && m.pagada ? ' ' + new Date(m.pagada).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit' }) : ''}</span>${m.estado === 'pendiente' ? `<div class="tiny muted">${m.notificada ? 'notificada' : 'sin notificar'}${m.vista ? ' · vista' : ''}</div>` : ''}</td>
        <td><div class="row nw">${m.estado === 'pendiente' ? `<button type="button" class="btn-sm btn-ok" data-accion="pagar" data-id="${m.id}">Pagada</button>
          <a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${waLink(m.usuario_telefono, textoMulta(m, P, pendDe.get(m.usuario_id)))}" data-accion="notificar" data-id="${m.id}">${m.notificada ? 'Reenviar' : 'Notificar'}</a>
          <button type="button" class="btn-sm" data-accion="anular" data-id="${m.id}">Anular</button>` : `<button type="button" class="btn-sm" data-accion="reabrir" data-id="${m.id}">Deshacer</button>`}</div></td></tr>`).join('') || `<tr><td colspan="7" class="muted">No hay multas ${ui.estado === 'todas' ? '' : ui.estado + 's'}.</td></tr>`}</tbody></table></div>
      <div class="small muted">Las multas se generan solas: tardanza cuando se llega más de ${P.ajustes.toleranciaMin} min tarde; falta cuando termina el turno sin haber marcado entrada. Una falta se anula sola si luego aparece la entrada.</div></div>`;
    const historial = d.justificaciones.filter((j) => j.estado !== 'pendiente').slice(0, 20);
    const hist = historial.length ? `<details class="bloque" id="detJust"><summary>Justificaciones resueltas</summary><div class="cuerpo">${historial.map((j) => `<div class="lista-row"><span><b>${esc(nombreBonito(j.usuario_nombre))}</b> · “${esc(j.motivo)}”<br><span class="tiny muted">${j.resuelta_por_nombre ? 'por ' + esc(nombreBonito(j.resuelta_por_nombre)) : ''}${j.respuesta ? ' · ' + esc(j.respuesta) : ''}</span></span><span class="chip ${j.estado === 'aprobada' ? 'ok' : 'bad'}">${j.estado}</span></div>`).join('')}</div></details>` : '';
    return `${kpis}${just}${deudas}${tabla}${hist}`;
  },
  async accion(a, el, P) {
    const id = el.dataset.id;
    const cambiar = async (estado, motivo) => { await P.api.post(`/panel/multas/${id}/estado`, { estado, motivo }); P.refrescar({ silencioso: true }); };
    if (a === 'pagar') { await cambiar('pagada'); return toast('Multa marcada como pagada.'); }
    if (a === 'reabrir') { await cambiar('pendiente'); return toast('La multa volvió a pendiente.'); }
    if (a === 'notificar') { P.api.post(`/panel/multas/${id}/notificada`).then(() => P.refrescar({ silencioso: true })); return; }
    if (a === 'anular') {
      const m = abrirCapa(`<h2>Anular multa</h2><label class="f">Motivo<input type="text" id="anM" maxlength="200" placeholder="Ej.: permiso coordinado"></label>
        <div class="row" style="justify-content:flex-end"><button type="button" data-cerrar>Cancelar</button><button type="button" class="btn-dark" data-ok>Anular</button></div>`);
      m.querySelector('[data-ok]').addEventListener('click', async () => { await cambiar('anulada', m.querySelector('#anM').value || undefined); cerrarCapa(); toast('Multa anulada.'); });
      return;
    }
    if (a === 'pagarTodo') {
      if (!(await confirmar({ titulo: `¿Registrar pago de ${soles(el.dataset.monto)}?`, texto: `Todas las multas pendientes de ${esc(nombreBonito(el.dataset.nombre))} quedarán como pagadas.`, si: 'Registrar pago' }))) return;
      await P.api.post(`/panel/usuarios/${id}/pagar-todo`); toast('Pago registrado.'); return P.refrescar();
    }
    if (a === 'verDe') { ui.usuario = id; ui.estado = 'todas'; await P.refrescar(); document.getElementById('mfUsuario')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (a === 'aprobar' || a === 'rechazar') {
      const m = abrirCapa(`<h2>${a === 'aprobar' ? 'Aprobar justificación' : 'Rechazar justificación'}</h2><label class="f">Respuesta para la colaboradora (opcional)<input type="text" id="jR" maxlength="300"></label>
        <div class="row" style="justify-content:flex-end"><button type="button" data-cerrar>Cancelar</button><button type="button" class="${a === 'aprobar' ? 'btn-p' : 'btn-dark'}" data-ok>${a === 'aprobar' ? 'Aprobar y anular multa' : 'Rechazar'}</button></div>`);
      m.querySelector('[data-ok]').addEventListener('click', async () => {
        await P.api.post(`/panel/justificaciones/${id}/resolver`, { aprobar: a === 'aprobar', respuesta: m.querySelector('#jR').value || undefined });
        cerrarCapa(); toast(a === 'aprobar' ? 'Justificación aprobada: multa anulada.' : 'Justificación rechazada.'); P.refrescar();
      });
      return;
    }
    if (a === 'manual') {
      const d = P.datos.multas;
      const m = abrirCapa(`<h2>Multa manual</h2><p class="small muted">Para faltas al reglamento que el sistema no detecta (uniforme, celular en horario, etc.).</p>
        <div class="grid-form"><label class="f">Colaboradora<select id="mmU">${d.resumen.porUsuario.map((u) => `<option value="${u.id}">${esc(nombreBonito(u.nombre))}</option>`).join('')}</select></label>
        <label class="f">Fecha<input type="date" id="mmF" value="${P.ahora.fecha}"></label><label class="f">Monto<div class="moneda"><span>S/</span><input type="number" id="mmM" min="0.5" step="0.5" value="5"></div></label></div>
        <label class="f">Motivo<input type="text" id="mmD" maxlength="200" required></label>
        <div class="row" style="justify-content:flex-end"><button type="button" data-cerrar>Cancelar</button><button type="button" class="btn-p" data-ok>Registrar</button></div>`);
      m.querySelector('[data-ok]').addEventListener('click', async () => {
        try {
          await P.api.post('/panel/multas', { usuario_id: Number(m.querySelector('#mmU').value), fecha: m.querySelector('#mmF').value, monto: Number(m.querySelector('#mmM').value), detalle: m.querySelector('#mmD').value });
          cerrarCapa(); toast('Multa registrada.'); P.refrescar();
        } catch (e) { toast(e.message, 'bad'); }
      });
    }
  },
  alCambiar(el, P) {
    if (el.id === 'mfEstado') { ui.estado = el.value; return P.refrescar(); }
    if (el.id === 'mfUsuario') { ui.usuario = el.value; return P.refrescar(); }
  },
};
