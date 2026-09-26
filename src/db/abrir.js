import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrar } from './index.js';

/** Abre la base SQLite en disco (servidor Node), aplica PRAGMAs de producción y migraciones pendientes. */
export function abrirDB(archivo) {
  if (archivo !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(archivo)), { recursive: true });
  const db = new DatabaseSync(archivo);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  migrar(db);
  return db;
}
