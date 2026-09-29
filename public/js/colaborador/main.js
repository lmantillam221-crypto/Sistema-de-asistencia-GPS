/* =====================================================================
   App de las colaboradoras · marcar asistencia con GPS, elegir horarios,
   cuadre de caja del turno, multas y coberturas.
   ===================================================================== */
import { api, onSesionVencida } from '../core/api.js';
import { toast, redibujar, abrirCapa, cerrarCapa, confirmar, icono } from '../core/ui.js';
import {
  $, esc, cap, nombreBonito, primerNombre, soles, fCorta, fLarga, hora12, aMin, aHora, sumarDias, lunesDe, DIAS,
  fmtDist, distancia, LS, horasMin, CLASE_ESTADO, ETIQUETA_ESTADO, NOMBRE_MULTA, CLASE_RES, plural,
} from '../core/util.js';
import { partes } from '/shared/tiempo.js';
import { gps, cola, idDispositivo } from './gps.js';

const raiz = $('#app');
const est = {
  info: null, datos: null, tab: LS.get('nc_tab') || 'hoy', offset: 0,
  horario: null, semana: 'esta', multas: null, coberturas: null, historial: null,
  ocupado: false, msg: null, enviando: false, ultimaFranja: null, instalar: null, online: navigator.onLine,
};
const TABS = [['hoy', 'Hoy', 'hoy'], ['horario', 'Horario', 'calendario'], ['multas', 'Multas', 'multa'], ['perfil', 'Mi cuenta', 'perfil']];
const disp = idDispositivo();

/* ---------------- utilidades de tiempo del servidor ---------------- */
const ahoraServidor = () => partes(Date.now() + est.offset, est.info?.zona || 'America/Lima');
const turnoAbierto = () => est.datos?.turnosHoy.find((t) => t.id === est.datos.abierto) || null;

/* ---------------- carga de datos ---------------- */
async function cargarHoy() {
  const d = await api.get('/app/hoy');
  est.offset = d.ahora.ms - Date.now();
  est.datos = d;
  if (turnoAbierto()) { gps.seguir(); gps.mantenerPantalla(); }
  else if (d.turnosHoy.some((t) => !t.ev?.entrada)) gps.seguir();
  return d;
}
async function cargarTab() {
  try {
    if (est.tab === 'horario') {
      const hoy = ahoraServidor().fecha, esta = lunesDe(hoy);
      const [h, c] = await Promise.all([api.get(`/app/horario?semana=${est.semana === 'esta' ? esta : sumarDias(esta, 7)}`), api.get('/app/coberturas')]);
      est.horario = h; est.coberturas = c;
    } else if (est.tab === 'multas') est.multas = await api.get('/app/multas');
    else if (est.tab === 'perfil') est.historial = await api.get('/app/historial');
  } catch (e) { if (e.status !== 401) toast(e.message, 'bad'); }
  render();
}

/* =====================================================================
   RENDER
   ===================================================================== */
let ultimaTab = null; // anima la entrada solo al cambiar de pestaña
function render() {
  if (!est.info) return;
  if (!est.datos) return renderLogin();
  const d = est.datos, p = ahoraServidor();
  const badges = { horario: (d.ventana.puedeElegir ? 1 : 0) + d.coberturas, multas: d.multas.cantidad };
  const cuerpo = { hoy: pantallaHoy, horario: pantallaHorario, multas: pantallaMultas, perfil: pantallaPerfil }[est.tab]?.() ?? '';
  const listo = !cuerpo.includes('class="cargando"'), anima = listo && ultimaTab !== est.tab;
  if (listo) ultimaTab = est.tab;
  redibujar(raiz, `<div class="m-app">
    ${est.online ? '' : '<div class="offline">Sin internet · los reportes se guardan y se envían al volver la conexión</div>'}
    <header class="m-top"><img src="/assets/logo.webp" alt="${esc(d.empresa)}">
      <div class="reloj">${p.hora}<small>${cap(fLarga(p.fecha))}</small></div></header>
    ${d.demo ? '<div class="offline" style="background:#fff8e6">Modo demostración</div>' : ''}
    <main class="m-main${anima ? ' entra' : ''}" id="main">${cuerpo}</main>
    <div class="tabbar"><nav aria-label="Secciones">${TABS.map(([k, t, ic]) => `<button type="button" data-tab="${k}" ${est.tab === k ? 'aria-current="page"' : ''}>${icono(ic)}<span>${t}</span>${badges[k] ? `<span class="badge">${badges[k]}</span>` : ''}</button>`).join('')}</nav></div>
  </div>`);
}

function renderLogin() {
  const demo = est.info.demo;
  redibujar(raiz, `<div class="login-m aparece">
    <img class="logo" src="/assets/logo.webp" alt="${esc(est.info.empresa)}">
    <div class="center"><div class="eyebrow">App del equipo</div><h1>Marca tu asistencia y elige tus horarios</h1></div>
    <form id="fLogin" class="card stack" autocomplete="on">
      <label class="f">Usuario (tu código)<input type="text" id="lCodigo" name="username" autocapitalize="characters" autocomplete="username" placeholder="Ej.: V01" required></label>
      <label class="f">Clave (PIN)<input type="password" id="lPin" name="password" inputmode="numeric" autocomplete="current-password" required></label>
      ${LS.get('nc_consent') ? '' : `<label class="check"><input type="checkbox" id="lAcepto" required><span class="small">Entiendo que al marcar mi entrada se activa mi ubicación y se envía cada cierto tiempo a la supervisión hasta que marque mi salida. Fuera de mi turno no se registra nada.</span></label>`}
      <button class="btn-p btn-big" type="submit" ${est.ocupado ? 'disabled' : ''}>${est.ocupado ? '<span class="spinner"></span>' : 'Ingresar'}</button>
      ${est.msg ? `<div class="msg ${est.msg.clase}">${esc(est.msg.texto)}</div>` : ''}
    </form>
    ${demo ? '<div class="msg" style="background:#fff8e6">Demostración: usuario <b>V01</b>, clave <b>1111</b> (V02 → 2222, etc.).</div>' : ''}
    <a class="center small" href="/panel">¿Eres supervisión? Ir al panel de control</a>
  </div>`);
}

