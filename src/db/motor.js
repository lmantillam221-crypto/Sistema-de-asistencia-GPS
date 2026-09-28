/* =====================================================================
   Motor de base de datos: una sola interfaz asíncrona para dos motores.
   - PostgreSQL (producción en Netlify/Neon, o PGlite en pruebas): concurrencia real,
     transacciones por conexión y bloqueos de fila.
   - SQLite (servidor propio, demo y pruebas): una conexión; las peticiones se atienden
     de a una (exclusivo) para que las transacciones nunca se mezclen.

   Interfaz:
     db.prepare(sql).get(...p) / .all(...p) / .run(...p) → {changes, lastInsertRowid}
     db.exec(sql)                  varias sentencias sin parámetros
     db.tx(fn)                     transacción (anidable con SAVEPOINT)
     db.bloquearFila(tabla, id)    SELECT … FOR UPDATE en PostgreSQL (en SQLite no hace falta)
     db.exclusivo(fn)              atiende fn en exclusiva (solo SQLite; en PostgreSQL ejecuta fn)
   El SQL se escribe con marcadores "?" y sintaxis común a ambos motores.
   ===================================================================== */
import { AsyncLocalStorage } from 'node:async_hooks';

const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const ident = (t) => { if (!/^[a-z_]+$/.test(t)) throw new Error('Tabla inválida'); return t; };

