/* Importa los datos del sistema anterior (index.html o copia .json).
   Uso: npm run importar -- ruta/al/index.html */
import fs from 'node:fs';
import { leerConfig } from '../src/config.js';
import { crearContexto } from '../src/services/index.js';
import { abrirDB } from '../src/db/abrir.js';
import { leerFuenteAnterior, importarAnterior } from '../src/lib/importar.js';

const archivo = process.argv[2];
if (!archivo) { console.error('Uso: npm run importar -- <index.html | copia.json>'); process.exit(1); }
const cfg = leerConfig();
const ctx = crearContexto(cfg, { db: abrirDB(cfg.dbPath) });
const r = importarAnterior(ctx, leerFuenteAnterior(fs.readFileSync(archivo, 'utf8')));
console.log('✔ Importación terminada:', r);