/* ---------------- Hoy ---------------- */
function pantallaHoy() {
  const d = est.datos, p = ahoraServidor(), u = d.usuario;
  const avisos = [];
  if (d.multas.nuevas.length) avisos.push(`<div class="msg bad"><b>Tienes ${d.multas.nuevas.length === 1 ? 'una multa nueva' : d.multas.nuevas.length + ' multas nuevas'}.</b> ${d.multas.nuevas.map((m) => `${NOMBRE_MULTA[m.tipo]} del ${fCorta(m.fecha)}: ${soles(m.monto)}`).join(' · ')}
    <div class="row" style="margin-top:8px"><button type="button" class="btn-sm" data-tab="multas">Ver mis multas</button><button type="button" class="btn-sm" data-accion="multasVistas">Entendido</button></div></div>`);
  if (d.ventana.puedeElegir) avisos.push(`<div class="msg pink"><b>¡Ya puedes elegir tu horario!</b> ${d.ventana.abierta ? `Tienes hasta las ${hora12(d.ventana.hasta)}.` : ''} <button type="button" class="btn-link" data-tab="horario">Elegir ahora</button></div>`);
  if (d.coberturas) avisos.push(`<div class="msg info"><b>${plural(d.coberturas, 'turno necesita', 'turnos necesitan')} cobertura.</b> <button type="button" class="btn-link" data-tab="horario">Ver</button></div>`);

  const turnos = d.turnosHoy.map(tarjetaTurno).join('');
  let sinTurno = '';
  if (!d.turnosHoy.length) {
    const otros = d.otrosHoy.filter((t) => t.usuario);
    sinTurno = `<div class="card"><div class="eyebrow">Hoy</div><h2>No tienes turno hoy</h2>
      <p class="small muted">${otros.length ? `Hoy trabaja${otros.length > 1 ? 'n' : ''} ${otros.map((t) => `<b>${esc(nombreBonito(t.usuario))}</b> (${t.inicio}–${t.fin})`).join(', ')}.` : 'No hay turnos asignados hoy.'}</p>
      ${d.ajustes.permitirCubrir && d.otrosHoy.length ? '<button type="button" data-accion="cubrir">Voy a cubrir un turno de hoy</button>' : ''}</div>`;
  }
  const proximos = d.proximos.length ? `<div class="card"><h2>Mis próximos turnos</h2><div>${d.proximos.map((t) => `<div class="lista-row"><span><b>${cap(fLarga(t.fecha))}</b><br><span class="tiny muted">${esc(nombreBonito(t.tienda?.nombre))}</span></span><span class="num">${hora12(t.inicio)} – ${hora12(t.fin)}</span></div>`).join('')}</div></div>` : '';
  return `<div class="saludo aparece"><div><div class="eyebrow">${cap(DIAS[new Date(p.fecha + 'T12:00:00Z').getUTCDay()])}</div><h1>Hola, ${esc(primerNombre(u.nombre))}</h1></div></div>
    ${avisos.join('')}
    ${est.msg ? `<div class="msg ${est.msg.clase}" role="status">${esc(est.msg.texto)}</div>` : ''}
    ${turnos}${sinTurno}
    ${d.demo ? simulador() : ''}
    ${proximos}`;
}

function tarjetaTurno(t) {
  const d = est.datos, ev = t.ev, p = ahoraServidor();
  const entro = !!ev?.entrada, salio = !!ev?.salida, abierto = d.abierto === t.id;
  const estado = ev?.estado || 'PROGRAMADO';
  const cerca = aMin(t.inicio) - p.minutos <= 30;
  let cuerpo = '';
  if (!entro) {
    const terminado = p.minutos > aMin(t.fin);
    cuerpo = `<div data-dist="${t.id}">${distanciaHtml(t)}</div>
      ${terminado ? '<div class="msg grey">El horario de este turno ya terminó.</div>' : `<button class="btn-p btn-big ${cerca ? 'brilla' : ''}" type="button" data-accion="entrada" data-turno="${t.id}" ${est.ocupado ? 'disabled' : ''}>${est.ocupado ? '<span class="spinner"></span> Buscando tu ubicación…' : 'Marcar entrada'}</button>
      <p class="nota">Al marcar tu entrada se activa tu ubicación y se envía sola cada ${d.ajustes.intervaloControlMin} minutos hasta que marques tu salida.</p>`}`;
  } else if (abierto) {
    const sinSenal = gps.estado.sim === 'sin_senal' || (gps.estado.sim === 'real' && gps.estado.error === 1);
    const pend = cola.leer().length;
    cuerpo = `${sinSenal ? '<div class="gps bad"><span class="luz"></span><span>Sin señal de GPS<small>No se están enviando reportes. Revisa que la ubicación esté encendida.</small></span></div>'
      : `<div class="gps ok on"><span class="luz"></span><span>Ubicación activa${gps.estado.sim !== 'real' ? ' (simulada)' : ''}<small>Se envía sola cada ${d.ajustes.intervaloControlMin} min${ev.proximo != null ? ` · próximo envío ${aHora(ev.proximo)}` : ''}${pend ? ` · ${pend} por enviar` : ''}</small></span></div>`}
      ${franjasMini(ev)}
      <button class="btn-big" type="button" data-accion="salida" data-turno="${t.id}" ${est.ocupado ? 'disabled' : ''}>${est.ocupado ? '<span class="spinner"></span>' : 'Marcar salida'}</button>
      <p class="nota">Deja esta app abierta durante tu turno. Si la cierras o bloqueas el celular, los reportes se detienen y la supervisión lo verá.</p>`;
  } else if (salio) {
    const r = t.reporte;
    const total = r ? (r.efectivo || 0) + (r.digital || 0) + (r.tarjeta || 0) : null;
    cuerpo = `<div class="mini-kpis"><div><span>Entrada</span><b>${ev.entrada}</b></div><div><span>Salida</span><b>${ev.salida}</b></div>
      <div><span>Tiempo en tienda</span><b>${horasMin(ev.minutosEnLocal)}</b></div><div><span>Reportes GPS</span><b>${ev.esperados ? `${ev.recibidos}/${ev.esperados}` : '—'}</b></div></div>
      ${d.ajustes.registrarVentas ? `<div class="lista-row"><span>Ventas del turno</span><span><b>${r?.ventas != null ? `${r.ventas} · ${soles(total)}` : 'Sin registrar'}</b> <button type="button" class="btn-sm" data-accion="editarCuadre" data-turno="${t.id}">${r?.ventas != null ? 'Editar' : 'Registrar'}</button></span></div>` : ''}
      <div class="msg ok">Turno terminado. ¡Gracias${ev.resultado === 'a tiempo' ? ' por llegar puntual' : ''}!</div>`;
  }
  const marcas = t.marcas.length ? `<details class="small"><summary class="muted" style="cursor:pointer;font-weight:800">Registro de hoy (${t.marcas.length})</summary>${t.marcas.slice().reverse().map((m) => `<div class="lista-row"><span><span class="dot d-${m.estado}"></span>${m.tipo === 'control' ? 'Ubicación enviada' : cap(m.tipo)}</span><span class="small num">${m.hora.slice(0, 5)} · ${m.estado === 'dentro' ? 'en tienda' : m.estado === 'fuera' ? fmtDist(m.distancia_m) + ' fuera' : 'impreciso'}</span></div>`).join('')}</details>` : '';
  return `<section class="card turno-hero aparece"><div class="card-h"><div><div class="eyebrow">${t.propio ? 'Tu turno de hoy' : `Cubriendo${t.usuario_nombre ? ' a ' + esc(nombreBonito(t.usuario_nombre)) : ''}`}</div>
      <div class="horario">${hora12(t.inicio)} – ${hora12(t.fin)}</div><div class="tienda">${esc(nombreBonito(t.tienda?.nombre))}</div></div>
      <span class="estado-pill ${CLASE_ESTADO[estado] || 'grey'}">${esc(ETIQUETA_ESTADO[estado] || cap(estado.toLowerCase()))}</span></div>
    ${ev?.minutosTarde > d.ajustes.toleranciaMin ? `<div class="msg warn small">Entraste ${ev.minutosTarde} min tarde.</div>` : ''}
    ${cuerpo}${marcas}</section>`;
}

