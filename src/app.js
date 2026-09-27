import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { rutasAuth } from './routes/auth.js';
import { rutasApp } from './routes/app.js';
import { rutasPanel } from './routes/panel.js';
import { manejarErrores, soloJson } from './middleware.js';
import { aplicarMarca } from './marcas.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function crearApp(ctx) {
  const app = express();
  app.disable('x-powered-by');
  if (ctx.cfg.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: ctx.cfg.produccion ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    // La geolocalización debe estar permitida para esta página.
    permissionsPolicy: undefined,
  }));
  app.use((req, res, next) => { res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()'); next(); });
  app.use(compression({ filter: (req, res) => !req.path.endsWith('/stream') && compression.filter(req, res) }));
  app.use(express.json({ limit: '25mb' }));

  app.get('/salud', (req, res) => {
    try { ctx.db.prepare('SELECT 1').get(); res.json({ ok: true, ahora: ctx.reloj.ahora() }); } catch { res.status(503).json({ ok: false }); }
  });

  const api = express.Router();
  api.use(soloJson);
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(rutasAuth(ctx));
  api.use('/app', rutasApp(ctx));
  api.use('/panel', rutasPanel(ctx));
  api.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));
  app.use('/api', api);

  const publico = path.join(RAIZ, 'public');
  // Lógica de dominio compartida con el navegador (fechas, geocerca y evaluación): una sola fuente de verdad.
  const COMPARTIDOS = new Set(['tiempo.js', 'geo.js', 'asistencia.js', 'horarios.js']);
  app.get('/shared/:archivo', (req, res, next) => (COMPARTIDOS.has(req.params.archivo)
    ? res.type('application/javascript').set('Cache-Control', 'no-cache').sendFile(path.join(RAIZ, 'src', 'domain', req.params.archivo))
    : next()));
  // Marca: sus archivos (logo, íconos, css/marca.css) reemplazan a los predeterminados
  const dirMarca = path.join(RAIZ, 'marcas', ctx.cfg.marca.id, 'publico');
  const plantilla = (archivo, tipo) => (req, res) => {
    const propio = path.join(dirMarca, archivo);
    const f = fs.existsSync(propio) ? propio : path.join(publico, archivo);
    res.type(tipo).set('Cache-Control', 'no-cache').send(aplicarMarca(fs.readFileSync(f, 'utf8'), ctx.cfg.marca));
  };
  app.get(['/', '/index.html'], plantilla('index.html', 'html'));
  app.get(['/panel', '/panel.html', '/panel/*resto'], plantilla('panel.html', 'html'));
  app.get('/manifest.webmanifest', plantilla('manifest.webmanifest', 'application/manifest+json'));
  if (fs.existsSync(dirMarca)) app.use(express.static(dirMarca, { maxAge: ctx.cfg.produccion ? '1h' : 0, index: false }));

  app.use('/vendor/leaflet', express.static(path.dirname(require.resolve('leaflet/dist/leaflet.js')), { maxAge: '30d', immutable: true }));
  app.use(express.static(publico, {
    index: false,
    maxAge: ctx.cfg.produccion ? '1h' : 0,
    setHeaders: (res, archivo) => { if (archivo.endsWith('sw.js') || archivo.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.use(manejarErrores(ctx));
  return app;
}
