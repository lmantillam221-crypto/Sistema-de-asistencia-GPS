/* =====================================================================
   Panel de control · administración y supervisión
   ===================================================================== */
import { api, onSesionVencida } from '../core/api.js';
import { toast, redibujar, activarTooltips, icono, cerrarCapa } from '../core/ui.js';
import { $, esc, cap, fLarga, LS, nombreBonito, iniciales, primerNombre, waLink } from '../core/util.js';
import hoy from './secciones/hoy.js';
import dashboard from './secciones/dashboard.js';
import horarios from './secciones/horarios.js';
import equipo from './secciones/equipo.js';
import multas from './secciones/multas.js';
import reportes from './secciones/reportes.js';
import tiendas from './secciones/tiendas.js';
import ajustes from './secciones/ajustes.js';
import auditoria from './secciones/auditoria.js';

const SECCIONES = [hoy, dashboard, horarios, multas, equipo, reportes, tiendas, ajustes, auditoria];
const raiz = $('#panel');

/** Contexto compartido con las secciones. */
export const P = {
  yo: null, empresa: null, ajustes: null, demo: false, ahora: null, relojSimulado: false,
  seccion: LS.get('nc_seccion') || 'hoy', datos: {}, cargando: false, vivo: false, badges: {},
  api, toast,
  async refrescar({ silencioso = false } = {}) {
    const s = seccionActual();
    if (!silencioso) { P.cargando = true; pintar(); }
    try { P.datos[s.id] = await s.cargar(P); } catch (e) { if (e.status !== 401) toast(e.message, 'bad'); }
    P.cargando = false;
    pintar();
  },
  pintar: () => pintar(),
  ir(id) { P.seccion = id; LS.set('nc_seccion', id); document.body.classList.remove('menu-abierto'); window.scrollTo({ top: 0 }); P.refrescar(); },
  esAdmin: () => P.yo?.rol === 'admin',
};
const seccionActual = () => SECCIONES.find((s) => s.id === P.seccion && (!s.soloAdmin || P.esAdmin())) || hoy;

function pintar() {
  if (!P.yo) return pintarLogin();
  const s = seccionActual();
  const grupos = [];
  for (const x of SECCIONES) {
    if (x.soloAdmin && !P.esAdmin()) continue;
    if (!grupos.length || grupos[grupos.length - 1].g !== x.grupo) grupos.push({ g: x.grupo, items: [] });
    grupos[grupos.length - 1].items.push(x);
  }
  const datos = P.datos[s.id];
  const cuerpo = datos === undefined ? '<div class="cargando"><span class="spinner"></span></div>' : s.render(datos, P);
  const a = P.ahora;
  redibujar(raiz, `<div class="p-app">
    <aside class="lateral" aria-label="Menú">
      <div class="marca"><img src="/assets/logo.webp" alt="${esc(P.empresa.nombre)}"><span>Panel de control</span></div>
      <nav>${grupos.map((g) => `<div class="grupo">${g.g}</div>${g.items.map((x) => `<button type="button" data-ir="${x.id}" ${x.id === s.id ? 'aria-current="page"' : ''}>${icono(x.icono, 19)}<span>${x.titulo}</span>${P.badges[x.id] ? `<span class="badge">${P.badges[x.id]}</span>` : ''}</button>`).join('')}`).join('')}</nav>
      <div class="pie"><div class="persona"><span class="avatar">${esc(iniciales(P.yo.nombre))}</span><span style="min-width:0"><b>${esc(nombreBonito(P.yo.nombre))}</b><span class="tiny">${P.yo.rol === 'admin' ? 'Administración' : 'Supervisión'}</span></span></div>
        <button type="button" data-accion-global="miClave">Cambiar mi contraseña</button><button type="button" data-accion-global="salir">Cerrar sesión</button></div>
    </aside>
    <div class="p-main">
      <header class="p-top"><div class="row nw"><button type="button" class="menu-btn btn-ghost" data-accion-global="menu" aria-label="Menú">${icono('menu')}</button><h1>${esc(s.titulo)}</h1></div>
        <div class="der"><span class="vivo ${P.vivo ? 'on' : ''}" title="Actualización en tiempo real"><i></i>${P.vivo ? 'En vivo' : 'Sin conexión'}</span>
          ${a ? `<span class="reloj-p">${cap(fLarga(a.fecha))} · ${a.hora}${P.relojSimulado ? ' <span class="chip warn">simulado</span>' : ''}</span>` : ''}
          ${P.cargando ? '<span class="spinner"></span>' : ''}</div></header>
      <main class="p-cont" id="contenido">${P.yo.debeCambiar ? '<div class="msg warn"><b>Por seguridad, cambia tu contraseña inicial.</b> <button type="button" class="btn-link" data-accion-global="miClave">Cambiar ahora</button></div>' : ''}${cuerpo}</main>
    </div></div>`);
  s.alPintar?.(datos, P);
}

