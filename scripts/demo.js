/* Levanta una base de demostración con tienda, equipo y 3 semanas de datos de ejemplo.
   Uso: npm run demo   (luego: DEMO_MODE=1 npm start) */
import { leerConfig } from '../src/config.js';
import { crearContexto } from '../src/services/index.js';
import { abrirDB } from '../src/db/abrir.js';
import { asegurarBaseDemo, generarEjemplo } from '../src/lib/demo.js';

const cfg = { ...leerConfig(), demo: true };
const ctx = crearContexto(cfg, { db: abrirDB(cfg.dbPath) });
asegurarBaseDemo(ctx);
console.log(`✔ Datos de ejemplo: ${generarEjemplo(ctx)} marcas GPS.`);
console.log('  App: V01 / 1111 … V08 / 8888   ·   Panel: supervisor / supervisor2026');
