/* Importa los datos del sistema anterior (index.html o copia .json).
   Uso: npm run importar -- ruta/al/index.html */
import fs from 'node:fs';
import { leerConfig } from '../src/config.js';
import { crearContexto } from '../src/services/index.js';
import { leerFuenteAnterior, importarAnterior } from '../src/lib/importar.js';

const archivo = process.argv[2];
if (!archivo) { console.error('Uso: npm run importar -- <index.html | copia.json>'); process.exit(1); }
const ctx = crearContexto(leerConfig());
const r = importarAnterior(ctx, leerFuenteAnterior(fs.readFileSync(archivo, 'utf8')));
console.log('✔ Importación terminada:', r);
if (ctx.adminInicial?.generado) console.log(`  Administrador inicial → usuario: ${ctx.adminInicial.codigo}  contraseña: ${ctx.adminInicial.password}`);
