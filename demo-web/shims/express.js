/* Enrutador compatible con la parte de Express que usa el sistema (para correr la API dentro del navegador). */
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
        const seguir = (e) => { req.path = antes; next(e); };
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
export default { Router };