/** Indicador de distancia a la tienda. Se actualiza solo (sin redibujar la pantalla) con cada lectura del GPS. */
function distanciaHtml(t) {
  const pos = gps.estado.pos;
  if (!pos || !t.tienda || gps.estado.sim !== 'real') return '';
  const dist = distancia(pos.lat, pos.lng, t.tienda.lat, t.tienda.lng);
  const dentro = dist - Math.min(pos.precision || 0, t.tienda.radio_m / 2) <= t.tienda.radio_m;
  return `<div class="distancia"><span class="ic">${icono('hoy', 20)}</span><div class="grow"><b>${dentro ? 'Estás en la tienda' : `Estás a ${fmtDist(dist)} de la tienda`}</b><div class="tiny muted">Precisión del GPS ±${pos.precision} m</div></div>${dentro ? '<span class="chip ok">✓</span>' : ''}</div>`;
}

function franjasMini(ev) {
  const fr = ev.franjas || [];
  if (!fr.length) return '';
  const vis = fr.filter((f) => f.estado !== 'futuro').slice(-4);
  if (!vis.length) return '';
  return `<div class="row" style="gap:6px">${vis.map((f) => `<span class="chip ${f.estado === 'recibido' ? 'ok' : f.estado === 'falta' ? 'bad' : 'warn'}">${f.hora} ${f.estado === 'recibido' ? '✓' : f.estado === 'falta' ? '✗' : '…'}</span>`).join('')}</div>`;
}

function simulador() {
  const ops = [['real', 'GPS real', 'Ubicación verdadera'], ['dentro', 'En la tienda', 'Dentro del radio'], ['cerca', 'Salió un momento', 'A ~250 m'], ['lejos', 'En otro lugar', 'A ~3 km'], ['sin_senal', 'Sin señal', 'No envía reportes']];
  return `<details class="card sim" id="detSim"><summary style="cursor:pointer;font-weight:800">Simulador de ubicación (demo)</summary>
    <div class="opciones" style="margin-top:10px">${ops.map(([k, t, s]) => `<button type="button" class="opt" data-sim="${k}" aria-pressed="${gps.estado.sim === k}"><b>${t}</b><span>${s}</span></button>`).join('')}</div>
    <p class="tiny muted">El reloj de la demo se controla desde el panel (Configuración → Demostración).</p></details>`;
}

