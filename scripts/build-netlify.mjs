/* Prepara el sitio para Netlify:
   dist/netlify/sitio      → archivos públicos (app del equipo, panel, lógica compartida y Leaflet)
   dist/netlify/funciones  → función "api" ya empaquetada (incluye sql.js y la lógica del sistema)
   Uso: npm run build:netlify  (Netlify lo ejecuta solo según netlify.toml) */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const DIST = path.join(RAIZ, 'dist/netlify');
const SITIO = path.join(DIST, 'sitio');
fs.rmSync(DIST, { recursive: true, force: true });

// 1. Sitio estático
fs.cpSync(path.join(RAIZ, 'public'), SITIO, { recursive: true });
fs.mkdirSync(path.join(SITIO, 'shared'), { recursive: true });
for (const f of ['tiempo.js', 'geo.js', 'asistencia.js', 'horarios.js']) fs.copyFileSync(path.join(RAIZ, 'src/domain', f), path.join(SITIO, 'shared', f));
fs.cpSync(path.dirname(require.resolve('leaflet/dist/leaflet.js')), path.join(SITIO, 'vendor/leaflet'), { recursive: true });

// 2. Función (un solo archivo con todo lo necesario)
await empaquetarFuncion(path.join(RAIZ, 'netlify/functions/api.mjs'), path.join(DIST, 'funciones/api.mjs'));
console.log('✔ Listo para Netlify: dist/netlify/sitio + dist/netlify/funciones/api.mjs');

export async function empaquetarFuncion(entrada, salida) {
  await build({
    entryPoints: [entrada], outfile: salida, bundle: true, platform: 'node', format: 'esm', target: 'node20',
    loader: { '.sql': 'text' }, legalComments: 'none', logLevel: 'warning', minify: true, keepNames: true,
    // sql.js usa require() de módulos de Node dentro de un paquete ESM
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
}
