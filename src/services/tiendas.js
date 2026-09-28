import { transaccion } from '../db/index.js';
import { invalido, noEncontrado, conflicto } from '../lib/errores.js';
import { aMin, esFecha, esHora, sumarDias } from '../domain/tiempo.js';

function validarTurnos(lista) {
  for (const t of lista) {
    if (!esHora(t.inicio) || !esHora(t.fin)) throw invalido('Las horas deben tener el formato HH:MM.');
    if (aMin(t.fin) <= aMin(t.inicio)) throw invalido(`El turno ${t.inicio}–${t.fin} debe terminar después de empezar.`);
    const c = Number(t.cupos ?? 1);
    if (!(c >= 1 && c <= 10)) throw invalido('Los cupos por turno van de 1 a 10.');
  }
}
const leerEspecial = (d) => (d ? { ...d, cerrado: !!d.cerrado, turnos: JSON.parse(d.turnos) } : null);

export function servicioTiendas(ctx) {
  const { db, reloj } = ctx;
  const obtener = (id) => db.prepare('SELECT * FROM tiendas WHERE id = ?').get(id);
  const validar = (t) => {
    if (!String(t.nombre || '').trim()) throw invalido('Escribe el nombre de la tienda.');
    if (!(Math.abs(t.lat) <= 90 && Math.abs(t.lng) <= 180) || t.lat === 0) throw invalido('Coordenadas de la tienda inválidas.');
    if (!(t.radio_m >= 10 && t.radio_m <= 5000)) throw invalido('El radio permitido va de 10 a 5000 m.');
  };
  const resincronizarTiendas = async (tiendaId, fecha) => {
    for (const t of tiendaId ? [await obtener(tiendaId)] : await api.listar()) if (t) await ctx.s.turnos.resincronizarFecha(t.id, fecha);
  };
  const api = {
    obtener,
    listar: ({ todas = false } = {}) => db.prepare(`SELECT * FROM tiendas ${todas ? '' : 'WHERE activa = 1'} ORDER BY id`).all(),
    async crear({ codigo, nombre, direccion = '', lat, lng, radio_m = 80 }) {
      const t = { nombre, lat: Number(lat), lng: Number(lng), radio_m: Number(radio_m) };
      validar(t);
      codigo = String(codigo || '').trim().toUpperCase() || `T${(await db.prepare('SELECT COUNT(*) AS n FROM tiendas').get()).n + 1}`;
      if (await db.prepare('SELECT id FROM tiendas WHERE UPPER(codigo) = ?').get(codigo)) throw conflicto(`Ya existe una tienda con código ${codigo}.`);
      const r = await db.prepare('INSERT INTO tiendas (codigo, nombre, direccion, lat, lng, radio_m, creado) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(codigo, nombre.trim(), String(direccion || '').trim(), t.lat, t.lng, Math.round(t.radio_m), reloj.ms());
      ctx.bus.emit('cambio', { tipo: 'tiendas' });
      return obtener(r.lastInsertRowid);
    },
    async actualizar(id, datos) {
      const act = await obtener(id);
      if (!act) throw noEncontrado('Tienda');
      const t = { ...act, ...Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)) };
      t.lat = Number(t.lat); t.lng = Number(t.lng); t.radio_m = Math.round(Number(t.radio_m));
      validar(t);
      await db.prepare('UPDATE tiendas SET nombre = ?, direccion = ?, lat = ?, lng = ?, radio_m = ?, activa = ? WHERE id = ?')
        .run(t.nombre.trim(), String(t.direccion || '').trim(), t.lat, t.lng, t.radio_m, t.activa ? 1 : 0, id);
      ctx.bus.emit('cambio', { tipo: 'tiendas' });
      return obtener(id);
    },

    plantillas: (tiendaId) => db.prepare('SELECT * FROM plantillas WHERE tienda_id = ? ORDER BY dia, inicio').all(tiendaId),
    todasPlantillas: () => db.prepare('SELECT * FROM plantillas ORDER BY tienda_id, dia, inicio').all(),
    /** Reemplaza los turnos tipo de la tienda y actualiza los días futuros aún no trabajados. */
    async guardarPlantillas(tiendaId, lista) {
      if (!(await obtener(tiendaId))) throw noEncontrado('Tienda');
      validarTurnos(lista);
      for (const t of lista) if (!(t.dia >= 0 && t.dia <= 6)) throw invalido('Día de la semana inválido.');
      await transaccion(db, async () => {
        await db.prepare('DELETE FROM plantillas WHERE tienda_id = ?').run(tiendaId);
        for (const t of lista) await db.prepare('INSERT INTO plantillas (tienda_id, dia, inicio, fin, cupos) VALUES (?, ?, ?, ?, ?)').run(tiendaId, t.dia, t.inicio, t.fin, Number(t.cupos ?? 1));
        await ctx.s.turnos.resincronizar(tiendaId, sumarDias(reloj.ahora().fecha, 1));
      });
      ctx.bus.emit('cambio', { tipo: 'horarios' });
      return api.plantillas(tiendaId);
    },

    async diasEspeciales({ desde = null, hasta = null } = {}) {
      const c = [], a = [];
      if (desde) { c.push('fecha >= ?'); a.push(desde); }
      if (hasta) { c.push('fecha <= ?'); a.push(hasta); }
      return (await db.prepare(`SELECT * FROM dias_especiales ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY fecha`).all(...a)).map(leerEspecial);
    },
    async especialPara(tiendaId, fecha) {
      return leerEspecial(await db.prepare('SELECT * FROM dias_especiales WHERE fecha = ? AND (tienda_id = ? OR tienda_id IS NULL) ORDER BY CASE WHEN tienda_id IS NULL THEN 1 ELSE 0 END LIMIT 1').get(fecha, tiendaId));
    },
    async guardarDiaEspecial({ id = null, tienda_id = null, fecha, cerrado = false, turnos = [], motivo = '' }) {
      if (!esFecha(fecha)) throw invalido('Fecha inválida.');
      if (!cerrado) { if (!turnos.length) throw invalido('Agrega al menos un turno o marca el día como cerrado.'); validarTurnos(turnos); }
      const limpio = cerrado ? [] : turnos.map((t) => ({ inicio: t.inicio, fin: t.fin, cupos: Number(t.cupos ?? 1) }));
      await transaccion(db, async () => {
        if (id) await db.prepare('DELETE FROM dias_especiales WHERE id = ?').run(id);
        if (tienda_id == null) await db.prepare('DELETE FROM dias_especiales WHERE fecha = ? AND tienda_id IS NULL').run(fecha);
        else await db.prepare('DELETE FROM dias_especiales WHERE fecha = ? AND tienda_id = ?').run(fecha, tienda_id);
        await db.prepare('INSERT INTO dias_especiales (tienda_id, fecha, cerrado, turnos, motivo) VALUES (?, ?, ?, ?, ?)')
          .run(tienda_id, fecha, cerrado ? 1 : 0, JSON.stringify(limpio), String(motivo).trim().slice(0, 120));
        await resincronizarTiendas(tienda_id, fecha);
      });
      ctx.bus.emit('cambio', { tipo: 'horarios' });
    },
    async borrarDiaEspecial(id) {
      const d = await db.prepare('SELECT * FROM dias_especiales WHERE id = ?').get(id);
      if (!d) throw noEncontrado('Día especial');
      await transaccion(db, async () => {
        await db.prepare('DELETE FROM dias_especiales WHERE id = ?').run(id);
        await resincronizarTiendas(d.tienda_id, d.fecha);
      });
      ctx.bus.emit('cambio', { tipo: 'horarios' });
    },
  };
  return api;
}