/* ---------------- Horario ---------------- */
function pantallaHorario() {
  const h = est.horario, c = est.coberturas, d = est.datos, p = ahoraServidor();
  if (!h) return '<div class="cargando"><span class="spinner"></span></div>';
  const v = h.ventana;
  const nav = `<div class="semana-tabs" role="group" aria-label="Semana"><button type="button" data-semana="esta" aria-pressed="${est.semana === 'esta'}">Esta semana</button><button type="button" data-semana="sig" aria-pressed="${est.semana === 'sig'}">Próxima semana</button></div>`;
  const r = h.reglas || {};
  const reglasTxt = [r.elegirHoras ? 'Elige el día y tu hora de entrada y salida' : '', r.minTurno ? `mínimo ${fmtH(r.minTurno)} h por turno` : '', r.maxTurno ? `máximo ${fmtH(r.maxTurno)} h por turno` : ''].filter(Boolean).join(' · ');
  const tope = r.maxSemana || r.minSemana;
  const progreso = tope ? `<div class="progreso-horas"><div class="row between"><span class="small"><b>${fmtH(h.horasTengo)} h</b> elegidas esta semana</span><span class="tiny muted">${r.minSemana ? `mínimo ${fmtH(r.minSemana)} h` : ''}${r.minSemana && r.maxSemana ? ' · ' : ''}${r.maxSemana ? `máximo ${fmtH(r.maxSemana)} h` : ''}</span></div>
    <div class="barra"><i style="width:${Math.min(100, (h.horasTengo / (r.maxSemana || r.minSemana)) * 100)}%"></i>${r.minSemana && r.maxSemana ? `<b style="left:${(r.minSemana / r.maxSemana) * 100}%" title="Mínimo"></b>` : ''}</div>
    ${r.minSemana && h.horasTengo < r.minSemana ? `<div class="tiny" style="color:var(--warn-ink)">Te faltan ${fmtH(r.minSemana - h.horasTengo)} h para el mínimo.</div>` : ''}</div>` : '';
  const aviso = h.puedeElegir
    ? `<div class="msg ok"><b>Elección abierta</b> para la semana del ${fCorta(h.lunes)} al ${fCorta(sumarDias(h.lunes, 6))}.${v.abierta ? ` Cierra a las ${hora12(v.hasta)} (quedan ${v.quedan} min).` : ''} Puedes elegir hasta <b>${plural(h.max, 'turno')}</b>; llevas ${h.tengo}.${reglasTxt ? `<br><span class="small">${reglasTxt}.</span>` : ''}</div>${progreso}`
    : `<div class="msg grey">La elección de horarios se abre el <b>${DIAS[v.dia]} de ${hora12(v.desde)} a ${hora12(v.hasta)}</b>. Próxima: <b>${fLarga(v.fecha)}</b>, para la semana del ${fCorta(v.semana)}.</div>`;
  const pedidas = new Set((c?.mias || []).filter((x) => x.estado === 'abierta').map((x) => x.turno_id));
  const variasTiendas = h.tiendas.length > 1;
  let dias = '';
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(h.lunes, i), ts = h.turnos.filter((t) => t.fecha === f);
    if (!ts.length) { dias += `<div class="dia-m"><b>${cap(fLarga(f))}</b><span class="tiny muted">Cerrado</span></div>`; continue; }
    const tengoEseDia = (h.reglas?.unTurnoPorDia ?? true) && ts.some((t) => t.mio);
    dias += `<div class="dia-m ${f === p.fecha ? 'hoy' : ''}"><b>${cap(fLarga(f))}${f === p.fecha ? ' · hoy' : ''}</b>${ts.map((t) => {
      const futuro = f > p.fecha || (f === p.fecha && aMin(t.inicio) > p.minutos);
      const lugar = variasTiendas ? ` · ${esc(nombreBonito(t.tienda))}` : '';
      if (t.mio) {
        return `<div class="elegir-btn mio" style="border:1px solid var(--brand)"><span class="num"><b>${t.inicio}–${t.fin}</b>${lugar}</span><span class="row nw">${h.puedeElegir && h.reglas?.permitirSoltar !== false ? `<button type="button" class="btn-sm" data-soltar="${t.id}">Soltar</button>` : h.puedeElegir ? '<span class="small">Tu turno</span>' : futuro ? (pedidas.has(t.id) ? '<span class="chip info">Cobertura pedida</span>' : `<button type="button" class="btn-sm" data-pedircob="${t.id}">Pedir cobertura</button>`) : '<span class="small">Tu turno</span>'}</span></div>`;
      }
      if (t.usuario_id) return `<div class="elegir-btn ocupado"><span class="num"><b>${t.inicio}–${t.fin}</b>${lugar}</span><span class="small">${esc(nombreBonito(t.usuario))}</span></div>`;
      const bloqueado = !h.puedeElegir || h.tengo >= h.max || tengoEseDia;
      return `<button type="button" class="elegir-btn libre" ${bloqueado ? 'disabled' : `data-elegir="${t.id}"`}><span class="num"><b>${t.inicio}–${t.fin}</b>${lugar}</span><span class="small">${!h.puedeElegir ? 'Libre' : h.tengo >= h.max ? 'Ya completaste tus turnos' : tengoEseDia ? '—' : h.reglas?.elegirHoras ? 'Libre · elige tu horario' : 'Libre · tocar para elegir'}</span></button>`;
    }).join('')}</div>`;
  }
  const abiertas = (c?.abiertas || []);
  const cob = `<div class="card"><h2>Turnos que necesitan cobertura</h2>
    ${abiertas.length ? abiertas.map((x) => `<div class="lista-row"><span><b>${cap(fLarga(x.fecha))}</b> ${x.inicio}–${x.fin}<br><span class="tiny muted">${esc(nombreBonito(x.solicitante_nombre))}${x.motivo ? ' · ' + esc(x.motivo) : ''}${variasTiendas ? ' · ' + esc(nombreBonito(x.tienda_nombre)) : ''}</span></span>
      ${x.cruce ? '<span class="chip grey">Se cruza con tu turno</span>' : `<button type="button" class="btn-sm btn-p" data-tomar="${x.id}">Tomar</button>`}</div>`).join('') : '<p class="small muted">Nadie necesita cobertura por ahora.</p>'}
    ${(c?.mias || []).length ? `<div class="eyebrow" style="margin-top:6px">Mis solicitudes</div>${c.mias.map((x) => `<div class="lista-row"><span>${fCorta(x.fecha)} ${x.inicio}–${x.fin}<br><span class="tiny muted">${x.tomada_por === d.usuario.id ? `Lo tomaste de ${esc(nombreBonito(x.solicitante_nombre))}` : x.estado === 'tomada' ? `Lo tomó ${esc(nombreBonito(x.tomada_por_nombre))}` : ''}</span></span>
      <span class="row nw"><span class="chip ${x.estado === 'tomada' ? 'ok' : x.estado === 'abierta' ? 'info' : 'grey'}">${x.estado}</span>${x.estado === 'abierta' && x.solicitante_id === d.usuario.id ? `<button type="button" class="btn-sm" data-cancelarcob="${x.id}">Cancelar</button>` : ''}</span></div>`).join('')}` : ''}</div>`;
  return `<h1>Mi horario</h1>${nav}${aviso}<div class="card">${dias}</div>${cob}`;
}

/* ---------------- Multas ---------------- */
function pantallaMultas() {
  const m = est.multas;
  if (!m) return '<div class="cargando"><span class="spinner"></span></div>';
  const justDe = new Map(m.justificaciones.map((j) => [j.multa_id, j]));
  return `<h1>Mis multas</h1>
    <div class="card center"><span class="eyebrow">Total pendiente</span><b style="font-size:2.2rem;font-weight:900;color:${m.pendiente ? 'var(--bad-ink)' : 'var(--ok-ink)'}" class="num">${soles(m.pendiente)}</b>
      <p class="small muted">Tardanza ${soles(m.multas.tardanza)} (más de ${m.tolerancia} min tarde) · Falta ${soles(m.multas.falta)}${m.multas.salidaAnticipada ? ` · Salida anticipada ${soles(m.multas.salidaAnticipada)}` : ''}. Se marcan como pagadas cuando la supervisión registra tu pago.</p></div>
    <div class="card">${m.lista.length ? m.lista.map((x) => {
      const j = justDe.get(x.id);
      return `<div class="lista-row" style="align-items:flex-start"><span class="grow"><b>${NOMBRE_MULTA[x.tipo]}</b> · ${fCorta(x.fecha)}<br><span class="tiny muted">${esc(x.detalle)}</span>
        ${j ? `<br><span class="chip ${j.estado === 'aprobada' ? 'ok' : j.estado === 'rechazada' ? 'bad' : 'info'}" style="margin-top:4px">Justificación ${j.estado}</span>${j.respuesta ? `<span class="tiny muted"> · ${esc(j.respuesta)}</span>` : ''}` : ''}
        ${x.estado === 'anulada' && x.motivo_anulada ? `<br><span class="tiny muted">${esc(x.motivo_anulada)}</span>` : ''}</span>
        <span style="text-align:right" class="stack" ><b class="num">${soles(x.monto)}</b><span class="chip ${x.estado === 'pendiente' ? 'bad' : x.estado === 'pagada' ? 'ok' : 'grey'}">${x.estado}</span>
        ${x.estado === 'pendiente' && (!j || j.estado === 'rechazada') ? `<button type="button" class="btn-sm" data-justificar="${x.id}">Justificar</button>` : ''}</span></div>`;
    }).join('') : '<div class="vacio">No tienes multas. ¡Sigue así! ✨</div>'}</div>`;
}

