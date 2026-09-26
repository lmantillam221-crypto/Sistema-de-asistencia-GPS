import { crearContexto } from '../src/services/index.js';
import { abrirDB } from '../src/db/abrir.js';
import { crearApp } from '../src/app.js';
import { instante } from '../src/domain/tiempo.js';
import { leerConfig } from '../src/config.js';

/** Levanta un servidor de prueba con base en memoria y un reloj controlable. */
export async function servidorPrueba({ demo = false, fecha = '2026-09-23', hora = '12:00' } = {}) {
  let ms = instante(fecha, hora, 'America/Lima');
  const cfg = { ...leerConfig({}), dbPath: ':memory:', demo, admin: { codigo: 'admin', password: 'admin-clave-123', nombre: 'Admin' } };
  const ctx = crearContexto(cfg, { db: abrirDB(':memory:'), ahora: () => ms });
  const app = crearApp(ctx);
  const srv = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const cliente = () => {
    let cookie = '';
    const pedir = async (metodo, ruta, cuerpo) => {
      const r = await fetch(base + ruta, { method: metodo, headers: { ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), cookie }, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
      const sc = r.headers.getSetCookie?.() || [];
      for (const c of sc) { const [kv] = c.split(';'); const [k, v] = kv.split('='); cookie = cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')).concat(v ? [`${k}=${v}`] : []).join('; '); }
      const tipo = r.headers.get('content-type') || '';
      return { status: r.status, body: tipo.includes('json') ? await r.json() : await r.text() };
    };
    return { get: (u) => pedir('GET', u), post: (u, b = {}) => pedir('POST', u, b), put: (u, b = {}) => pedir('PUT', u, b), del: (u) => pedir('DELETE', u, {}) };
  };
  return {
    ctx, base, cliente,
    irA(f, h) { ms = instante(f, h, 'America/Lima'); },
    cerrar: () => new Promise((ok) => srv.close(ok)),
  };
}
