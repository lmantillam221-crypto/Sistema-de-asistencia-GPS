/* =====================================================================
   API en Netlify Functions con PostgreSQL (Netlify DB / Neon).
   - Cada instancia mantiene un pool de conexiones; PostgreSQL resuelve la concurrencia
     (100+ personas a la vez) con transacciones y bloqueos de fila, sin reescribir archivos.
   - Las tareas pesadas (multas automáticas) corren en la función programada "tareas".
   - La primera vez, si existen datos de la versión anterior en Netlify Blobs, se copian solos.
   ===================================================================== */
import { motorPostgres, fuenteNeon, urlPostgres } from '../db/motor.js';
import { migrar } from '../db/index.js';
import { leerConfig } from '../config.js';
import { crearContexto } from '../services/index.js';
import { rutasAuth } from '../routes/auth.js';
import { rutasApp } from '../routes/app.js';
import { rutasPanel } from '../routes/panel.js';
import { manejarErrores, soloJson, porPeticion } from '../middleware.js';
import { Router, despachar } from '../lib/enrutador.js';
import { ejecutarTareas } from '../jobs.js';
import { migrarDesdeSqlite } from './migrar-blobs.js';
import pg001 from '../db/migrations/postgres/001_inicial.sql';
import pg002 from '../db/migrations/postgres/002_horarios_flexibles.sql';
import sq001 from '../db/migrations/sqlite/001_inicial.sql';
import sq002 from '../db/migrations/sqlite/002_indices.sql';
import sq003 from '../db/migrations/sqlite/003_horarios_flexibles.sql';

const MIG_PG = [{ nombre: '001_inicial.sql', sql: pg001 }, { nombre: '002_horarios_flexibles.sql', sql: pg002 }];
const MIG_SQLITE = [{ nombre: '001_inicial.sql', sql: sq001 }, { nombre: '002_indices.sql', sql: sq002 }, { nombre: '003_horarios_flexibles.sql', sql: sq003 }];
// Marca fijada al empaquetar (MARCA en el build de Netlify); se puede sobrescribir con la variable de entorno.
const MARCA_COMPILADA = typeof __MARCA__ !== 'undefined' ? __MARCA__ : undefined; // eslint-disable-line no-undef

let listo = null;

function configuracion(env) {
  return { ...leerConfig({ ...env, MARCA: env.MARCA || MARCA_COMPILADA }), dbPath: ':memory:', produccion: true, trustProxy: true, demo: false, tiempoReal: 'sondeo' };
}

async function preparar({ fuente, env, almacenAnterior }) {
  const db = motorPostgres(fuente || (await fuenteNeon(urlPostgres(env))));
  await migrar(db, MIG_PG);
  if (almacenAnterior && (await db.prepare('SELECT COUNT(*) AS n FROM empresa').get()).n === 0) {
    try {
      const anterior = await almacenAnterior();
      const filas = anterior ? await migrarDesdeSqlite(db, anterior.bytes, MIG_SQLITE) : 0;
      if (filas) console.log(`Migración desde Netlify Blobs completada: ${filas} filas.`);
    } catch (e) { console.error('No se pudo migrar la base anterior de Netlify Blobs:', e); }
  }
  const ctx = await crearContexto(configuracion(env), { db });
  const api = Router();
  api.use(soloJson);
  api.use(porPeticion(ctx));
  api.use(rutasAuth(ctx));
  api.use('/app', rutasApp(ctx));
  api.use('/panel', rutasPanel(ctx));
  return { ctx, api };
}

function contexto(opciones) {
  listo ||= preparar(opciones).catch((e) => { listo = null; throw e; });
  return listo;
}

const sinBase = () => Response.json({
  error: 'Falta conectar la base de datos. En Netlify: Extensions → Neon (Netlify DB) → conectar, o define DATABASE_URL. Luego vuelve a desplegar.',
  codigo: 'SIN_BASE',
}, { status: 503 });

/** Atiende un Request web estándar y devuelve un Response. */
export async function atenderNetlify(request, { fuente = null, env = process.env, ip = '', almacenAnterior = null } = {}) {
  if (!fuente && !urlPostgres(env)) return sinBase();
  let ctx, api;
  try { ({ ctx, api } = await contexto({ fuente, env, almacenAnterior })); } catch (e) {
    console.error('Error al conectar con la base de datos:', e);
    return Response.json({ error: 'No se pudo conectar con la base de datos. Inténtalo de nuevo en unos segundos.' }, { status: 503, headers: { 'Retry-After': '3' } });
  }
  const url = new URL(request.url);
  const ruta = url.pathname.replace(/^\/\.netlify\/functions\/api/, '/api') + url.search;
  const metodo = request.method.toUpperCase();
  const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
  let body = {};
  if (!['GET', 'HEAD'].includes(metodo)) { const t = await request.text(); if (t) { try { body = JSON.parse(t); } catch { body = null; } } }
  if (body === null) return Response.json({ error: 'JSON inválido.' }, { status: 400 });

  const r = await despachar(api, manejarErrores(ctx), { method: metodo, url: ruta, headers, body, ip });
  const h = new Headers(r.headers);
  h.set('Cache-Control', 'no-store');
  for (const c of r.cookies) h.append('Set-Cookie', c);
  return new Response(r.body ?? '', { status: r.status, headers: h });
}

/** Tareas programadas (multas automáticas, coberturas vencidas, limpieza). */
export async function tareasNetlify({ fuente = null, env = process.env, almacenAnterior = null } = {}) {
  if (!fuente && !urlPostgres(env)) return { omitido: 'sin base de datos' };
  const { ctx } = await contexto({ fuente, env, almacenAnterior });
  return ejecutarTareas(ctx, { limpieza: new Date().getUTCHours() === 13 && new Date().getUTCMinutes() < 15 /* 8:00 a. m. de Perú */ });
}
