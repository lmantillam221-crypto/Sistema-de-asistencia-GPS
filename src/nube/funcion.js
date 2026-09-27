/* =====================================================================
   API en Netlify Functions. Misma lógica que el servidor Node:
   - SQLite en memoria (sql.js), cargada desde Netlify Blobs y reutilizada mientras no cambie
   - cada petición que modifica datos se guarda con escritura condicional (sin pisar a nadie)
   - las multas automáticas se calculan al vuelo (no hay procesos permanentes)
   ===================================================================== */
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { setSQL, DatabaseSync } from '../lib/sqljs.js';
import { migrar } from '../db/index.js';
import { leerConfig } from '../config.js';
import { crearContexto } from '../services/index.js';
import { rutasAuth } from '../routes/auth.js';
import { rutasApp } from '../routes/app.js';
import { rutasPanel } from '../routes/panel.js';
import { manejarErrores, soloJson } from '../middleware.js';
import { Router, despachar } from '../lib/enrutador.js';
import migracion001 from '../db/migrations/001_inicial.sql';

const MIGRACIONES = [{ nombre: '001_inicial.sql', sql: migracion001 }];
let sqlListo = null, ctx = null, api = null, etagActual, ultimaTarea = 0;

// Marca fijada al empaquetar (MARCA en el build de Netlify); se puede sobrescribir con la variable de entorno.
const MARCA_COMPILADA = typeof __MARCA__ !== 'undefined' ? __MARCA__ : undefined; // eslint-disable-line no-undef

function configuracion(env) {
  return { ...leerConfig({ ...env, MARCA: env.MARCA || MARCA_COMPILADA }), dbPath: ':memory:', produccion: true, trustProxy: true, demo: false, tiempoReal: 'sondeo' };
}

async function cargar(almacen, env) {
  const etag = await almacen.etag();
  if (ctx && etag === etagActual) return;
  const datos = etag ? await almacen.leer() : null;
  if (!ctx) {
    const db = new DatabaseSync(datos?.bytes ?? null);
    db.exec('PRAGMA foreign_keys = ON');
    migrar(db, MIGRACIONES);
    ctx = crearContexto(configuracion(env), { db });
    api = Router();
    api.use(soloJson);
    api.use(rutasAuth(ctx));
    api.use('/app', rutasApp(ctx));
    api.use('/panel', rutasPanel(ctx));
  } else {
    ctx.db.reemplazar(datos?.bytes ?? null);
    migrar(ctx.db, MIGRACIONES);
    ctx.s.empresa.olvidar();
    ctx.s.empresa.asegurar();
  }
  etagActual = datos?.etag ?? null;
}

/** Atiende un Request web estándar y devuelve un Response. */
export async function atenderNetlify(request, { almacen, env = process.env, ip = '' } = {}) {
  sqlListo ||= initSqlJs().then(setSQL);
  await sqlListo;
  const url = new URL(request.url);
  const ruta = url.pathname.replace(/^\/\.netlify\/functions\/api/, '/api') + url.search;
  const metodo = request.method.toUpperCase();
  const headers = Object.fromEntries([...request.headers].map(([k, v]) => [k.toLowerCase(), v]));
  let body = {};
  if (!['GET', 'HEAD'].includes(metodo)) { const t = await request.text(); if (t) { try { body = JSON.parse(t); } catch { body = null; } } }
  if (body === null) return Response.json({ error: 'JSON inválido.' }, { status: 400 });

  for (let intento = 0; intento < 6; intento++) {
    await cargar(almacen, env);
    const c0 = ctx.db.cambiosTotales();
    if (Date.now() - ultimaTarea > 60000) {
      try { ctx.s.multas.sincronizar(); ctx.s.coberturas.vencer(); } catch (e) { console.error(e); }
      ultimaTarea = Date.now();
    }
    const r = await despachar(api, manejarErrores(ctx), { method: metodo, url: ruta, headers, body, ip });
    if (ctx.db.cambiosTotales() !== c0) {
      const w = await almacen.escribir(ctx.db.exportar(), etagActual);
      if (!w.ok) { etagActual = undefined; ultimaTarea = 0; await new Promise((ok) => setTimeout(ok, 60 + Math.random() * 140)); continue; }
      etagActual = w.etag ?? (await almacen.etag());
    }
    const h = new Headers(r.headers);
    h.set('Cache-Control', 'no-store');
    for (const c of r.cookies) h.append('Set-Cookie', c);
    return new Response(r.body ?? '', { status: r.status, headers: h });
  }
  return Response.json({ error: 'Hay muchas personas guardando a la vez. Inténtalo de nuevo en unos segundos.' }, { status: 503 });
}
