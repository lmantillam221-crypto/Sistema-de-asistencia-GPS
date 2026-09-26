/* Enrutador mínimo compatible con Express (get/post/put/delete/use, :params).
   Funciona igual dentro de Express (servidor Node), en funciones de Netlify y en la demo del navegador. */
const patron = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\/:(\w+)/g, '/(?<$1>[^/]+)') + '/?$');

export function Router() {
  const pila = [];
  const r = (req, res, fin) => {
    let i = 0;
    const next = (err) => {
      const capa = pila[i++];
      if (!capa) return fin(err);
      if (capa.uso) {
        if (capa.prefijo && !(req.path === capa.prefijo || req.path.startsWith(capa.prefijo + '/'))) return next(err);
        const esError = capa.fn.length === 4;
        if (!!err !== esError) return next(err);
        const antes = req.path;
        if (capa.prefijo) req.path = req.path.slice(capa.prefijo.length) || '/';
        const seguir = (e) => { if (capa.prefijo) req.path = antes; next(e); };
        try { return esError ? capa.fn(err, req, res, seguir) : capa.fn(req, res, seguir); } catch (e) { return seguir(e); }
      }
      if (err || capa.metodo !== req.method) return next(err);
      const m = req.path.match(capa.re);
      if (!m) return next();
      req.params = { ...(m.groups || {}) };
      let j = 0;
      const paso = (e) => { if (e) return next(e); const fn = capa.fns[j++]; if (!fn) return next(); try { fn(req, res, paso); } catch (x) { next(x); } };
      paso();
    };
    next();
  };
  r.use = (...a) => { const prefijo = typeof a[0] === 'string' ? a.shift() : ''; for (const fn of a) pila.push({ uso: true, prefijo, fn }); return r; };
  for (const m of ['get', 'post', 'put', 'delete']) r[m] = (ruta, ...fns) => { pila.push({ metodo: m.toUpperCase(), re: patron(ruta), fns }); return r; };
  return r;
}

/**
 * Atiende una petición sin servidor HTTP (Netlify / navegador).
 * @returns {Promise<{status:number, headers:Record<string,string>, cookies:string[], body:any}>}
 */
export function despachar(api, alFallar, { method, url, headers = {}, body = {}, ip = '' }) {
  const u = new URL(url, 'http://local');
  const req = {
    method, path: u.pathname.replace(/^\/api/, '') || '/', originalUrl: u.pathname, ip, secure: true,
    query: Object.fromEntries(u.searchParams), params: {}, body, headers,
    get(h) { return this.headers[String(h).toLowerCase()]; },
    is(t) { return (this.headers['content-type'] || '').includes(t.split('/').pop()); },
    on() {},
  };
  return new Promise((ok) => {
    const res = {
      statusCode: 200, h: { 'content-type': 'application/json; charset=utf-8' }, cookies: [],
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { this.h[k.toLowerCase()] = String(v); return this; },
      set(k, v) { return this.setHeader(k, v); },
      append(k, v) { if (k.toLowerCase() === 'set-cookie') this.cookies.push(v); else this.setHeader(k, v); return this; },
      type(t) { this.h['content-type'] = t; return this; },
      json(o) { this.h['content-type'] = 'application/json; charset=utf-8'; this.send(JSON.stringify(o)); },
      send(b) { ok({ status: this.statusCode, headers: this.h, cookies: this.cookies, body: b }); },
      end(b) { this.send(b ?? ''); },
      download() { this.status(501).json({ error: 'Descarga no disponible aquí.' }); },
      writeHead() { return this; }, write() {},
    };
    const fin = (err) => (err ? alFallar(err, req, res, () => {}) : res.status(404).json({ error: 'Ruta no encontrada.' }));
    try { api(req, res, fin); } catch (e) { fin(e); }
  });
}