function pintarConfigurar() {
  const m = P.marca || {}, t = m.tienda || {}, tu = m.turno || { inicio: '16:00', fin: '19:00' };
  redibujar(raiz, `<div class="login-p"><form class="card stack aparece" id="fConfigurar" style="width:min(720px,100%)">
    <img src="/assets/logo.webp" alt="${esc(m.nombre || '')}">
    <div class="center"><div class="eyebrow">Primer uso</div><h1>Configura tu sistema de asistencia</h1><p class="muted small">Esto se hace una sola vez. Después ingresarás con tu usuario y contraseña.</p></div>
    <fieldset class="stack" style="border:0;padding:0;margin:0"><legend class="eyebrow" style="margin-bottom:8px">1 · Tu cuenta de administración</legend><div class="grid-form">
      <label class="f">Nombre del negocio<input type="text" id="cfEmpresa" value="${esc(m.nombre || '')}" required></label>
      <label class="f">Rubro<input type="text" id="cfRubro" value="${esc(m.rubro || 'Moda y accesorios')}"></label>
      <label class="f">Tu nombre<input type="text" id="cfNombre" required autocomplete="name"></label>
      <label class="f">Usuario<input type="text" id="cfUsuario" value="admin" required autocomplete="username"></label>
      <label class="f">Contraseña (mínimo 8)<input type="password" id="cfClave" minlength="8" required autocomplete="new-password"></label>
      <label class="f">Repite la contraseña<input type="password" id="cfClave2" minlength="8" required autocomplete="new-password"></label></div></fieldset>
    <fieldset class="stack" style="border:0;padding:0;margin:0"><legend class="eyebrow" style="margin-bottom:8px">2 · Tienda y turno</legend><div class="grid-form">
      <label class="f">Nombre de la tienda<input type="text" id="cfTienda" value="${esc(t.nombre || '')}" placeholder="Ej.: Tienda principal" required></label>
      <label class="f">Dirección o referencia<input type="text" id="cfDir" placeholder="Ej.: Av. principal 123"></label>
      <label class="f">Coordenadas (lat, lng)<input type="text" id="cfCoords" value="${esc(t.coords || '')}" placeholder="-7.1547, -78.5166" required><small>Google Maps → clic derecho sobre la tienda</small></label>
      <label class="f">Radio permitido (m)<input type="number" id="cfRadio" value="${t.radio_m || 80}" min="10" max="5000"></label>
      <label class="f">Turno: inicio<input type="time" id="cfIni" value="${tu.inicio}"></label><label class="f">Turno: fin<input type="time" id="cfFin" value="${tu.fin}"></label></div>
      <p class="tiny muted">Se crea un turno diario con este horario. Luego puedes cambiarlo por día en Horarios → Plantilla semanal.</p></fieldset>
    <fieldset class="stack" style="border:0;padding:0;margin:0"><legend class="eyebrow" style="margin-bottom:8px">3 · Tu equipo</legend>
      <label class="f">Una persona por línea: nombre y celular<textarea id="cfEquipo" rows="8" placeholder="Analy Alcantara 998 814 382&#10;Flor Pari 946 745 424&#10;…"></textarea><small>A cada una se le crea su usuario (V01, V02…) y una clave de 4 números.</small></label></fieldset>
    <button class="btn-p btn-big" type="submit">Crear y entrar al panel</button>
    <div id="cfErr" class="small" style="color:var(--bad-ink)" role="alert"></div></form></div>`);
}

