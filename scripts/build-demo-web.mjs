/* Genera dist/demo-web/index.html: una sola página con la API, la base (sql.js) y las dos interfaces,
   para probar el sistema en cualquier navegador sin instalar nada. Uso: npm run build:demo-web */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { marcaPorId } from '../src/marcas.js';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);
const S = (p) => path.join(RAIZ, 'demo-web', 'shims', p);
const leer = (p) => fs.readFileSync(p, 'utf8');
const marca = marcaPorId(process.env.MARCA);
const dirMarca = path.join(RAIZ, 'marcas', marca.id, 'publico');
const deMarca = (rel) => (fs.existsSync(path.join(dirMarca, rel)) ? path.join(dirMarca, rel) : path.join(RAIZ, 'public', rel));
const logo = 'data:image/webp;base64,' + fs.readFileSync(deMarca('assets/logo.webp')).toString('base64');

const ALIAS = {
  'node:sqlite': S('sqlite.js'), 'node:fs': S('fs.js'), fs: S('vacio.js'), 'node:path': S('path.js'), path: S('vacio.js'),
  'node:os': S('varios.js'), 'node:url': S('varios.js'), 'node:events': S('events.js'), 'node:crypto': S('vacio.js'), crypto: S('vacio.js'),
  express: S('express.js'),
};
// Ajustes solo para la demo (el código real no cambia)
const PARCHES = {
  'public/js/colaborador/gps.js': [["LS.get('nc_sim') || 'real'", "LS.get('nc_sim') || 'dentro'"]],
  'public/js/colaborador/main.js': [['href="/panel"', 'href="#panel"'], ["navigator.serviceWorker.register('/sw.js')", 'Promise.resolve()']],
  'public/js/panel/main.js': [['href="/"', 'href="#app"'], ['usuario <b>supervisor</b>, contraseña <b>supervisor2026</b>.', 'usuario <b>admin</b>, contraseña <b>admin12345</b> (o supervisor / supervisor2026).']],
};

const plugin = {
  name: 'demo',
  setup(b) {
    b.onResolve({ filter: /^\/shared\/.+\.js$/ }, (a) => ({ path: path.join(RAIZ, 'src/domain', path.basename(a.path)) }));
    b.onResolve({ filter: /lib\/seguridad\.js$/ }, () => ({ path: S('seguridad.js') }));
    b.onResolve({ filter: /^(node:[a-z]+|fs|path|crypto|express)$/ }, (a) => (ALIAS[a.path] ? { path: ALIAS[a.path] } : undefined));
    b.onLoad({ filter: /public\/js\/.*\.js$/ }, (a) => {
      let t = leer(a.path);
      for (const [x, y] of PARCHES[path.relative(RAIZ, a.path)] || []) { if (!t.includes(x)) throw new Error(`Parche no aplicado en ${a.path}: ${x}`); t = t.split(x).join(y); }
      return { contents: t.split('/assets/logo.webp').join(logo), loader: 'js' };
    });
  },
};

const r = await build({
  entryPoints: [path.join(RAIZ, 'demo-web/entrada.js')], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  minify: true, legalComments: 'none', loader: { '.sql': 'text' }, define: { 'process.env': JSON.stringify({ MARCA: marca.id }), 'process.env.NODE_ENV': '"production"' }, plugins: [plugin], logLevel: 'warning',
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const leafletDir = path.dirname(require.resolve('leaflet/dist/leaflet.js'));
const css = (p) => leer(path.join(RAIZ, p)).replace(/<\/style/gi, '');
let html = leer(path.join(RAIZ, 'demo-web/pagina.html'));
const reemplazos = {
  '/*LEAFLET_CSS*/': leer(path.join(leafletDir, 'leaflet.css')).replace(/url\(images\/[^)]+\)/g, 'none'),
  '/*MARCA_CSS*/': leer(deMarca('css/marca.css')).replace(/<\/style/gi, ''),
  '/*APP_CSS*/': css('public/css/app.css'), '/*MOVIL_CSS*/': css('public/css/movil.css'), '/*PANEL_CSS*/': css('public/css/panel.css'),
  '/*LEAFLET_JS*/': leer(path.join(leafletDir, 'leaflet.js')).replace(/<\/script/gi, '<\\/script'),
  '/*BUNDLE*/': js + '\ndocument.getElementById("arranque")?.remove();',
};
for (const [k, v] of Object.entries(reemplazos)) html = html.split(k).join(v);
html = html.split('{{MARCA_APP}}').join(marca.nombreApp).split('{{MARCA_NOMBRE}}').join(marca.nombre);
const salida = path.join(RAIZ, 'dist/demo-web', marca.id === 'nube-chic' ? 'index.html' : `${marca.id}.html`);
fs.mkdirSync(path.dirname(salida), { recursive: true });
fs.writeFileSync(salida, html);
console.log(`✔ ${path.relative(RAIZ, salida)} (${(html.length / 1048576).toFixed(2)} MB)`);
