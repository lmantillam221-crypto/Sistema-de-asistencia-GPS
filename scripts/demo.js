/* Levanta una base de demostración con tienda, equipo y 3 semanas de datos de ejemplo.
   Uso: npm run demo   (luego: DEMO_MODE=1 npm start) */
import { leerConfig } from '../src/config.js';
import { crearContexto } from '../src/services/index.js';
import { asegurarBaseDemo, generarEjemplo } from '../src/lib/demo.js';

const ctx = crearContexto({ ...leerConfig(), demo: true });
asegurarBaseDemo(ctx);
console.log(`✔ Datos de ejemplo: ${generarEjemplo(ctx)} marcas GPS.`);
console.log('  App: V01 / 1111 … V08 / 8888   ·   Panel: supervisor / supervisor2026');
if (ctx.adminInicial?.generado) console.log(`  Administrador → ${ctx.adminInicial.codigo} / ${ctx.adminInicial.password}`);
