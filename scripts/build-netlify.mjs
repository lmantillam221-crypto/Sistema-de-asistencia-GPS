/* Prepara el sitio para Netlify:
   dist/netlify/sitio      → archivos públicos (app del equipo, panel, lógica compartida y Leaflet)
   dist/netlify/funciones  → funciones "api" y "tareas" ya empaquetadas (PostgreSQL + lógica del sistema)
   Marca: variable MARCA (nube-chic por defecto, mundo-nuvana…).
   Uso: npm run build:netlify  (Netlify lo ejecuta solo según netlify.toml) */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { marcaPorId, aplicarMarca } from '../src/marcas.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const DIST = path.join(RAIZ, 'dist/netlify');
const SITIO = path.join(DIST, 'sitio');
const marca = marcaPorId(process.env.MARCA);
fs.rmSync(DIST, { recursive: true, force: true });

// 1. Sitio estático
fs.cpSync(path.join(RAIZ, 'public'), SITIO, { recursive: true });
const dirMarca = path.join(RAIZ, 'marcas', marca.id, 'publico');
if (fs.existsSync(dirMarca)) fs.cpSync(dirMarca, SITIO, { recursive: true }); // logo, íconos y tema de la marca
for (const f of ['index.html', 'panel.html', 'manifest.webmanifest']) fs.writeFileSync(path.join(SITIO, f), aplicarMarca(fs.readFileSync(path.join(SITIO, f), 'utf8'), marca));
fs.mkdirSync(path.join(SITIO, 'shared'), { recursive: true });
for (const f of ['tiempo.js', 'geo.js', 'asistencia.js', 'horarios.js']) fs.copyFileSync(path.join(RAIZ, 'src/domain', f), path.join(SITIO, 'shared', f));
fs.cpSync(path.dirname(require.resolve('leaflet/dist/leaflet.js')), path.join(SITIO, 'vendor/leaflet'), { recursive: true });

// 2. Función (un solo archivo con todo lo necesario)
for (const f of ['api', 'tareas']) await empaquetarFuncion(path.join(RAIZ, `netlify/functions/${f}.mjs`), path.join(DIST, `funciones/${f}.mjs`), marca.id);
console.log(`✔ Listo para Netlify (${marca.nombre}): dist/netlify/sitio + dist/netlify/funciones/{api,tareas}.mjs`);

export async function empaquetarFuncion(entrada, salida, marcaId = 'nube-chic') {
  await build({
    entryPoints: [entrada], outfile: salida, bundle: true, platform: 'node', format: 'esm', target: 'node20',
    loader: { '.sql': 'text' }, legalComments: 'none', logLevel: 'warning', minify: true, keepNames: true,
    define: { __MARCA__: JSON.stringify(marcaId) },
    // sql.js usa require() de módulos de Node dentro de un paquete ESM
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
}
