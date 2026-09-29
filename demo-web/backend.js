/* =====================================================================
   Demo web: el servidor real (servicios, reglas y rutas) corriendo dentro del navegador.
   - SQLite (sql.js) guardada en localStorage de este navegador
   - fetch('/api/…') y EventSource se atienden aquí mismo
   ===================================================================== */
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { setSQL, DatabaseSync } from './shims/sqlite.js';
import { motorSqlite } from '../src/db/motor.js';
import { migrar } from '../src/db/index.js';
import { leerConfig } from '../src/config.js';
import { crearContexto } from '../src/services/index.js';
import { rutasAuth } from '../src/routes/auth.js';
import { rutasApp } from '../src/routes/app.js';
import { rutasPanel } from '../src/routes/panel.js';
import { manejarErrores, soloJson, porPeticion } from '../src/middleware.js';
import { Router, despachar } from '../src/lib/enrutador.js';
import { ejecutarTareas } from '../src/jobs.js';
import { EventEmitter } from './shims/events.js';
import { asegurarBaseDemo, generarEjemplo } from '../src/lib/demo.js';
import { partes, instante } from '../src/domain/tiempo.js';
import sq001 from '../src/db/migrations/sqlite/001_inicial.sql';
import sq002 from '../src/db/migrations/sqlite/002_indices.sql';
import sq003 from '../src/db/migrations/sqlite/003_horarios_flexibles.sql';

const MIGRACIONES = [{ nombre: '001_inicial.sql', sql: sq001 }, { nombre: '002_indices.sql', sql: sq002 }, { nombre: '003_horarios_flexibles.sql', sql: sq003 }];

// setInterval(...).unref() existe en Node; en el navegador no hace falta.
// eslint-disable-next-line no-extend-native
if (!Number.prototype.unref) Number.prototype.unref = function unref() { return this; };

const K = { db: 'nc_demo_db', jar: 'nc_demo_jar', reloj: 'nc_demo_reloj' };
const LSg = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const LSs = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const aB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

export const bus = new EventEmitter();
let ctx = null, api = null, crudo = null;

function persistir() { if (crudo) LSs(K.db, aB64(crudo.exportar())); }

export const listo = (async () => {
  setSQL(await initSqlJs());
  const guardada = LSg(K.db);
  try { crudo = new DatabaseSync(guardada ? deB64(guardada) : null); } catch { crudo = new DatabaseSync(null); }
  crudo.exec('PRAGMA foreign_keys = ON');
  const db = motorSqlite(crudo);
  await migrar(db, MIGRACIONES);
  const cfg = { ...leerConfig(process.env), dbPath: ':memory:', demo: true, produccion: false, admin: { codigo: 'admin', password: 'admin12345', nombre: 'Administración' } };
  ctx = await crearContexto(cfg, { db });

  // Reloj de demostración que sobrevive a recargas
  const r = ctx.reloj;
  let sim = null;
  try { sim = JSON.parse(LSg(K.reloj) || 'null'); } catch {}
  r.ms = () => (sim ? sim.base + (Date.now() - sim.real) : Date.now());
  r.ahora = () => partes(r.ms(), r.tz);
  r.simular = (f, h) => { sim = f ? { base: instante(f, h, r.tz), real: Date.now() } : null; LSs(K.reloj, JSON.stringify(sim)); };
  Object.defineProperty(r, 'simulado', { get: () => !!sim, configurable: true });

  if (!guardada) { await asegurarBaseDemo(ctx); await generarEjemplo(ctx); }
  await ejecutarTareas(ctx);
  persistir();
  ctx.bus.on('cambio', (e) => bus.emit('cambio', e));

  api = Router();
  api.use(soloJson);
  api.use(porPeticion(ctx));
  api.use(rutasAuth(ctx));
  api.use('/app', rutasApp(ctx));
  api.use('/panel', rutasPanel(ctx));

  setInterval(async () => {
    const c0 = crudo.cambiosTotales();
    try { await ejecutarTareas(ctx); } catch (e) { console.error(e); }
    if (crudo.cambiosTotales() !== c0) persistir();
    bus.emit('cambio', { tipo: 'minuto' });
  }, 60000);
})();

/* ---------------- cookies de sesión (en este navegador) ---------------- */
const jar = (() => { try { return JSON.parse(LSg(K.jar) || '{}'); } catch { return {}; } })();
function ponerCookie(linea) {
  const [kv, ...attrs] = linea.split(';');
  const i = kv.indexOf('='), k = kv.slice(0, i).trim(), v = decodeURIComponent(kv.slice(i + 1).trim());
  if (!v || attrs.some((a) => /max-age=0/i.test(a))) delete jar[k]; else jar[k] = v;
  LSs(K.jar, JSON.stringify(jar));
}

/* ---------------- atención de peticiones ---------------- */
async function atender(metodo, url, cabeceras, cuerpo) {
  await listo;
  const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '), 'user-agent': navigator.userAgent, 'content-type': cabeceras['content-type'] || '' };
  const c0 = crudo.cambiosTotales();
  const r = await despachar(api, manejarErrores(ctx), { method: metodo, url, headers, body: cuerpo, ip: 'demo' });
  for (const c of r.cookies) ponerCookie(c);
  try { if (crudo.cambiosTotales() !== c0) persistir(); } catch {}
  return new Response(r.body ?? '', { status: r.status, headers: r.headers });
}

const fetchOriginal = window.fetch.bind(window);
window.fetch = async (entrada, init = {}) => {
  const url = typeof entrada === 'string' ? entrada : entrada.url;
  if (!url.startsWith('/api/') && !url.startsWith('/api?')) return fetchOriginal(entrada, init);
  const cab = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  let cuerpo = {};
  if (init.body) { try { cuerpo = JSON.parse(init.body); } catch { cuerpo = {}; } }
  // Pequeña espera para que la interfaz se comporte como con un servidor real
  await new Promise((r) => setTimeout(r, 40));
  return atender((init.method || 'GET').toUpperCase(), url, cab, cuerpo);
};

/* Tiempo real: el panel escucha los cambios directamente */
window.EventSource = class {
  constructor() { this.ls = new Map(); this.f = (e) => (this.ls.get('cambio') || []).forEach((fn) => fn({ data: JSON.stringify(e) })); bus.on('cambio', this.f); setTimeout(() => this.onopen?.(), 80); }
  addEventListener(t, fn) { if (!this.ls.has(t)) this.ls.set(t, []); this.ls.get(t).push(fn); }
  close() { bus.off('cambio', this.f); }
};

export function reiniciarDemo() {
  for (const k of Object.values(K)) { try { localStorage.removeItem(k); } catch {} }
  for (const k of ['nc_tab', 'nc_seccion', 'nc_sim']) { try { localStorage.removeItem(k); } catch {} }
}
