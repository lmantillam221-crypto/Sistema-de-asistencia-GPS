/* Horarios: semana de turnos, asignación, plantilla semanal y días especiales (feriados y campañas). */
import { esc, cap, fCorta, fLarga, nombreBonito, sumarDias, lunesDe, diaDe, hora12, waLink, DIAS, DIAS_C, ORDEN_SEMANA } from '../../core/util.js';
import { toast, abrirCapa, cerrarCapa, confirmar } from '../../core/ui.js';

const corto = (n) => { const p = nombreBonito(n).split(' '); return p[1] ? `${p[0]} ${p[1][0]}.` : p[0]; };
const ui = { lunes: null, tienda: '', plantilla: null, tiendaPl: null };

export default {
  id: 'horarios', titulo: 'Horarios', icono: 'calendario', grupo: 'Operación',
  async cargar(P) {
    const [s, pl] = await Promise.all([P.api.get(`/panel/semana?lunes=${ui.lunes || ''}&tienda=${ui.tienda}`), P.api.get('/panel/plantillas')]);
    ui.lunes = s.lunes;
    if (ui.tiendaPl == null && pl.tiendas[0]) ui.tiendaPl = pl.tiendas[0].id;
    return { ...s, pl };
  },
  render(d, P) {
    const v = d.ventana, hoy = P.ahora.fecha, esta = lunesDe(hoy), lunes = d.lunes;
    const etiqueta = lunes === esta ? 'Semana actual' : lunes === sumarDias(esta, 7) ? (v.esHoy || v.abierta ? 'Semana siguiente · la que se elige hoy' : 'Semana siguiente') : lunes < esta ? 'Semana pasada' : 'Semana futura';
    const aviso = `📅 *${P.empresa.nombre}*: ${v.abierta ? 'ya está abierta' : `el ${fLarga(v.fecha)} de ${hora12(v.desde)} a ${hora12(v.hasta)} se abre`} la elección de horarios para la semana del ${fCorta(v.semana)}. Entren a la app con su usuario y clave y elijan su turno. ¡El primero que elige se queda con el turno! ${location.origin}`;
    const ventana = `<div class="card ventana ${v.abierta ? 'abierta' : ''}"><div class="reloj" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${v.abierta ? '#fff' : '#c7336c'}" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
      <div style="flex:1;min-width:220px">${v.abierta ? `<h2>La elección de horarios está abierta</h2><div class="small muted">El equipo elige ahora sus turnos para la semana del ${fCorta(v.semana)}. Cierra a las ${hora12(v.hasta)} (quedan ${v.quedan} min).</div>`
        : v.esHoy ? `<h2>Hoy ${DIAS[v.dia]} se eligen los horarios de la semana siguiente</h2><div class="small muted">Prepara ahora los turnos del ${fCorta(v.semana)} al ${fCorta(sumarDias(v.semana, 6))} (abajo). A las ${hora12(v.desde)} el equipo podrá elegir con su usuario y clave hasta las ${hora12(v.hasta)}; fuera de ese horario solo tú puedes asignar.</div>`
        : `<h2>Próxima elección: ${fLarga(v.fecha)}, de ${hora12(v.desde)} a ${hora12(v.hasta)}</h2><div class="small muted">Para la semana del ${fCorta(v.semana)} al ${fCorta(sumarDias(v.semana, 6))}. Solo en ese horario el equipo elige con su usuario y clave; tú puedes asignar o cambiar turnos en cualquier momento.</div>`}</div>
      <a class="btn btn-wa" target="_blank" rel="noopener" href="${waLink('', aviso)}">Avisar al grupo</a></div>`;

    const esp = new Map(d.especiales.map((e) => [e.fecha + '|' + (e.tienda_id ?? ''), e]));
    const opciones = (sel) => `<option value="">— Libre —</option>${d.colaboradores.map((u) => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''} title="${esc(nombreBonito(u.nombre))}">${esc(corto(u.nombre))}</option>`).join('')}`;
    const variasTiendas = d.tiendas.length > 1 && !ui.tienda;
    let libres = 0;
    const dias = [];
    for (let i = 0; i < 7; i++) {
      const f = sumarDias(lunes, i), ts = d.turnos.filter((t) => t.fecha === f);
      libres += ts.filter((t) => !t.usuario_id).length;
      const e = esp.get(f + '|' + (ui.tienda || '')) || esp.get(f + '|');
      dias.push(`<div class="dia ${f === hoy ? 'hoy' : ''} ${e ? 'especial' : ''}"><div class="row between"><div><div class="d">${DIAS_C[diaDe(f)]}${f === hoy ? ' · hoy' : ''}</div><div class="fe">${f.slice(8)}/${f.slice(5, 7)}</div></div>
          <button type="button" class="btn-sm btn-ghost" data-accion="extra" data-fecha="${f}" title="Agregar turno extra" aria-label="Agregar turno extra el ${fCorta(f)}">＋</button></div>
        ${e ? `<span class="chip warn" title="${esc(e.motivo)}">${e.cerrado ? 'Cerrado' : 'Horario especial'}${e.motivo ? ' · ' + esc(e.motivo) : ''}</span>` : ''}
        ${ts.length ? ts.map((t) => `<div class="turno ${t.usuario_id ? '' : 'libre'} ${t.origen === 'manual' ? 'extra' : ''}"><span class="h"><span>${t.inicio}–${t.fin}${variasTiendas ? ` · ${esc(nombreBonito(t.tienda_nombre))}` : ''}</span>${t.origen === 'manual' ? `<button type="button" class="btn-sm btn-ghost btn-bad" style="padding:0 4px" data-accion="borrarTurno" data-id="${t.id}" aria-label="Eliminar turno extra">✕</button>` : ''}</span>
          <select id="asig-${t.id}" data-asignar="${t.id}" data-fijo="1" aria-label="Asignar turno ${fCorta(f)} ${t.inicio}">${opciones(t.usuario_id)}</select>
          ${t.usuario_id ? `<span class="tiny muted">${{ colaborador: 'Lo eligió', supervisor: 'Asignado', cobertura: 'Por cobertura' }[t.asignado_por] || 'Asignado'}</span>` : ''}</div>`).join('') : '<span class="tiny muted">Sin turnos</span>'}</div>`);
    }
    const sinTurno = d.colaboradores.filter((u) => !d.turnos.some((t) => t.usuario_id === u.id));
    const semana = `<div class="card"><div class="row between"><div class="row"><button type="button" data-accion="semana" data-v="${sumarDias(lunes, -7)}" aria-label="Semana anterior">‹</button>
        <div><div class="eyebrow">${etiqueta}</div><h2>${fCorta(lunes)} al ${fCorta(sumarDias(lunes, 6))}</h2></div><button type="button" data-accion="semana" data-v="${sumarDias(lunes, 7)}" aria-label="Semana siguiente">›</button>
        ${lunes !== esta ? `<button type="button" class="btn-sm" data-accion="semana" data-v="${esta}">Semana actual</button>` : ''}${lunes !== sumarDias(esta, 7) ? `<button type="button" class="btn-sm" data-accion="semana" data-v="${sumarDias(esta, 7)}">Siguiente</button>` : ''}</div>
        <div class="row">${d.tiendas.length > 1 ? `<select id="hTienda" data-fijo="1" style="width:auto"><option value="">Todas las tiendas</option>${d.tiendas.map((t) => `<option value="${t.id}" ${String(t.id) === ui.tienda ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select>` : ''}
        <a class="btn btn-wa" target="_blank" rel="noopener" href="${waLink('', d.texto)}">Compartir horario</a></div></div>
      <div class="dias">${dias.join('')}</div>
      <div class="row">${libres ? `<span class="chip warn">${libres} turno${libres > 1 ? 's' : ''} sin cubrir</span>` : '<span class="chip ok">Todos los turnos cubiertos</span>'}
        ${sinTurno.length ? `<span class="small muted">Sin turno esta semana: ${sinTurno.map((u) => esc(nombreBonito(u.nombre))).join(', ')}</span>` : ''}</div></div>`;
    return `${ventana}${semana}${plantillaHtml(d.pl, P)}${especialesHtml(d.pl, P)}`;
  },
  async accion(a, el, P) {
    const ds = el.dataset;
    if (a === 'semana') { ui.lunes = ds.v; return P.refrescar(); }
    if (a === 'extra') return turnoExtra(ds.fecha, P);
    if (a === 'borrarTurno') { if (!(await confirmar({ titulo: '¿Eliminar este turno extra?', si: 'Eliminar', peligro: true }))) return; await P.api.del(`/panel/turnos/${ds.id}`); toast('Turno eliminado.'); return P.refrescar(); }
    // plantilla
    const pl = () => (ui.plantilla ||= P.datos.horarios.pl.plantillas.filter((x) => x.tienda_id === ui.tiendaPl).map((x) => ({ dia: x.dia, inicio: x.inicio, fin: x.fin, cupos: x.cupos })));
    if (a === 'plAgregar') { pl().push({ dia: Number(ds.dia), inicio: '16:00', fin: '19:00', cupos: 1 }); return P.pintar(); }
    if (a === 'plQuitar') { pl().splice(Number(ds.i), 1); return P.pintar(); }
    if (a === 'plCopiar') { const base = pl().filter((x) => x.dia === 1); ui.plantilla = [...base, ...[2, 3, 4, 5, 6, 0].flatMap((dia) => base.map((x) => ({ ...x, dia })))]; return P.pintar(); }
    if (a === 'plDescartar') { ui.plantilla = null; return P.pintar(); }
    if (a === 'plGuardar') {
      await P.api.put(`/panel/tiendas/${ui.tiendaPl}/plantillas`, { turnos: pl() });
      ui.plantilla = null; toast('Plantilla guardada. Las semanas futuras se actualizaron.'); return P.refrescar();
    }
    if (a === 'espNuevo') return diaEspecial(P);
    if (a === 'espBorrar') { await P.api.del(`/panel/dias-especiales/${ds.id}`); toast('Día especial eliminado.'); return P.refrescar(); }
  },
  async alCambiar(el, P) {
    if (el.dataset.asignar) {
      const uid = el.value ? Number(el.value) : null;
      try { await P.api.put(`/panel/turnos/${el.dataset.asignar}/asignar`, { usuarioId: uid }); toast(uid ? 'Turno asignado.' : 'Turno liberado.'); } catch (e) { toast(e.message, 'bad'); }
      return P.refrescar({ silencioso: true });
    }
    if (el.id === 'hTienda') { ui.tienda = el.value; return P.refrescar(); }
    if (el.id === 'plTienda') { ui.tiendaPl = Number(el.value); ui.plantilla = null; return P.pintar(); }
  },
  alEscribir(el, P) {
    if (el.dataset.pl) {
      const [i, k] = el.dataset.pl.split('|');
      ui.plantilla ||= P.datos.horarios.pl.plantillas.filter((x) => x.tienda_id === ui.tiendaPl).map((x) => ({ dia: x.dia, inicio: x.inicio, fin: x.fin, cupos: x.cupos }));
      ui.plantilla[Number(i)][k] = k === 'cupos' ? Number(el.value) || 1 : el.value;
      const b = document.getElementById('plGuardar'); if (b) b.disabled = false;
    }
  },
};

