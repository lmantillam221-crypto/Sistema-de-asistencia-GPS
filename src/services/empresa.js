import { fila } from '../db/index.js';
import { esquemaAjustes, normalizarAjustes } from '../domain/ajustes.js';
import { validar } from '../lib/errores.js';

export function servicioEmpresa(ctx) {
  const { db } = ctx;
  let cache = null;
  const leer = () => {
    if (cache) return cache;
    const r = fila(db.prepare('SELECT * FROM empresa WHERE id = 1').get());
    if (!r) return null;
    const { config, ...resto } = r;
    cache = { ...resto, ajustes: normalizarAjustes(JSON.parse(config || '{}')) };
    return cache;
  };
  return {
    obtener: leer,
    ajustes: () => leer().ajustes,
    asegurar({ nombre = 'Nube.chic', rubro = 'Moda y accesorios', zona_horaria = 'America/Lima', ajustes = {} } = {}) {
      if (leer()) return leer();
      const a = validar(esquemaAjustes, ajustes);
      db.prepare('INSERT INTO empresa (id, nombre, rubro, zona_horaria, config, actualizado) VALUES (1, ?, ?, ?, ?, ?)')
        .run(nombre, rubro, zona_horaria, JSON.stringify(a), ctx.reloj.ms());
      cache = null;
      ctx.reloj.tz = zona_horaria;
      return leer();
    },
    actualizar({ nombre, rubro, zona_horaria, ajustes }) {
      const act = leer();
      const nuevos = ajustes ? validar(esquemaAjustes, { ...act.ajustes, ...ajustes }) : act.ajustes;
      if (zona_horaria) {
        try { new Intl.DateTimeFormat('en', { timeZone: zona_horaria }); } catch { throw Object.assign(new Error('Zona horaria inválida.'), { status: 400 }); }
      }
      db.prepare('UPDATE empresa SET nombre = ?, rubro = ?, zona_horaria = ?, config = ?, actualizado = ? WHERE id = 1')
        .run(nombre?.trim() || act.nombre, rubro?.trim() || act.rubro, zona_horaria || act.zona_horaria, JSON.stringify(nuevos), ctx.reloj.ms());
      cache = null;
      ctx.reloj.tz = leer().zona_horaria;
      ctx.bus.emit('cambio', { tipo: 'empresa' });
      return leer();
    },
    olvidar() { cache = null; },
  };
}