/* ---------------- Mi cuenta ---------------- */
function pantallaPerfil() {
  const d = est.datos, h = est.historial, u = d.usuario, r = h?.resumen;
  const kpis = r ? `<div class="mini-kpis"><div><span>Turnos</span><b>${r.turnos}</b></div><div><span>Puntualidad</span><b>${r.puntualidad ?? '—'}${r.puntualidad != null ? '%' : ''}</b></div>
    <div><span>Horas en tienda</span><b>${horasMin(r.minutos)}</b></div><div><span>Faltas</span><b>${r.faltas}</b></div>
    ${d.ajustes.registrarVentas ? `<div><span>Ventas</span><b>${r.ventas}</b></div><div><span>Total vendido</span><b>${soles(r.monto)}</b></div>` : ''}</div>` : '<p class="small muted">Aún no hay turnos este mes.</p>';
  const filas = h?.filas?.slice().reverse().slice(0, 12) || [];
  return `<h1>${esc(nombreBonito(u.nombre))}</h1><p class="small muted" style="margin-top:-8px">Usuario ${esc(u.codigo)}</p>
    <div class="card"><h2>Mi mes</h2>${h ? kpis : '<span class="spinner"></span>'}
      ${filas.length ? `<div>${filas.map((f) => `<div class="lista-row"><span>${fCorta(f.fecha)} <span class="tiny muted">${f.inicio}–${f.fin}</span></span><span class="row nw">${f.entrada ? `<span class="small num">${f.entrada}${f.salida ? '–' + f.salida : ''}</span>` : ''}<span class="chip ${CLASE_RES[f.resultado] || 'grey'}">${f.resultado}</span></span></div>`).join('')}</div>` : ''}</div>
    <form class="card stack" id="fClave"><h2>Cambiar mi clave</h2>
      <label class="f">Clave actual<input type="password" id="cActual" inputmode="numeric" autocomplete="current-password" required></label>
      <label class="f">Clave nueva (4 a 8 números)<input type="password" id="cNueva" inputmode="numeric" pattern="\\d{4,8}" autocomplete="new-password" required></label>
      <button type="submit" class="btn-p">Guardar clave</button></form>
    <div class="card"><h2>Instalar la app</h2>
      ${est.instalar ? '<button type="button" class="btn-p" data-accion="instalar">Instalar en este celular</button>' : ''}
      <div class="pasos"><div><b class="so">Android (Chrome)</b>Menú ⋮ → <b>Instalar aplicación</b> o <b>Agregar a pantalla principal</b>.</div>
      <div><b class="so">iPhone (Safari)</b>Botón compartir ⬆ → <b>Agregar a inicio</b>.</div></div>
      <p class="nota">Instalada se abre más rápido y a pantalla completa. Durante tu turno deja la app abierta.</p></div>
    ${d.demo ? simulador() : ''}
    <button type="button" class="btn-big" data-accion="salir">Cerrar sesión</button>`;
}

/* =====================================================================
   ACCIONES
   ===================================================================== */
async function marcar(tipo, turno, extra = {}) {
  if (est.ocupado) return;
  est.ocupado = true; est.msg = null; render();
  try {
    const pos = await gps.obtener(turno?.tienda, { fresca: true });
    const r = await api.post('/app/marcas', { tipo, lat: pos.lat, lng: pos.lng, precision: pos.precision, dispositivo: disp, simulado: !!pos.simulado || undefined, ...extra });
    const m = r.marca;
    const t = turno?.tienda?.nombre ? nombreBonito(turno.tienda.nombre) : 'la tienda';
    const donde = m.estado === 'dentro' ? `Estás en ${t}.` : m.estado === 'fuera' ? `Estás a ${fmtDist(m.distancia_m)} de ${t}; la supervisión lo verá como fuera de tienda.` : 'La señal del GPS es débil; si puedes, acércate a una puerta o ventana.';
    est.msg = tipo === 'entrada'
      ? { texto: `Entrada registrada a las ${m.hora.slice(0, 5)}. Ubicación activada. ${donde}`, clase: m.estado === 'dentro' ? 'ok' : m.estado === 'fuera' ? 'bad' : 'warn' }
      : { texto: `Salida registrada a las ${m.hora.slice(0, 5)}. Ubicación apagada. ${m.estado === 'dentro' ? '' : donde}`.trim(), clase: m.estado === 'fuera' ? 'bad' : 'ok' };
    if (navigator.vibrate) navigator.vibrate(60);
    if (tipo === 'entrada') { LS.set('nc_consent', '1'); gps.seguir(); gps.mantenerPantalla(); }
    if (tipo === 'salida') gps.detener();
    await cargarHoy();
  } catch (e) {
    if (e.codigo === 'DENEGADO') { est.ocupado = false; return mostrarPermisoBloqueado(); }
    est.msg = { texto: e.message, clase: 'bad' };
  } finally { est.ocupado = false; render(); }
}

async function iniciarEntrada(turnoId, cubrir = false) {
  const t = est.datos.turnosHoy.find((x) => x.id === turnoId) || null;
  if (gps.estado.sim === 'real') {
    if (!gps.posible()) { est.msg = { texto: 'Este navegador no puede usar el GPS en esta página. Ábrela desde el enlace https:// del sistema.', clase: 'bad' }; return render(); }
    const st = await gps.permiso();
    if (st === 'denied') return mostrarPermisoBloqueado();
    if (st !== 'granted') {
      const ok = await new Promise((res) => {
        const el = abrirCapa(`<div class="permiso"><h2>Activa tu ubicación para marcar tu entrada</h2>
          <ol><li>Toca <b>Activar ubicación</b>.</li><li>Tu celular preguntará si esta app puede usar tu ubicación. Elige <b>Permitir</b>.</li><li>Deja la app abierta: tu ubicación se enviará sola cada ${est.datos.ajustes.intervaloControlMin} minutos hasta que marques tu salida.</li></ol></div>
          <button type="button" class="btn-p btn-big" data-ok>Activar ubicación</button><button type="button" data-cerrar>Cancelar</button>`, { clase: 'hoja', fondo: 'hoja-fondo', alCerrar: () => res(false) });
        el.querySelector('[data-ok]').addEventListener('click', () => { res(true); cerrarCapa(); });
      });
      if (!ok) return;
    }
  }
  const lista = est.datos.ajustes.checklistApertura;
  const extra = cubrir ? { turnoId } : {};
  if (!lista.length) return marcar('entrada', t, extra);
  const el = abrirCapa(`<div><div class="eyebrow">Apertura de tienda</div><h2>Antes de empezar</h2><p class="small muted">Marca lo que ya está listo.</p></div>
    <div class="checklist">${lista.map((x, i) => `<label class="check"><input type="checkbox" name="ap" value="${esc(x)}" id="ap${i}"><span>${esc(x)}</span></label>`).join('')}</div>
    <button type="button" class="btn-p btn-big" data-ok>Marcar entrada</button><button type="button" data-cerrar>Cancelar</button>`, { clase: 'hoja', fondo: 'hoja-fondo' });
  el.querySelector('[data-ok]').addEventListener('click', () => {
    const apertura = [...el.querySelectorAll('input[name=ap]:checked')].map((x) => x.value);
    cerrarCapa();
    marcar('entrada', t || { tienda: null }, { ...extra, apertura });
  });
}