/* ---------------- SQLite (node:sqlite, o sql.js en el navegador) ---------------- */
export function motorSqlite(crudo) {
  const als = new AsyncLocalStorage();
  const cache = new Map();
  let cola = Promise.resolve();
  let sp = 0;
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = crudo.prepare(sql); if (cache.size > 500) cache.clear(); cache.set(sql, s); } return s; };

  const db = {
    tipo: 'sqlite',
    crudo,
    prepare(sql) {
      return {
        get: async (...p) => { const r = stmt(sql).get(...norm(p)); return r ? { ...r } : undefined; },
        all: async (...p) => stmt(sql).all(...norm(p)).map((r) => ({ ...r })),
        run: async (...p) => { const r = stmt(sql).run(...norm(p)); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
      };
    },
    async exec(sql) { crudo.exec(sql); },
    async bloquearFila() {},
    /** Cola global: una operación completa a la vez sobre la única conexión. Reentrante. */
    exclusivo(fn) {
      if (als.getStore()?.exclusivo) return fn();
      const turno = cola.then(() => als.run({ exclusivo: true, prof: 0 }, fn));
      cola = turno.catch(() => {});
      return turno;
    },
    tx(fn) {
      return db.exclusivo(async () => {
        const est = als.getStore();
        const nombre = `sp${++sp}`;
        const raiz = est.prof === 0;
        crudo.exec(raiz ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${nombre}`);
        est.prof++;
        try {
          const r = await fn();
          est.prof--;
          crudo.exec(raiz ? 'COMMIT' : `RELEASE ${nombre}`);
          return r;
        } catch (e) {
          est.prof--;
          try { crudo.exec(raiz ? 'ROLLBACK' : `ROLLBACK TO ${nombre}; RELEASE ${nombre}`); } catch {}
          throw e;
        }
      });
    },
    close() { try { crudo.close(); } catch {} },
  };
  return db;
}

/* ---------------- PostgreSQL ---------------- */
// Tablas con columna id autonumérica: sus INSERT devuelven el id creado.
const CON_ID = new Set(['tiendas', 'usuarios', 'plantillas', 'dias_especiales', 'turnos', 'marcas', 'multas', 'justificaciones', 'coberturas', 'auditoria']);

/** Traduce los marcadores "?" a $1, $2… (respetando textos entre comillas) y agrega RETURNING id. */
export function aPostgres(sql) {
  let n = 0, out = '', enTexto = false;
  for (const c of sql) {
    if (c === "'") enTexto = !enTexto;
    out += c === '?' && !enTexto ? `$${++n}` : c;
  }
  const ins = out.match(/^\s*INSERT\s+INTO\s+([a-z_]+)/i);
  if (ins && CON_ID.has(ins[1].toLowerCase()) && !/\bRETURNING\b/i.test(out)) out += ' RETURNING id';
  return out;
}

/**
 * @param {object} fuente
 *   - consultar(texto, params, cliente?) → Promise<{rows, rowCount}>
 *   - ejecutarVarias(texto, cliente?) → Promise   (varias sentencias, sin parámetros)
 *   - transaccion(fn(cliente)) → Promise   (abre y cierra una transacción en una conexión dedicada)
 */
export function motorPostgres(fuente) {
  const als = new AsyncLocalStorage();
  const cache = new Map();
  const texto = (sql) => { let t = cache.get(sql); if (!t) { t = aPostgres(sql); cache.set(sql, t); } return t; };
  const q = (sql, p) => fuente.consultar(texto(sql), norm(p), als.getStore()?.cliente);
  let sp = 0;
  const db = {
    tipo: 'postgres',
    prepare(sql) {
      return {
        get: async (...p) => (await q(sql, p)).rows[0],
        all: async (...p) => (await q(sql, p)).rows,
        run: async (...p) => { const r = await q(sql, p); return { changes: r.rowCount ?? 0, lastInsertRowid: r.rows?.[0]?.id ?? null }; },
      };
    },
    async exec(sql) { await fuente.ejecutarVarias(sql, als.getStore()?.cliente); },
    async bloquearFila(tabla, id) { if (als.getStore()?.cliente) await q(`SELECT id FROM ${ident(tabla)} WHERE id = ? FOR UPDATE`, [id]); },
    exclusivo: (fn) => fn(),
    async tx(fn) {
      const est = als.getStore();
      if (est?.cliente) {
        const nombre = `sp${++sp}`;
        await fuente.consultar(`SAVEPOINT ${nombre}`, [], est.cliente);
        try { const r = await fn(); await fuente.consultar(`RELEASE SAVEPOINT ${nombre}`, [], est.cliente); return r; } catch (e) {
          try { await fuente.consultar(`ROLLBACK TO SAVEPOINT ${nombre}`, [], est.cliente); } catch {}
          throw e;
        }
      }
      return fuente.transaccion((cliente) => als.run({ cliente }, fn));
    },
    close: () => fuente.cerrar?.(),
  };
  return db;
}

/** Envuelve un Pool compatible con node-postgres (pg o @neondatabase/serverless). */
function fuenteDePool(pool) {
  pool.on('error', (e) => console.error('Error de conexión PostgreSQL:', e.message));
  return {
    consultar: (t, p, c) => (c || pool).query(t, p),
    ejecutarVarias: (t, c) => (c || pool).query(t),
    async transaccion(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) {
        try { await c.query('ROLLBACK'); } catch {}
        throw e;
      } finally { c.release(); }
    },
    cerrar: () => pool.end(),
  };
}

/** Conexión a Neon / Netlify DB desde funciones serverless (WebSocket con pool; transacciones interactivas). */
export async function fuenteNeon(url, { max = 3 } = {}) {
  const { Pool, types, neonConfig } = await import('@neondatabase/serverless');
  types.setTypeParser(20, (v) => Number(v)); // BIGINT → número (ms y conteos)
  types.setTypeParser(1700, (v) => parseFloat(v)); // NUMERIC (SUM, montos) → número
  if (typeof WebSocket !== 'undefined') neonConfig.webSocketConstructor = WebSocket;
  return fuenteDePool(new Pool({ connectionString: url, max, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 }));
}

/** Conexión TCP clásica (servidor Node propio: Render, VPS, Docker, Neon, Supabase, RDS…). */
export async function fuenteTcp(url, { max = Number(process.env.DB_POOL_MAX) || 20 } = {}) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(20, (v) => Number(v));
  pg.types.setTypeParser(1700, (v) => parseFloat(v));
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) || /sslmode=disable/.test(url);
  return fuenteDePool(new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000, ssl: local ? false : undefined }));
}

/** PostgreSQL en memoria (PGlite): para pruebas automáticas del dialecto PostgreSQL. */
export async function fuentePglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite({ parsers: { 20: (v) => Number(v), 1700: (v) => parseFloat(v) } });
  await pg.waitReady;
  const res = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  return {
    consultar: async (t, p, c) => res(await (c || pg).query(t, p)),
    ejecutarVarias: (t, c) => (c || pg).exec(t),
    transaccion: (fn) => pg.transaction((tx) => fn(tx)),
    cerrar: () => pg.close(),
  };
}

/** Postgres si hay DATABASE_URL / NETLIFY_DATABASE_URL; si no, null. */
export const urlPostgres = (env = process.env) => env.DATABASE_URL || env.NETLIFY_DATABASE_URL || '';
