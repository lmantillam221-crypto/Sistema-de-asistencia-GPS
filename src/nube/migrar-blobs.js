/* Migración única: copia la base anterior (archivo SQLite guardado en Netlify Blobs) a PostgreSQL.
   Se ejecuta sola la primera vez que el sistema arranca con PostgreSQL vacío. */
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { setSQL, DatabaseSync } from '../lib/sqljs.js';
import { motorSqlite } from '../db/motor.js';
import { migrar, transaccion } from '../db/index.js';
import { volcar, cargar } from '../lib/respaldo.js';

let sqlListo = null;

/** @returns {Promise<number>} filas copiadas (0 si no había nada que migrar) */
export async function migrarDesdeSqlite(dbPg, bytes, migracionesSqlite) {
  if (!bytes?.length) return 0;
  sqlListo ||= initSqlJs().then(setSQL);
  await sqlListo;
  const origen = motorSqlite(new DatabaseSync(bytes));
  await migrar(origen, migracionesSqlite); // lleva la base anterior al último esquema
  const datos = await volcar(origen);
  let filas = 0;
  await transaccion(dbPg, async () => {
    await dbPg.exec('SELECT pg_advisory_xact_lock(725003)'); // una sola instancia migra
    if ((await dbPg.prepare('SELECT COUNT(*) AS n FROM empresa').get()).n > 0) return; // otra ya lo hizo
    filas = await cargar(dbPg, datos);
  });
  return filas;
}