function formCuadre(t, rep = {}) {
  const a = est.datos.ajustes;
  const v = (x) => (x == null ? '' : x);
  return `${a.checklistCierre.length ? `<div class="checklist">${a.checklistCierre.map((x, i) => `<label class="check"><input type="checkbox" name="ci" value="${esc(x)}" id="ci${i}" ${rep.cierre?.includes(x) ? 'checked' : ''}><span>${esc(x)}</span></label>`).join('')}</div>` : ''}
    ${a.registrarVentas ? `<div><div class="eyebrow" style="margin-bottom:6px">Ventas del turno</div><div class="grid-form" style="grid-template-columns:1fr 1fr">
      <label class="f">N° de ventas<input type="number" id="qVentas" min="0" inputmode="numeric" value="${v(rep.ventas)}"></label>
      <label class="f">Prendas / accesorios<input type="number" id="qPrendas" min="0" inputmode="numeric" value="${v(rep.prendas)}"></label>
      <label class="f">Efectivo<div class="moneda"><span>S/</span><input type="number" id="qEf" min="0" step="0.1" inputmode="decimal" value="${v(rep.efectivo)}"></div></label>
      <label class="f">Yape / Plin<div class="moneda"><span>S/</span><input type="number" id="qDig" min="0" step="0.1" inputmode="decimal" value="${v(rep.digital)}"></div></label>
      <label class="f">Tarjeta<div class="moneda"><span>S/</span><input type="number" id="qTar" min="0" step="0.1" inputmode="decimal" value="${v(rep.tarjeta)}"></div></label>
      <div class="hecho" style="align-self:end"><span class="tiny muted">Total</span><br><b id="qTotal" class="num">${soles((rep.efectivo || 0) + (rep.digital || 0) + (rep.tarjeta || 0))}</b></div></div></div>` : ''}
    <label class="f">Nota para supervisión (opcional)<textarea id="qNota" maxlength="500" placeholder="Ej.: se acabó la talla M del polo rosado">${esc(rep.nota || '')}</textarea></label>`;
}
function leerCuadre(el) {
  const n = (id) => { const x = el.querySelector('#' + id)?.value; return x === '' || x == null ? null : Number(x); };
  return {
    cierre: [...el.querySelectorAll('input[name=ci]:checked')].map((x) => x.value),
    ventas: n('qVentas'), prendas: n('qPrendas'), efectivo: n('qEf'), digital: n('qDig'), tarjeta: n('qTar'),
    nota: el.querySelector('#qNota')?.value || '',
  };
}
function actualizarTotal(el) {
  const s = ['qEf', 'qDig', 'qTar'].reduce((a, id) => a + (Number(el.querySelector('#' + id)?.value) || 0), 0);
  const t = el.querySelector('#qTotal'); if (t) t.textContent = soles(s);
}

function iniciarSalida(turnoId) {
  const t = est.datos.turnosHoy.find((x) => x.id === turnoId);
  const el = abrirCapa(`<div><div class="eyebrow">Cierre de turno</div><h2>Cuadre y salida</h2><p class="small muted">Al marcar tu salida se apaga la ubicación y termina tu turno.</p></div>
    ${formCuadre(t, t.reporte || {})}
    <button type="button" class="btn-p btn-big" data-ok>Marcar salida</button><button type="button" data-cerrar>Cancelar</button>`, { clase: 'hoja', fondo: 'hoja-fondo' });
  el.addEventListener('input', () => actualizarTotal(el));
  el.querySelector('[data-ok]').addEventListener('click', () => { const cierre = leerCuadre(el); cerrarCapa(); marcar('salida', t, { cierre }); });
}
function editarCuadre(turnoId) {
  const t = est.datos.turnosHoy.find((x) => x.id === turnoId);
  const el = abrirCapa(`<div><div class="eyebrow">Cierre de turno</div><h2>Cuadre de caja</h2></div>${formCuadre(t, t.reporte || {})}
    <button type="button" class="btn-p btn-big" data-ok>Guardar</button><button type="button" data-cerrar>Cancelar</button>`, { clase: 'hoja', fondo: 'hoja-fondo' });
  el.addEventListener('input', () => actualizarTotal(el));
  el.querySelector('[data-ok]').addEventListener('click', async () => {
    try { await api.put(`/app/turnos/${turnoId}/reporte`, leerCuadre(el)); cerrarCapa(); toast('Cuadre guardado.'); await cargarHoy(); render(); } catch (e) { toast(e.message, 'bad'); }
  });
}

function mostrarPermisoBloqueado() {
  abrirCapa(`<div class="permiso" style="background:var(--bad-bg)"><h2 style="color:var(--bad-ink)">La ubicación está bloqueada</h2>
    <p class="small">Sin tu ubicación no se puede marcar la entrada. Actívala así y vuelve a intentar:</p>
    <div class="pasos"><div><b class="so">Android (Chrome)</b><ol><li>Toca el candado o el ícono de ajustes junto a la dirección.</li><li>Entra a <b>Permisos</b> → <b>Ubicación</b> → <b>Permitir</b>.</li><li>Revisa que la <b>Ubicación</b> del celular esté encendida.</li></ol></div>
    <div><b class="so">iPhone (Safari)</b><ol><li><b>Ajustes</b> → <b>Privacidad y seguridad</b> → <b>Localización</b>: activada.</li><li><b>Ajustes</b> → <b>Safari</b> → <b>Ubicación</b>: <b>Preguntar</b> o <b>Permitir</b>.</li><li>Vuelve aquí y recarga la página.</li></ol></div></div></div>
    <button type="button" class="btn-p btn-big" data-cerrar>Entendido</button>`, { clase: 'hoja', fondo: 'hoja-fondo' });
}

