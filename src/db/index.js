import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const DIR_MIGRACIONES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Abre la base SQLite, aplica PRAGMAs de producción y ejecuta migraciones pendientes. */
export function abrirDB(archivo) {
  if (archivo !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(archivo)), { recursive: true });
  const db = new DatabaseSync(archivo);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;`);
  migrar(db);
  return db;
}

export function migrar(db) {
  db.exec('CREATE TABLE IF NOT EXISTS _migraciones (nombre TEXT PRIMARY KEY, aplicada INTEGER NOT NULL)');
  const hechas = new Set(db.prepare('SELECT nombre FROM _migraciones').all().map((r) => r.nombre));
  const archivos = fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
  for (const f of archivos) {
    if (hechas.has(f)) continue;
    const sql = fs.readFileSync(path.join(DIR_MIGRACIONES, f), 'utf8');
    transaccion(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO _migraciones (nombre, aplicada) VALUES (?, ?)').run(f, Date.now());
    });
  }
}

/** Ejecuta fn dentro de una transacción (anidable mediante SAVEPOINT). */
let profundidad = 0;
export function transaccion(db, fn) {
  const sp = `sp${profundidad}`;
  db.exec(profundidad === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  profundidad++;
  try {
    const r = fn();
    profundidad--;
    db.exec(profundidad === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    profundidad--;
    try { db.exec(profundidad === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`); } catch {}
    throw e;
  }
}

/** Convierte filas de node:sqlite (prototipo nulo) en objetos normales. */
export const fila = (r) => (r ? { ...r } : null);
export const filas = (rs) => rs.map((r) => ({ ...r }));
