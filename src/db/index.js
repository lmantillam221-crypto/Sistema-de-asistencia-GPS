import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR_MIGRACIONES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Migraciones en disco para el motor indicado (servidor Node). En Netlify y la demo se pasan ya cargadas. */
export const migracionesEnDisco = (tipo = 'sqlite') => {
  const dir = path.join(DIR_MIGRACIONES, tipo);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((nombre) => ({ nombre, sql: fs.readFileSync(path.join(dir, nombre), 'utf8') }));
};

/** Aplica las migraciones pendientes. En PostgreSQL usa un candado para que dos instancias no migren a la vez. */
export async function migrar(db, lista = migracionesEnDisco(db.tipo)) {
  await db.exec('CREATE TABLE IF NOT EXISTS _migraciones (nombre TEXT PRIMARY KEY, aplicada BIGINT NOT NULL)');
  const pendientes = async () => {
    const hechas = new Set((await db.prepare('SELECT nombre FROM _migraciones').all()).map((r) => r.nombre));
    return lista.filter((m) => !hechas.has(m.nombre));
  };
  if (!(await pendientes()).length) return;
  await db.tx(async () => {
    if (db.tipo === 'postgres') await db.exec('SELECT pg_advisory_xact_lock(725001)');
    for (const { nombre, sql } of await pendientes()) {
      await db.exec(sql);
      await db.prepare('INSERT INTO _migraciones (nombre, aplicada) VALUES (?, ?)').run(nombre, Date.now());
    }
  });
}

/** Ejecuta fn (async) dentro de una transacción; anidable. */
export const transaccion = (db, fn) => db.tx(fn);

export const fila = (r) => (r ? { ...r } : null);
export const filas = (rs) => rs.map((r) => ({ ...r }));

/** Error de restricción única (duplicado) en cualquiera de los dos motores. */
export const esDuplicado = (e) => e?.code === '23505' || /UNIQUE constraint failed/i.test(e?.message || '');