const fmtH = (x) => (Number.isInteger(x) ? String(x) : Number(x).toFixed(1).replace('.', ','));
const deMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Hoja para elegir hora de entrada y salida dentro del bloque de un turno libre. */
function elegirHorario(t) {
  const h = est.horario, r = h.reglas || {}, paso = r.paso || 30;
  const bi = aMin(t.bloque.inicio), bf = aMin(t.bloque.fin);
  const marcas = [bi]; for (let m = Math.ceil((bi + 1) / paso) * paso; m < bf; m += paso) marcas.push(m); marcas.push(bf);
  const minM = r.minTurno ? Math.min(r.minTurno * 60, bf - bi) : paso, maxM = r.maxTurno ? r.maxTurno * 60 : bf - bi;
  const opt = (lista, sel) => lista.map((m) => `<option value="${deMin(m)}" ${m === sel ? 'selected' : ''}>${hora12(deMin(m))}</option>`).join('');
  let ini = bi, fin = Math.min(bf, bi + Math.max(minM, Math.min(maxM, bf - bi)));
  if (!marcas.includes(fin)) fin = marcas.find((m) => m >= fin) ?? bf;
  const el = abrirCapa(`<div class="eyebrow">${cap(fLarga(t.fecha))}${h.tiendas.length > 1 ? ' · ' + esc(nombreBonito(t.tienda)) : ''}</div>
    <h2>Elige tu horario</h2><p class="small muted">${[`Horario disponible: ${hora12(t.bloque.inicio)} a ${hora12(t.bloque.fin)}`, r.minTurno ? `mínimo ${fmtH(r.minTurno)} h` : '', r.maxTurno ? `máximo ${fmtH(r.maxTurno)} h` : ''].filter(Boolean).join(' · ')}</p>
    <div class="grid-2c"><label class="f">Entrada<select id="hIni"></select></label><label class="f">Salida<select id="hFin"></select></label></div>
    <div class="resumen-hora" id="hRes"></div>
    <button type="button" class="btn-p btn-big" data-ok>Elegir este horario</button><button type="button" class="btn-ghost" data-cerrar>Cancelar</button>`, { clase: 'hoja', fondo: 'hoja-fondo' });
  const sIni = el.querySelector('#hIni'), sFin = el.querySelector('#hFin'), res = el.querySelector('#hRes'), ok = el.querySelector('[data-ok]');
  const pintarSel = () => {
    sIni.innerHTML = opt(marcas.filter((m) => m <= bf - minM), ini);
    const fines = marcas.filter((m) => m - ini >= minM && m - ini <= maxM);
    if (!fines.includes(fin)) fin = fines[fines.length - 1] ?? bf;
    sFin.innerHTML = opt(fines, fin);
    const dur = (fin - ini) / 60, total = h.horasTengo + dur;
    const pasa = r.maxSemana && total > r.maxSemana;
    res.innerHTML = `<b>${fmtH(dur)} h</b> de turno · tu semana quedaría en <b>${fmtH(total)} h</b>${pasa ? `<div class="small" style="color:var(--bad-ink)">Pasarías el máximo de ${fmtH(r.maxSemana)} h por semana.</div>` : ''}`;
    ok.disabled = !!pasa || fin <= ini;
  };
  sIni.addEventListener('change', () => { ini = aMin(sIni.value); pintarSel(); });
  sFin.addEventListener('change', () => { fin = aMin(sFin.value); pintarSel(); });
  pintarSel();
  ok.addEventListener('click', async () => {
    ok.disabled = true;
    try {
      await api.post(`/app/turnos/${t.id}/elegir`, { inicio: deMin(ini), fin: deMin(fin) });
      cerrarCapa(); toast(`¡Listo! Tu turno: ${hora12(deMin(ini))} a ${hora12(deMin(fin))}`); if (navigator.vibrate) navigator.vibrate(40);
      await Promise.all([cargarTab(), cargarHoy()]);
    } catch (e) { toast(e.message, 'bad'); ok.disabled = false; if (e.status === 409) { cerrarCapa(); cargarTab(); } }
  });
}

function elegirCubrir() {
  const d = est.datos;
  const el = abrirCapa(`<div><div class="eyebrow">Cubrir turno</div><h2>¿Qué turno vas a cubrir?</h2><p class="small muted">La supervisión verá que cubriste el turno. Si lo coordinaste antes, es mejor que la otra persona pida cobertura desde su app.</p></div>
    <div class="stack" style="gap:8px">${d.otrosHoy.map((t) => `<button type="button" class="elegir-btn" data-t="${t.id}"><span class="num"><b>${t.inicio}–${t.fin}</b> · ${esc(nombreBonito(t.tienda?.nombre))}</span><span class="small">${t.usuario ? esc(nombreBonito(t.usuario)) : 'Libre'}</span></button>`).join('')}</div>
    <button type="button" data-cerrar>Cancelar</button>`, { clase: 'hoja', fondo: 'hoja-fondo' });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const t = d.otrosHoy.find((x) => x.id === Number(b.dataset.t));
    cerrarCapa();
    // Turno provisional para la vista; al marcar se recarga desde el servidor.
    if (!d.turnosHoy.some((x) => x.id === t.id)) d.turnosHoy.push({ ...t, propio: false, usuario_nombre: t.usuario, ev: null, marcas: [], reporte: null });
    iniciarEntrada(t.id, true);
  });
}

/* ---------------- reportes automáticos ---------------- */
const enviarControl = (it) => api.post('/app/marcas', it);
async function tickReportes() {
  const t = turnoAbierto();
  if (!t || est.enviando || est.ocupado) return;
  const p = ahoraServidor(), prox = t.ev?.proximo;
  if (prox == null || p.minutos < prox || est.ultimaFranja === `${t.id}|${prox}`) return;
  if (gps.estado.sim === 'sin_senal') return;
  est.enviando = true;
  try {
    const pos = await gps.obtener(t.tienda);
    const item = { tipo: 'control', lat: pos.lat, lng: pos.lng, precision: pos.precision, capturado: Date.now() + est.offset, dispositivo: disp, simulado: !!pos.simulado || undefined };
    try { await enviarControl(item); } catch (e) { if (e.red) cola.agregar(item); else throw e; }
    est.ultimaFranja = `${t.id}|${prox}`;
    await cargarHoy(); render();
  } catch { /* sin señal: la supervisión verá el reporte faltante */ } finally { est.enviando = false; }
}
async function vaciarCola() {
  const n = await cola.vaciar(enviarControl);
  if (n) { toast(`Se enviaron ${plural(n, 'reporte')} pendiente${n > 1 ? 's' : ''}.`); await cargarHoy().catch(() => {}); render(); }
}