function pintarAccesos(equipo) {
  const url = location.origin + '/';
  const msg = (p) => `Hola ${primerNombre(p.nombre)} 👋 Ya está lista la app de asistencia de ${P.empresa?.nombre || P.marca?.nombre || ''}.\n\n🔗 ${url}\n👤 Usuario: ${p.codigo}\n🔑 Clave: ${p.pin}\n\nÁbrela en tu celular, agrégala a tu pantalla de inicio y permite la ubicación al marcar tu entrada. Los domingos de 9 a 10 p. m. eliges tu horario de la semana. ¡Gracias!`;
  redibujar(raiz, `<div class="login-p"><div class="card stack aparece" style="width:min(820px,100%)">
    <img src="/assets/logo.webp" alt="${esc(P.empresa?.nombre || '')}">
    <div class="center"><div class="eyebrow">Listo</div><h1>Accesos de tu equipo</h1><p class="muted small">Guarda o envía estas claves ahora: por seguridad no se vuelven a mostrar. Si alguien la pierde, genera una nueva en Equipo → Nuevo PIN.</p></div>
    ${equipo.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Usuario</th><th>Nombre</th><th>Celular</th><th>Clave</th><th></th></tr></thead><tbody>
      ${equipo.map((p) => `<tr><td class="num"><b>${esc(p.codigo)}</b></td><td>${esc(nombreBonito(p.nombre))}</td><td class="num">${p.telefono ? '+51 ' + esc(p.telefono) : '—'}</td><td class="num"><b>${esc(p.pin)}</b></td>
        <td><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${waLink(p.telefono, msg(p))}">Enviar por WhatsApp</a></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No cargaste personas; agrégalas en Equipo.</p>'}
    <button type="button" class="btn-p btn-big" data-accion-global="entrar">Entrar al panel</button></div></div>`);
}

function pintarLogin() {
  if (P.configurar) return pintarConfigurar();
  redibujar(raiz, `<div class="login-p"><form class="card stack" id="fLoginPanel">
    <img src="/assets/logo.webp" alt="">
    <div class="center"><div class="eyebrow">Panel de control</div><h2>Ingreso de administración</h2></div>
    <label class="f">Usuario<input type="text" id="pUsuario" autocomplete="username" required></label>
    <label class="f">Contraseña<input type="password" id="pClave" autocomplete="current-password" required></label>
    <button class="btn-p btn-big" type="submit">Ingresar</button>
    <div id="pErr" class="small" style="color:var(--bad-ink)" role="alert"></div>
    ${P.demo ? '<div class="msg" style="background:#fff8e6">Demostración: usuario <b>supervisor</b>, contraseña <b>supervisor2026</b>.</div>' : ''}
    <a class="center small" href="/">Ir a la app del equipo</a></form></div>`);
}

async function cargarYo() {
  const r = await api.get('/panel/yo');
  Object.assign(P, { yo: r.usuario, empresa: r.empresa, ajustes: r.ajustes, demo: r.demo, ahora: r.ahora, relojSimulado: r.relojSimulado });
  document.title = `Panel · ${r.empresa.nombre}`;
}

/* ---------------- tiempo real (Server-Sent Events) ---------------- */
let fuente = null, recarga = null;
let sondeo = null;
function conectarVivo() {
  fuente?.close();
  clearInterval(sondeo);
  if (P.tiempoReal === 'sondeo') {
    // Hosting sin conexiones permanentes (Netlify): se consulta cada 20 s mientras la pestaña está visible.
    P.vivo = true; pintarCabecera();
    sondeo = setInterval(() => {
      if (!P.yo || document.visibilityState !== 'visible' || document.querySelector('#capa') || document.querySelector('#contenido :is(input,select,textarea):focus')) return;
      actualizarBadges(); P.refrescar({ silencioso: true });
    }, 20000);
    return;
  }
  fuente = new EventSource('/api/panel/stream');
  fuente.onopen = () => { P.vivo = true; pintarCabecera(); };
  fuente.onerror = () => { P.vivo = false; pintarCabecera(); };
  fuente.addEventListener('cambio', (e) => {
    const ev = JSON.parse(e.data);
    if (ev.tipo === 'marca' && ev.marca) toast(`${ev.marca.hora.slice(0, 5)} · ${nombreBonito(ev.marca.usuario)}: ${ev.marca.tipo === 'control' ? 'reporte' : ev.marca.tipo} ${ev.marca.estado === 'dentro' ? 'en tienda' : ev.marca.estado === 'fuera' ? 'FUERA de tienda' : 'impreciso'}`, ev.marca.estado === 'fuera' ? 'bad' : '');
    if (['reloj', 'empresa'].includes(ev.tipo)) cargarYo().catch(() => {});
    // Agrupa varios eventos seguidos en una sola recarga
    clearTimeout(recarga);
    recarga = setTimeout(() => { if (!document.querySelector('#capa') && !document.querySelector('#contenido :is(input,select,textarea):focus')) { actualizarBadges(); P.refrescar({ silencioso: true }); } }, 600);
  });
}
function pintarCabecera() { const v = document.querySelector('.vivo'); if (v) { v.classList.toggle('on', P.vivo); v.lastChild.textContent = P.vivo ? 'En vivo' : 'Sin conexión'; } }
async function actualizarBadges() {
  try {
    const [m, j] = await Promise.all([api.get('/panel/multas?estado=pendiente'), api.get('/panel/justificaciones?estado=pendiente')]);
    P.badges.multas = (m.resumen.sinNotificar || 0) + j.length || 0;
  } catch {}
}

/* ---------------- eventos ---------------- */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ir], [data-accion-global], [data-accion]');
  if (!b || (b.closest('#capa') && !b.dataset.accion)) return;
  if (b.dataset.ir) return P.ir(b.dataset.ir);
  const g = b.dataset.accionGlobal;
  if (g === 'menu') return document.body.classList.toggle('menu-abierto');
  if (g === 'salir') { await api.post('/panel/logout'); fuente?.close(); clearInterval(sondeo); P.yo = null; return pintar(); }
  if (g === 'miClave') return cambiarMiClave();
  if (g === 'entrar') return iniciarSesion();
  if (b.dataset.accion) {
    try { await seccionActual().accion?.(b.dataset.accion, b, P, e); } catch (err) { toast(err.message, 'bad'); }
  }
});
document.addEventListener('click', (e) => { if (document.body.classList.contains('menu-abierto') && !e.target.closest('aside.lateral, .menu-btn')) document.body.classList.remove('menu-abierto'); });
for (const tipo of ['change', 'input']) {
  document.addEventListener(tipo, async (e) => {
    if (!P.yo || e.target.closest('#capa')) return;
    try { await seccionActual()[tipo === 'change' ? 'alCambiar' : 'alEscribir']?.(e.target, P, e); } catch (err) { toast(err.message, 'bad'); }
  });
}
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'fConfigurar') {
    e.preventDefault();
    const v = (id) => $('#' + id).value.trim();
    if ($('#cfClave').value !== $('#cfClave2').value) { $('#cfErr').textContent = 'Las contraseñas no coinciden.'; return; }
    try {
      const r = await api.post('/panel/configurar', {
        empresa: v('cfEmpresa'), rubro: v('cfRubro'), admin: { codigo: v('cfUsuario'), nombre: v('cfNombre'), clave: $('#cfClave').value },
        tienda: { nombre: v('cfTienda'), direccion: v('cfDir'), coords: v('cfCoords'), radio_m: Number(v('cfRadio')) || 80 },
        horario: { inicio: v('cfIni'), fin: v('cfFin') }, equipo: $('#cfEquipo').value,
      });
      P.configurar = false; P.empresa = { nombre: v('cfEmpresa') };
      return pintarAccesos(r.equipo);
    } catch (err) { $('#cfErr').textContent = err.message; }
    return;
  }
  if (e.target.id !== 'fLoginPanel') return;
  e.preventDefault();
  try {
    await api.post('/panel/login', { codigo: $('#pUsuario').value.trim(), clave: $('#pClave').value });
    await iniciarSesion();
  } catch (err) { $('#pErr').textContent = err.message; }
});

import { abrirCapa } from '../core/ui.js';
function cambiarMiClave() {
  const el = abrirCapa(`<h2>Cambiar mi contraseña</h2>
    <label class="f">Contraseña actual<input type="password" id="mcA" autocomplete="current-password"></label>
    <label class="f">Contraseña nueva (mínimo 8 caracteres)<input type="password" id="mcN" autocomplete="new-password"></label>
    <div class="row" style="justify-content:flex-end"><button type="button" data-cerrar>Cancelar</button><button type="button" class="btn-p" data-ok>Guardar</button></div>`);
  el.querySelector('[data-ok]').addEventListener('click', async () => {
    try { await api.post('/panel/clave', { actual: el.querySelector('#mcA').value, nueva: el.querySelector('#mcN').value }); cerrarCapa(); toast('Contraseña actualizada.'); await cargarYo(); pintar(); } catch (err) { toast(err.message, 'bad'); }
  });
}

async function iniciarSesion() {
  await cargarYo();
  conectarVivo();
  actualizarBadges();
  await P.refrescar();
}
onSesionVencida((ruta) => { if (!ruta.startsWith('/panel/')) return; P.yo = null; fuente?.close(); pintar(); });
setInterval(async () => { if (P.yo) { try { const r = await api.get('/estado'); P.ahora = r.ahora; P.relojSimulado = r.relojSimulado; const el = document.querySelector('.reloj-p'); if (el) el.innerHTML = `${cap(fLarga(r.ahora.fecha))} · ${r.ahora.hora}${r.relojSimulado ? ' <span class="chip warn">simulado</span>' : ''}`; } catch {} } }, 30000);
activarTooltips();

(async () => {
  try { const e = await api.get('/estado'); P.demo = e.demo; P.configurar = e.configurar; P.tiempoReal = e.tiempoReal; P.marca = e.marca; } catch {}
  try { await iniciarSesion(); } catch { P.yo = null; pintar(); }
})();
