import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrar } from './index.js';
import { motorSqlite, motorPostgres, fuenteTcp, urlPostgres } from './motor.js';

/**
 * Abre la base del servidor Node:
 * - PostgreSQL si hay DATABASE_URL (recomendado para muchos usuarios y varios años de datos)
 * - si no, SQLite en disco (WAL), ideal para una o pocas tiendas en un solo servidor.
 */
export async function abrirDB(archivo, env = process.env) {
  const url = urlPostgres(env);
  const db = url ? motorPostgres(await fuenteTcp(url)) : abrirSqlite(archivo);
  await migrar(db);
  return db;
}

export function abrirSqlite(archivo) {
  if (archivo !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(archivo)), { recursive: true });
  const crudo = new DatabaseSync(archivo);
  crudo.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  return motorSqlite(crudo);
}
