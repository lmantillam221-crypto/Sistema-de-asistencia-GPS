/* Equipo: colaboradoras, supervisión y administración. */
import { esc, nombreBonito, primerNombre, iniciales, waLink } from '../../core/util.js';
import { toast, abrirCapa, cerrarCapa, confirmar } from '../../core/ui.js';

const ROL = { admin: 'Administración', supervisor: 'Supervisión', colaborador: 'Colaboradora' };
const ui = { inactivos: false, buscar: '' };
const pinAleatorio = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));

function mensajeAcceso(u, secreto, P) {
  return `Hola ${primerNombre(u.nombre)} 👋 Estos son tus datos para la app de asistencia de ${P.empresa.nombre}:\n\n🔗 ${location.origin}\n👤 Usuario: ${u.codigo}\n🔑 Clave: ${secreto}\n\nÁbrela en tu celular, instálala en tu pantalla de inicio y permite la ubicación al marcar tu entrada. ¡Gracias!`;
}

export default {
  id: 'equipo', titulo: 'Equipo', icono: 'equipo', grupo: 'Gestión',
  async cargar(P) {
    const [u, t] = await Promise.all([P.api.get('/panel/usuarios'), P.api.get('/panel/tiendas')]);
    return { ...u, tiendas: t };
  },
  render(d, P) {
    const q = ui.buscar.toLowerCase();
    const lista = d.usuarios.filter((u) => (ui.inactivos || u.activo) && (!q || `${u.codigo} ${u.nombre}`.toLowerCase().includes(q)));
    const tn = (id) => d.tiendas.find((t) => t.id === id)?.nombre || '—';
    const nCol = d.usuarios.filter((u) => u.rol === 'colaborador' && u.activo).length;
    return `<div class="card"><div class="row between"><div><h2>${nCol} colaboradora${nCol === 1 ? '' : 's'} activa${nCol === 1 ? '' : 's'}</h2><span class="small muted">Cada persona ingresa a la app con su usuario y su clave (PIN). La app registra el celular con el que marca; si cambia de celular, desvincúlalo aquí.</span></div>
      <div class="row"><input type="search" id="eqBuscar" placeholder="Buscar…" value="${esc(ui.buscar)}" style="width:180px"><label class="check small"><input type="checkbox" id="eqInactivos" ${ui.inactivos ? 'checked' : ''}><span>Ver inactivos</span></label>
      <button type="button" class="btn-p" data-accion="nuevo">Agregar persona</button></div></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Persona</th><th>Usuario</th><th>Rol</th>${d.tiendas.length > 1 ? '<th>Tienda</th>' : ''}<th>Celular</th><th>App</th><th>Estado</th><th></th></tr></thead><tbody>
      ${lista.map((u) => `<tr style="${u.activo ? '' : 'opacity:.55'}"><td><div class="persona"><span class="avatar">${esc(iniciales(u.nombre))}</span><b>${esc(nombreBonito(u.nombre))}</b></div></td>
        <td class="num"><b>${esc(u.codigo)}</b></td><td><span class="chip ${u.rol === 'colaborador' ? 'pink' : 'info'}">${ROL[u.rol]}</span></td>${d.tiendas.length > 1 ? `<td>${esc(tn(u.tienda_id))}</td>` : ''}
        <td class="num">${u.telefono ? `<a href="${waLink(u.telefono, '')}" target="_blank" rel="noopener">+51 ${esc(u.telefono)}</a>` : '<span class="muted">—</span>'}</td>
        <td>${u.rol === 'colaborador' ? (u.dispositivoVinculado ? '<span class="chip ok">Celular vinculado</span>' : '<span class="chip grey">Sin vincular</span>') : '—'}</td>
        <td>${u.activo ? '<span class="chip ok">Activo</span>' : '<span class="chip grey">Inactivo</span>'}</td>
        <td><div class="row nw">${P.esAdmin() || u.rol === 'colaborador' ? `<button type="button" class="btn-sm" data-accion="editar" data-id="${u.id}">Editar</button><button type="button" class="btn-sm" data-accion="clave" data-id="${u.id}">${u.rol === 'colaborador' ? 'Nuevo PIN' : 'Nueva clave'}</button>
          ${u.dispositivoVinculado ? `<button type="button" class="btn-sm" data-accion="desvincular" data-id="${u.id}" title="Permite marcar desde otro celular sin alerta">Desvincular</button>` : ''}` : ''}</div></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Sin resultados.</td></tr>'}</tbody></table></div></div>`;
  },
  async accion(a, el, P) {
    const d = P.datos.equipo, u = d.usuarios.find((x) => x.id === Number(el.dataset.id));
    if (a === 'nuevo') return formulario(null, P);
    if (a === 'editar') return formulario(u, P);
    if (a === 'desvincular') {
      if (!(await confirmar({ titulo: `¿Desvincular el celular de ${nombreBonito(u.nombre)}?`, texto: 'La próxima vez que marque, se vinculará el celular que use.', si: 'Desvincular' }))) return;
      await P.api.post(`/panel/usuarios/${u.id}/desvincular`); toast('Celular desvinculado.'); return P.refrescar();
    }
    if (a === 'clave') {
      const esPin = u.rol === 'colaborador';
      const sugerido = esPin ? pinAleatorio() : '';
      const m = abrirCapa(`<h2>${esPin ? 'Nuevo PIN' : 'Nueva contraseña'} · ${esc(nombreBonito(u.nombre))}</h2>
        <label class="f">${esPin ? 'PIN (4 a 8 números)' : 'Contraseña (mínimo 8 caracteres)'}<input type="text" id="nsClave" value="${sugerido}" ${esPin ? 'inputmode="numeric"' : ''} autocomplete="off"></label>
        <p class="small muted">Se cerrarán sus sesiones abiertas. ${esPin ? 'Envíale el PIN por WhatsApp.' : 'Deberá cambiarla al ingresar.'}</p>
        <div class="row" style="justify-content:flex-end"><button type="button" data-cerrar>Cancelar</button><button type="button" class="btn-p" data-ok>Guardar</button></div>`);
      m.querySelector('[data-ok]').addEventListener('click', async () => {
        const s = m.querySelector('#nsClave').value.trim();
        try {
          await P.api.post(`/panel/usuarios/${u.id}/clave`, { secreto: s });
          cerrarCapa(); toast('Clave actualizada.');
          if (esPin) avisoAcceso(u, s, P);
        } catch (e) { toast(e.message, 'bad'); }
      });
    }
  },
  alEscribir(el, P) { if (el.id === 'eqBuscar') { ui.buscar = el.value; P.pintar(); } },
  alCambiar(el, P) { if (el.id === 'eqInactivos') { ui.inactivos = el.checked; P.pintar(); } },
};

