/* Copia de seguridad en caliente de la base de datos (segura aunque el servidor esté funcionando).
   Uso: npm run respaldo [-- carpeta]   ·   Programable con cron: 0 23 * * * cd /app && npm run respaldo */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { leerConfig } from '../src/config.js';

const cfg = leerConfig();
const dir = path.resolve(process.argv[2] || 'respaldos');
fs.mkdirSync(dir, { recursive: true });
const destino = path.join(dir, `asistencia-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.db`);
const db = new DatabaseSync(cfg.dbPath);
db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
db.close();
// Conserva los últimos 30 respaldos
const viejos = fs.readdirSync(dir).filter((f) => f.startsWith('asistencia-') && f.endsWith('.db')).sort().slice(0, -30);
for (const f of viejos) fs.rmSync(path.join(dir, f));
console.log(`✔ Respaldo creado: ${destino}`);