/* ---------------- eventos ---------------- */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button, a[data-accion]');
  if (!b || b.closest('#capa')) return;
  const ds = b.dataset;
  try {
    if (ds.tab) { est.tab = ds.tab; LS.set('nc_tab', ds.tab); est.msg = null; window.scrollTo({ top: 0 }); render(); return cargarTab(); }
    if (ds.semana) { est.semana = ds.semana; est.horario = null; render(); return cargarTab(); }
    if (ds.sim) { gps.setSim(ds.sim); if (ds.sim === 'real') gps.seguir(); render(); return; }
    if (ds.accion === 'entrada') return iniciarEntrada(Number(ds.turno));
    if (ds.accion === 'salida') return iniciarSalida(Number(ds.turno));
    if (ds.accion === 'editarCuadre') return editarCuadre(Number(ds.turno));
    if (ds.accion === 'cubrir') return elegirCubrir();
    if (ds.accion === 'multasVistas') { await api.post('/app/multas/vistas'); await cargarHoy(); return render(); }
    if (ds.accion === 'instalar') { est.instalar?.prompt(); est.instalar = null; return render(); }
    if (ds.accion === 'salir') {
      if (turnoAbierto() && !(await confirmar({ titulo: '¿Cerrar sesión con el turno abierto?', texto: 'Los reportes de ubicación se detendrán hasta que vuelvas a ingresar.', si: 'Cerrar sesión', clase: 'hoja', fondo: 'hoja-fondo' }))) return;
      await api.post('/app/logout'); gps.detener(); est.datos = null; est.msg = null; return render();
    }
    if (ds.elegir) {
      const t = est.horario.turnos.find((x) => x.id === Number(ds.elegir));
      if (est.horario.reglas?.elegirHoras && t) return elegirHorario(t);
      await api.post(`/app/turnos/${ds.elegir}/elegir`); toast('¡Turno elegido! Listo.'); if (navigator.vibrate) navigator.vibrate(40); await Promise.all([cargarTab(), cargarHoy()]); return;
    }
    if (ds.soltar) { if (!(await confirmar({ titulo: '¿Soltar este turno?', texto: 'Quedará libre para que otra persona lo elija.', si: 'Soltar', clase: 'hoja', fondo: 'hoja-fondo' }))) return; await api.del(`/app/turnos/${ds.soltar}/elegir`); toast('Turno liberado.'); await Promise.all([cargarTab(), cargarHoy()]); return; }
    if (ds.pedircob) return pedirCobertura(Number(ds.pedircob));
    if (ds.tomar) { if (!(await confirmar({ titulo: '¿Tomar este turno?', texto: 'Pasará a tu nombre y tendrás que asistir.', si: 'Sí, lo tomo', clase: 'hoja', fondo: 'hoja-fondo' }))) return; await api.post(`/app/coberturas/${ds.tomar}/tomar`); toast('Turno tomado. ¡Gracias por cubrir!'); await Promise.all([cargarTab(), cargarHoy()]); return; }
    if (ds.cancelarcob) { await api.del(`/app/coberturas/${ds.cancelarcob}`); toast('Solicitud cancelada.'); return cargarTab(); }
    if (ds.justificar) return justificar(Number(ds.justificar));
  } catch (err) { toast(err.message, 'bad'); await cargarTab(); }
});

function pedirCobertura(turnoId) {
  const el = abrirCapa(`<div><div class="eyebrow">Pedir cobertura</div><h2>¿No puedes asistir?</h2><p class="small muted">Tu turno se ofrecerá al resto del equipo. Sigue siendo tuyo hasta que alguien lo tome.</p></div>
    <label class="f">Motivo (opcional)<input type="text" id="cobMotivo" maxlength="200" placeholder="Ej.: cita médica"></label>
    <button type="button" class="btn-p btn-big" data-ok>Pedir cobertura</button><button type="button" data-cerrar>Cancelar</button>`, { clase: 'hoja', fondo: 'hoja-fondo' });
  el.querySelector('[data-ok]').addEventListener('click', async () => {
    try { await api.post('/app/coberturas', { turnoId, motivo: el.querySelector('#cobMotivo').value }); cerrarCapa(); toast('Solicitud enviada al equipo.'); cargarTab(); } catch (e) { toast(e.message, 'bad'); }
  });
}
function justificar(multaId) {
  const el = abrirCapa(`<div><div class="eyebrow">Justificación</div><h2>Explica qué pasó</h2><p class="small muted">La supervisión revisará tu justificación. Si la aprueba, la multa se anula.</p></div>
    <label class="f">Motivo<textarea id="jMotivo" maxlength="500" required placeholder="Ej.: tuve una emergencia familiar; envié foto del certificado por WhatsApp"></textarea></label>
    <button type="button" class="btn-p btn-big" data-ok>Enviar justificación</button><button type="button" data-cerrar>Cancelar</button>`, { clase: 'hoja', fondo: 'hoja-fondo' });
  el.querySelector('[data-ok]').addEventListener('click', async () => {
    try { await api.post(`/app/multas/${multaId}/justificar`, { motivo: el.querySelector('#jMotivo').value }); cerrarCapa(); toast('Justificación enviada.'); cargarTab(); } catch (e) { toast(e.message, 'bad'); }
  });
}

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.target.id === 'fLogin') {
    est.ocupado = true; est.msg = null; render();
    try {
      await api.post('/app/login', { codigo: $('#lCodigo').value.trim(), clave: $('#lPin').value.trim() });
      if ($('#lAcepto')?.checked) LS.set('nc_consent', '1');
      await cargarHoy();
      if (est.datos.ventana.puedeElegir) est.tab = 'horario';
      est.ocupado = false; render(); cargarTab();
    } catch (err) { est.ocupado = false; est.msg = { texto: err.message, clase: 'bad' }; render(); }
  }
  if (e.target.id === 'fClave') {
    try { await api.post('/app/clave', { actual: $('#cActual').value, nueva: $('#cNueva').value }); toast('Clave actualizada.'); e.target.reset(); } catch (err) { toast(err.message, 'bad'); }
  }
});

/* ---------------- ciclo de vida ---------------- */
onSesionVencida((ruta) => { if (!ruta.startsWith('/app/')) return; est.datos = null; gps.detener(); render(); });
gps.oir(() => {
  if (!est.datos) return;
  for (const el of raiz.querySelectorAll('[data-dist]')) {
    const t = est.datos.turnosHoy.find((x) => x.id === Number(el.dataset.dist));
    if (t) { const html = distanciaHtml(t); if (el.innerHTML !== html) el.innerHTML = html; }
  }
});
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); est.instalar = e; });
window.addEventListener('online', () => { est.online = true; render(); vaciarCola(); });
window.addEventListener('offline', () => { est.online = false; render(); });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !est.datos) return;
  try { await cargarHoy(); } catch {}
  if (turnoAbierto()) { gps.mantenerPantalla(); gps.seguir(); }
  render(); tickReportes(); vaciarCola();
});
setInterval(() => { if (est.datos && !document.getElementById('capa')) { tickReportes(); const r = raiz.querySelector('.reloj'); if (r) { const p = ahoraServidor(); r.firstChild.textContent = p.hora; } } }, 15000);
setInterval(async () => { if (est.datos && document.visibilityState === 'visible' && !est.ocupado) { try { await cargarHoy(); if (!document.getElementById('capa')) render(); } catch {} } }, 60000);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});

(async function iniciar() {
  try { est.info = await api.get('/estado'); } catch (e) { raiz.innerHTML = `<div class="login-m"><div class="msg bad">${esc(e.message)}</div><button onclick="location.reload()">Reintentar</button></div>`; return; }
  document.title = `${est.info.empresa} · Asistencia`;
  try { await cargarHoy(); } catch { est.datos = null; }
  render();
  if (est.datos) { cargarTab(); tickReportes(); vaciarCola(); }
})();
