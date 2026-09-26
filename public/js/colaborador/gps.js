/* Ubicación del celular: permisos, seguimiento continuo, pantalla encendida y simulador (solo demo). */
import { LS } from '../core/util.js';

const estado = {
  pos: null,          // { lat, lng, precision, t }
  seguimiento: null,
  bloqueo: null,
  sim: LS.get('nc_sim') || 'real',
  precisionSim: 12,
  error: null,
};
const oyentes = new Set();
const avisar = () => oyentes.forEach((f) => f(estado));

export const gps = {
  estado,
  oir(f) { oyentes.add(f); },
  posible: () => 'geolocation' in navigator && window.isSecureContext,
  async permiso() {
    try { return (await navigator.permissions.query({ name: 'geolocation' })).state; } catch { return 'desconocido'; }
  },
  setSim(modo) { estado.sim = modo; LS.set('nc_sim', modo); estado.pos = null; avisar(); },

  /** Posición actual. Usa la del seguimiento continuo si es reciente (< 15 s para marcar, < 45 s para reportes). */
  obtener(tienda, { fresca = false } = {}) {
    if (estado.sim !== 'real') return Promise.resolve(simular(tienda));
    if (estado.pos && Date.now() - estado.pos.t < (fresca ? 15000 : 45000)) return Promise.resolve({ ...estado.pos });
    return new Promise((ok, mal) => {
      if (!gps.posible()) return mal(Object.assign(new Error('Este navegador no puede usar el GPS. Abre la app desde su enlace https://'), { codigo: 'NO_GPS' }));
      navigator.geolocation.getCurrentPosition(
        (p) => { estado.pos = { lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy), t: Date.now() }; estado.error = null; avisar(); ok({ ...estado.pos }); },
        (e) => mal(Object.assign(new Error(e.code === 1 ? 'Permiso de ubicación denegado.' : 'No se pudo obtener tu ubicación. Revisa que la Ubicación del celular esté encendida, acércate a una puerta o ventana e inténtalo de nuevo.'), { codigo: e.code === 1 ? 'DENEGADO' : 'SIN_SENAL' })),
        { enableHighAccuracy: true, timeout: 25000, maximumAge: 10000 },
      );
    });
  },

  /** Seguimiento continuo mientras la app está abierta (para mostrar distancia y enviar reportes). */
  seguir() {
    if (estado.seguimiento != null || estado.sim !== 'real' || !gps.posible()) return;
    estado.seguimiento = navigator.geolocation.watchPosition(
      (p) => { estado.pos = { lat: p.coords.latitude, lng: p.coords.longitude, precision: Math.round(p.coords.accuracy), t: Date.now() }; estado.error = null; avisar(); },
      (e) => { estado.error = e.code; avisar(); },
      { enableHighAccuracy: true, maximumAge: 20000, timeout: 60000 },
    );
  },
  detener() {
    if (estado.seguimiento != null) { try { navigator.geolocation.clearWatch(estado.seguimiento); } catch {} estado.seguimiento = null; }
    gps.soltarPantalla();
  },
  /** Evita que la pantalla se apague durante el turno (Wake Lock API). */
  async mantenerPantalla() {
    if (estado.bloqueo || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { estado.bloqueo = await navigator.wakeLock.request('screen'); estado.bloqueo.addEventListener('release', () => { estado.bloqueo = null; }); } catch {}
  },
  soltarPantalla() { try { estado.bloqueo?.release(); } catch {} estado.bloqueo = null; },
};

function simular(tienda) {
  if (estado.sim === 'sin_senal') return Promise.reject(Object.assign(new Error('Celular sin señal de GPS (simulado).'), { codigo: 'SIN_SENAL' }));
  const t = tienda || { lat: -7.1547444, lng: -78.5166566, radio_m: 80 };
  const m = estado.sim === 'dentro' ? 3 + Math.random() * Math.min(25, t.radio_m * 0.4) : estado.sim === 'cerca' ? t.radio_m + 150 + Math.random() * 100 : 2600 + Math.random() * 800;
  const g = Math.random() * Math.PI * 2;
  const pos = { lat: t.lat + (m * Math.cos(g)) / 111320, lng: t.lng + (m * Math.sin(g)) / (111320 * Math.cos((t.lat * Math.PI) / 180)), precision: estado.precisionSim, t: Date.now(), simulado: true };
  estado.pos = pos;
  return pos;
}

/* ---- Cola de reportes sin internet: se reenvían solos cuando vuelve la conexión ---- */
const CLAVE_COLA = 'nc_cola';
export const cola = {
  leer: () => LS.json(CLAVE_COLA, []),
  agregar(item) { const c = cola.leer(); c.push(item); LS.set(CLAVE_COLA, JSON.stringify(c.slice(-30))); },
  async vaciar(enviar) {
    const c = cola.leer();
    if (!c.length) return 0;
    const quedan = [];
    let n = 0;
    for (const it of c) {
      try { await enviar(it); n++; } catch (e) { if (e.red) quedan.push(it); }
    }
    LS.set(CLAVE_COLA, JSON.stringify(quedan));
    return n;
  },
};

export function idDispositivo() {
  let id = LS.get('nc_disp');
  if (!id) { id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)); LS.set('nc_disp', id); }
  return id;
}
