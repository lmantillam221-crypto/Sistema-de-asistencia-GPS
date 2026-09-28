import { ErrorApp } from './lib/errores.js';
import { esDuplicado } from './db/index.js';

export const COOKIE_APP = 'nc_app', COOKIE_PANEL = 'nc_panel';

export function leerCookies(req) {
  const out = {};
  for (const p of String(req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return out;
}

export function ponerCookie(res, nombre, valor, { dias = 30, seguro = false } = {}) {
  const partes = [`${nombre}=${encodeURIComponent(valor)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${valor ? Math.round(dias * 86400) : 0}`];
  if (seguro) partes.push('Secure');
  res.append('Set-Cookie', partes.join('; '));
}

/** Protección CSRF: toda petición que modifica datos debe ser JSON (los formularios de otros sitios no pueden enviarlo). */
export function soloJson(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return next(new ErrorApp(415, 'Las peticiones deben enviarse como JSON.'));
  }
  next();
}

/** Autenticación por cookie de sesión. */
export function autenticar(ctx, cookie, roles = null) {
  return (req, res, next) => {
    ctx.s.usuarios.sesion(leerCookies(req)[cookie]).then((u) => {
      if (!u) return next(new ErrorApp(401, 'Tu sesión terminó. Vuelve a ingresar.', { codigo: 'SESION' }));
      if (roles && !roles.includes(u.rol)) return next(new ErrorApp(403, 'No tienes permiso para esto.'));
      req.usuario = u;
      next();
    }, next);
  };
}

/**
 * Prepara cada petición: lee las reglas vigentes de la empresa (todas las instancias ven los mismos
 * cambios al instante) y, con SQLite, atiende las peticiones de a una para que nunca se mezclen.
 * El canal de tiempo real (/stream) queda fuera porque permanece abierto.
 */
export function porPeticion(ctx) {
  return (req, res, next) => {
    if (req.path.endsWith('/stream')) return ctx.s.empresa.refrescar().then(() => next(), next);
    ctx.db.exclusivo(() => new Promise((listo) => {
      let hecho = false;
      const fin = () => { if (!hecho) { hecho = true; clearTimeout(t); listo(); } };
      const t = setTimeout(fin, 30000); // nunca retener la base más de 30 s
      res.on('finish', fin);
      res.on('close', fin);
      ctx.s.empresa.refrescar().then(() => next(), (e) => { next(e); });
    })).catch(() => {});
  };
}

export const soloRoles = (...roles) => (req, res, next) => (roles.includes(req.usuario?.rol) ? next() : next(new ErrorApp(403, 'Solo un administrador puede hacer esto.')));

/**
 * Límite de intentos fallidos por IP (en memoria). Solo cuentan los fallos: muchas personas
 * pueden compartir la misma IP (wifi de la tienda o la red móvil del operador) e ingresar sin problema.
 * Cada cuenta, además, se bloquea sola tras varios intentos fallidos.
 */
export function limitador({ ventanaMs = 10 * 60000, max = 60 } = {}) {
  const mapa = new Map();
  setInterval(() => { const ahora = Date.now(); for (const [k, v] of mapa) if (v.hasta < ahora) mapa.delete(k); }, ventanaMs).unref();
  return (req, res, next) => {
    const k = req.ip, ahora = Date.now();
    let v = mapa.get(k);
    if (!v || v.hasta < ahora) { v = { n: 0, hasta: ahora + ventanaMs }; mapa.set(k, v); }
    if (v.n >= max) return next(new ErrorApp(429, 'Demasiados intentos fallidos desde esta conexión. Espera unos minutos.'));
    res.on('finish', () => { if (res.statusCode === 401 || res.statusCode === 400) v.n++; });
    next();
  };
}

export function manejarErrores(ctx) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    if (err.type === 'entity.parse.failed') status = 400;
    if (esDuplicado(err)) { status = 409; err = Object.assign(new Error('Ese registro ya existe o acaba de ser creado por otra persona. Actualiza e inténtalo de nuevo.'), { status }); }
    if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    res.status(status).json({
      error: status >= 500 && ctx.cfg.produccion ? 'Ocurrió un error inesperado. Inténtalo de nuevo.' : err.message || 'Error',
      codigo: err.codigo, detalles: err.detalles,
    });
  };
}

/** Envuelve handlers para que los errores lleguen al manejador. */
export const h = (fn) => (req, res, next) => { try { const r = fn(req, res, next); if (r?.catch) r.catch(next); } catch (e) { next(e); } };
