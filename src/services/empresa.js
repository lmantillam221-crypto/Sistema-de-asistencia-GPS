import { esquemaAjustes, normalizarAjustes } from '../domain/ajustes.js';
import { validar } from '../lib/errores.js';

/* Datos de la empresa y reglas del negocio. Se leen una vez por petición (refrescar) y luego
   se consultan de forma síncrona con obtener()/ajustes() durante esa petición. */
export function servicioEmpresa(ctx) {
  const { db } = ctx;
  let cache = null;
  const convertir = (r) => { if (!r) return null; const { config, ...resto } = r; return { ...resto, ajustes: normalizarAjustes(JSON.parse(config || '{}')) }; };
  const api = {
    async refrescar() {
      cache = convertir(await db.prepare('SELECT * FROM empresa WHERE id = 1').get());
      if (cache) ctx.reloj.tz = cache.zona_horaria;
      return cache;
    },
    obtener: () => cache,
    ajustes: () => cache.ajustes,
    async asegurar({ nombre = 'Mi negocio', rubro = 'Moda y accesorios', zona_horaria = 'America/Lima', ajustes = {} } = {}) {
      if (await api.refrescar()) return cache;
      const a = validar(esquemaAjustes, ajustes);
      await db.prepare('INSERT INTO empresa (id, nombre, rubro, zona_horaria, config, actualizado) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
        .run(nombre, rubro, zona_horaria, JSON.stringify(a), ctx.reloj.ms());
      return api.refrescar();
    },
    async actualizar({ nombre, rubro, zona_horaria, ajustes }) {
      const act = await api.refrescar();
      const nuevos = ajustes ? validar(esquemaAjustes, { ...act.ajustes, ...ajustes }) : act.ajustes;
      if (zona_horaria) {
        try { new Intl.DateTimeFormat('en', { timeZone: zona_horaria }); } catch { throw Object.assign(new Error('Zona horaria inválida.'), { status: 400 }); }
      }
      await db.prepare('UPDATE empresa SET nombre = ?, rubro = ?, zona_horaria = ?, config = ?, actualizado = ? WHERE id = 1')
        .run(nombre?.trim() || act.nombre, rubro?.trim() || act.rubro, zona_horaria || act.zona_horaria, JSON.stringify(nuevos), ctx.reloj.ms());
      ctx.bus.emit('cambio', { tipo: 'empresa' });
      return api.refrescar();
    },
    olvidar() { cache = null; },
  };
  return api;
}