function avisoAcceso(u, secreto, P) {
  const m = abrirCapa(`<h2>Listo ✅</h2><p>Comparte los datos de acceso con <b>${esc(nombreBonito(u.nombre))}</b>:</p>
    <div class="msg pink" style="white-space:pre-line">${esc(mensajeAcceso(u, secreto, P))}</div>
    <div class="row" style="justify-content:flex-end"><button type="button" data-cerrar>Cerrar</button><a class="btn btn-wa" target="_blank" rel="noopener" href="${waLink(u.telefono, mensajeAcceso(u, secreto, P))}" data-cerrar>Enviar por WhatsApp</a></div>`);
  return m;
}

function formulario(u, P) {
  const d = P.datos.equipo, nuevo = !u;
  const roles = P.esAdmin() ? ['colaborador', 'supervisor', 'admin'] : ['colaborador'];
  const rol = u?.rol || 'colaborador';
  const m = abrirCapa(`<h2>${nuevo ? 'Agregar persona' : `Editar · ${esc(u.codigo)}`}</h2>
    <div class="grid-form">
      <label class="f">Nombre completo<input type="text" id="fN" value="${esc(u?.nombre || '')}" maxlength="80" required></label>
      <label class="f">Usuario<input type="text" id="fC" value="${esc(u?.codigo || d.siguiente)}" ${nuevo ? '' : 'disabled'} maxlength="20"><small>Con esto ingresa a la app</small></label>
      <label class="f">Celular (WhatsApp)<input type="tel" id="fT" value="${esc(u?.telefono || '')}" inputmode="numeric" placeholder="9 dígitos"></label>
      <label class="f">Rol<select id="fR">${roles.map((r) => `<option value="${r}" ${r === rol ? 'selected' : ''}>${ROL[r]}</option>`).join('')}</select></label>
      ${d.tiendas.length > 1 ? `<label class="f">Tienda habitual<select id="fTi"><option value="">—</option>${d.tiendas.map((t) => `<option value="${t.id}" ${t.id === u?.tienda_id ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></label>` : ''}
      ${nuevo ? `<label class="f"><span id="fSl">Clave (PIN)</span><input type="text" id="fS" value="${pinAleatorio()}" autocomplete="off"><small>PIN de 4 a 8 números; contraseña de 8+ para el panel</small></label>` : ''}
    </div>
    ${!nuevo ? `<label class="check"><input type="checkbox" id="fA" ${u.activo ? 'checked' : ''}><span>Activo (desmárcalo si ya no trabaja; su historial se conserva)</span></label>` : ''}
    <div class="row" style="justify-content:flex-end"><button type="button" data-cerrar>Cancelar</button><button type="button" class="btn-p" data-ok>${nuevo ? 'Agregar' : 'Guardar'}</button></div>`);
  m.querySelector('#fR').addEventListener('change', (e) => { const s = m.querySelector('#fS'); if (s) s.value = e.target.value === 'colaborador' ? pinAleatorio() : ''; });
  m.querySelector('[data-ok]').addEventListener('click', async () => {
    const body = {
      nombre: m.querySelector('#fN').value.trim(), telefono: m.querySelector('#fT').value.trim(), rol: m.querySelector('#fR').value,
      tienda_id: m.querySelector('#fTi') ? Number(m.querySelector('#fTi').value) || null : (d.tiendas[0]?.id ?? null),
    };
    try {
      if (nuevo) {
        const secreto = m.querySelector('#fS').value.trim();
        const r = await P.api.post('/panel/usuarios', { ...body, codigo: m.querySelector('#fC').value.trim(), secreto });
        cerrarCapa(); toast('Persona agregada.'); P.refrescar();
        if (r.rol === 'colaborador') avisoAcceso(r, secreto, P);
      } else {
        await P.api.put(`/panel/usuarios/${u.id}`, { ...body, activo: m.querySelector('#fA').checked });
        cerrarCapa(); toast('Datos guardados.'); P.refrescar();
      }
    } catch (e) { toast(e.message, 'bad'); }
  });
}
