/* Volcado y carga de todas las tablas: copias de seguridad (JSON) y migración entre motores
   (p. ej. de la base anterior en Netlify Blobs a PostgreSQL). */
import { transaccion } from '../db/index.js';

// Orden que respeta las claves foráneas
export const TABLAS = ['empresa', 'tiendas', 'usuarios', 'sesiones', 'plantillas', 'dias_especiales', 'dias_generados', 'turnos',
  'marcas', 'reportes_turno', 'multas', 'justificaciones', 'coberturas', 'avisos', 'auditoria'];
const CON_ID = new Set(['tiendas', 'usuarios', 'plantillas', 'dias_especiales', 'turnos', 'marcas', 'multas', 'justificaciones', 'coberturas', 'auditoria']);

/** Lee todas las tablas. */
export async function volcar(db) {
  const tablas = {};
  for (const t of TABLAS) tablas[t] = await db.prepare(`SELECT * FROM ${t}`).all();
  return { app: 'asistencia', formato: 1, creado: new Date().toISOString(), motor: db.tipo, tablas };
}

/** Carga un volcado en una base VACÍA (mismas columnas, mismos ids) y ajusta los contadores de ids. */
export async function cargar(db, volcado) {
  let filas = 0;
  await transaccion(db, async () => {
    for (const t of TABLAS) {
      const lista = volcado.tablas?.[t] || [];
      if (!lista.length) continue;
      const cols = Object.keys(lista[0]);
      const LOTE = Math.max(1, Math.floor(900 / cols.length));
      for (let i = 0; i < lista.length; i += LOTE) {
        const parte = lista.slice(i, i + LOTE);
        const ph = parte.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
        await db.prepare(`INSERT INTO ${t} (${cols.join(', ')}) VALUES ${ph} ON CONFLICT DO NOTHING`).run(...parte.flatMap((f) => cols.map((c) => f[c])));
        filas += parte.length;
      }
      if (db.tipo === 'postgres' && CON_ID.has(t)) {
        await db.exec(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
      }
    }
  });
  return filas;
}
