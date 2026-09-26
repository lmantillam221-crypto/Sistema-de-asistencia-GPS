import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR_MIGRACIONES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Migraciones en disco (servidor Node). En Netlify y la demo se pasan ya cargadas. */
export const migracionesEnDisco = () => fs.readdirSync(DIR_MIGRACIONES).filter((f) => f.endsWith('.sql')).sort()
  .map((nombre) => ({ nombre, sql: fs.readFileSync(path.join(DIR_MIGRACIONES, nombre), 'utf8') }));

export function migrar(db, lista = migracionesEnDisco()) {
  db.exec('CREATE TABLE IF NOT EXISTS _migraciones (nombre TEXT PRIMARY KEY, aplicada INTEGER NOT NULL)');
  const hechas = new Set(db.prepare('SELECT nombre FROM _migraciones').all().map((r) => r.nombre));
  for (const { nombre: f, sql } of lista) {
    if (hechas.has(f)) continue;
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