function plantillaHtml(pl, P) {
  if (!pl.tiendas.length) return '<div class="msg warn">Primero registra una tienda en <button type="button" class="btn-link" data-ir="tiendas">Tiendas</button>.</div>';
  const lista = ui.plantilla || pl.plantillas.filter((x) => x.tienda_id === ui.tiendaPl).map((x) => ({ dia: x.dia, inicio: x.inicio, fin: x.fin, cupos: x.cupos }));
  const admin = P.esAdmin();
  return `<details class="bloque" id="detPlantilla"><summary><span>Plantilla semanal <span class="small muted" style="font-weight:600">· turnos de cada día y cuántas personas atienden a la vez</span></span></summary><div class="cuerpo">
    ${pl.tiendas.length > 1 ? `<label class="f" style="max-width:280px">Tienda<select id="plTienda" data-fijo="1">${pl.tiendas.map((t) => `<option value="${t.id}" ${t.id === ui.tiendaPl ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></label>` : ''}
    <div class="small muted">Los cambios se aplican desde mañana a los turnos libres. Los turnos ya asignados conservan su horario. "Cupos" = personas que atienden a la vez (útil en campañas).</div>
    <div>${ORDEN_SEMANA.map((dia) => `<div class="regla"><b>${cap(DIAS[dia])}</b><div class="tlist">${lista.map((t, i) => (t.dia !== dia ? '' : `<span class="tedit"><input type="time" id="pl-${i}-i" data-pl="${i}|inicio" data-fijo="1" value="${t.inicio}" aria-label="Inicio" ${admin ? '' : 'disabled'}><span>–</span><input type="time" id="pl-${i}-f" data-pl="${i}|fin" data-fijo="1" value="${t.fin}" aria-label="Fin" ${admin ? '' : 'disabled'}>
        <input type="number" id="pl-${i}-c" data-pl="${i}|cupos" data-fijo="1" value="${t.cupos}" min="1" max="10" title="Cupos" aria-label="Cupos" ${admin ? '' : 'disabled'}>${admin ? `<button type="button" class="btn-sm btn-bad" data-accion="plQuitar" data-i="${i}" aria-label="Quitar">✕</button>` : ''}</span>`)).join('') || '<span class="tiny muted">Cerrado</span>'}
      ${admin ? `<button type="button" class="btn-sm" data-accion="plAgregar" data-dia="${dia}">+ Turno</button>${dia === 1 ? '<button type="button" class="btn-sm" data-accion="plCopiar">Copiar lunes a todos</button>' : ''}` : ''}</div></div>`).join('')}</div>
    ${admin ? `<div class="row"><button type="button" class="btn-p" id="plGuardar" data-accion="plGuardar" ${ui.plantilla ? '' : 'disabled'}>Guardar plantilla</button>${ui.plantilla ? '<button type="button" data-accion="plDescartar">Descartar</button>' : ''}</div>` : '<div class="small muted">Solo un administrador puede cambiar la plantilla.</div>'}</div></details>`;
}

function especialesHtml(pl, P) {
  const lista = pl.especiales.filter((e) => e.fecha >= P.ahora.fecha);
  const tn = (id) => (id ? pl.tiendas.find((t) => t.id === id)?.nombre || '—' : 'Todas');
  return `<details class="bloque" id="detEspeciales"><summary><span>Feriados y horarios de campaña <span class="small muted" style="font-weight:600">· cierres, Día de la Madre, Navidad, liquidaciones…</span></span>${lista.length ? `<span class="chip warn">${lista.length}</span>` : ''}</summary><div class="cuerpo">
    ${lista.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Fecha</th><th>Tienda</th><th>Tipo</th><th>Motivo</th><th></th></tr></thead><tbody>${lista.map((e) => `<tr><td>${cap(fLarga(e.fecha))}</td><td>${esc(tn(e.tienda_id))}</td>
      <td>${e.cerrado ? '<span class="chip bad">Cerrado</span>' : e.turnos.map((t) => `<span class="chip pink">${t.inicio}–${t.fin}${t.cupos > 1 ? ` ×${t.cupos}` : ''}</span>`).join(' ')}</td><td>${esc(e.motivo)}</td>
      <td>${P.esAdmin() ? `<button type="button" class="btn-sm btn-bad" data-accion="espBorrar" data-id="${e.id}">Quitar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="small muted">No hay días especiales próximos.</div>'}
    ${P.esAdmin() ? '<div><button type="button" class="btn-p" data-accion="espNuevo">Agregar día especial</button></div>' : ''}</div></details>`;
}

function turnoExtra(fecha, P) {
  const d = P.datos.horarios;
  const el = abrirCapa(`<h2>Turno extra · ${cap(fLarga(fecha))}</h2><p class="small muted">Para reforzar la atención (campañas, inventario, llegada de mercadería).</p>
    <div class="grid-form">${d.tiendas.length > 1 ? `<label class="f">Tienda<select id="xT">${d.tiendas.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('')}</select></label>` : ''}
      <label class="f">Inicio<input type="time" id="xI" value="10:00"></label><label class="f">Fin<input type="time" id="xF" value="13:00"></label>
      <label class="f">Asignar a<select id="xU"><option value="">— Libre —</option>${d.colaboradores.map((u) => `<option value="${u.id}">${esc(nombreBonito(u.nombre))}</option>`).join('')}</select></label></div>
    <div class="row" style="justify-content:flex-end"><button type="button" data-cerrar>Cancelar</button><button type="button" class="btn-p" data-ok>Crear turno</button></div>`);
  el.querySelector('[data-ok]').addEventListener('click', async () => {
    try {
      await P.api.post('/panel/turnos', { tienda_id: Number(el.querySelector('#xT')?.value || d.tiendas[0].id), fecha, inicio: el.querySelector('#xI').value, fin: el.querySelector('#xF').value, usuario_id: Number(el.querySelector('#xU').value) || null });
      cerrarCapa(); toast('Turno extra creado.'); P.refrescar();
    } catch (e) { toast(e.message, 'bad'); }
  });
}

function diaEspecial(P) {
  const pl = P.datos.horarios.pl;
  const el = abrirCapa(`<h2>Día especial</h2><p class="small muted">Reemplaza la plantilla ese día: cierra la tienda (feriado) o define un horario de campaña.</p>
    <div class="grid-form"><label class="f">Fecha<input type="date" id="eF" value="${sumarDias(P.ahora.fecha, 1)}"></label>
      <label class="f">Tienda<select id="eT"><option value="">Todas</option>${pl.tiendas.map((t) => `<option value="${t.id}">${esc(t.nombre)}</option>`).join('')}</select></label>
      <label class="f">Motivo<input type="text" id="eM" maxlength="120" placeholder="Ej.: Día de la Madre"></label></div>
    <label class="check"><input type="checkbox" id="eC"><span>La tienda estará <b>cerrada</b> ese día</span></label>
    <div id="eTurnos"><div class="eyebrow" style="margin-bottom:6px">Turnos del día</div><div class="tlist" id="eLista">${filaTurno('10:00', '14:00', 2)}${filaTurno('14:00', '21:00', 2)}</div>
      <button type="button" class="btn-sm" id="eMas" style="margin-top:8px">+ Turno</button></div>
    <div class="row" style="justify-content:flex-end"><button type="button" data-cerrar>Cancelar</button><button type="button" class="btn-p" data-ok>Guardar</button></div>`, { clase: 'modal ancho' });
  el.querySelector('#eC').addEventListener('change', (e) => { el.querySelector('#eTurnos').hidden = e.target.checked; });
  el.querySelector('#eMas').addEventListener('click', () => el.querySelector('#eLista').insertAdjacentHTML('beforeend', filaTurno('16:00', '19:00', 1)));
  el.addEventListener('click', (e) => { if (e.target.closest('[data-quitar]')) e.target.closest('.tedit').remove(); });
  el.querySelector('[data-ok]').addEventListener('click', async () => {
    const turnos = [...el.querySelectorAll('#eLista .tedit')].map((x) => ({ inicio: x.querySelector('.i').value, fin: x.querySelector('.f').value, cupos: Number(x.querySelector('.c').value) || 1 }));
    try {
      await P.api.post('/panel/dias-especiales', { fecha: el.querySelector('#eF').value, tienda_id: Number(el.querySelector('#eT').value) || null, cerrado: el.querySelector('#eC').checked, motivo: el.querySelector('#eM').value, turnos });
      cerrarCapa(); toast('Día especial guardado.'); P.refrescar();
    } catch (e) { toast(e.message, 'bad'); }
  });
}
const filaTurno = (i, f, c) => `<span class="tedit"><input type="time" class="i" value="${i}" aria-label="Inicio"><span>–</span><input type="time" class="f" value="${f}" aria-label="Fin"><input type="number" class="c" value="${c}" min="1" max="10" title="Cupos" aria-label="Cupos"><button type="button" class="btn-sm btn-bad" data-quitar aria-label="Quitar">✕</button></span>`;
