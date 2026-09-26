import { fila, filas, transaccion } from '../db/index.js';
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

export function servicioTiendas(ctx) {
  const { db, reloj } = ctx;
  const obtener = (id) => fila(db.prepare('SELECT * FROM tiendas WHERE id = ?').get(id));
  const validar = (t) => {
    if (!String(t.nombre || '').trim()) throw invalido('Escribe el nombre de la tienda.');
    if (!(Math.abs(t.lat) <= 90 && Math.abs(t.lng) <= 180) || t.lat === 0) throw invalido('Coordenadas de la tienda inválidas.');
    if (!(t.radio_m >= 10 && t.radio_m <= 5000)) throw invalido('El radio permitido va de 10 a 5000 m.');
  };
  return {
    obtener,
    listar: ({ todas = false } = {}) => filas(db.prepare(`SELECT * FROM tiendas ${todas ? '' : 'WHERE activa = 1'} ORDER BY id`).all()),
    crear({ codigo, nombre, direccion = '', lat, lng, radio_m = 80 }) {
      const t = { nombre, lat: Number(lat), lng: Number(lng), radio_m: Number(radio_m) };
      validar(t);
      codigo = String(codigo || '').trim().toUpperCase() || `T${db.prepare('SELECT COUNT(*) n FROM tiendas').get().n + 1}`;
      if (fila(db.prepare('SELECT id FROM tiendas WHERE codigo = ?').get(codigo))) throw conflicto(`Ya existe una tienda con código ${codigo}.`);
      const r = db.prepare('INSERT INTO tiendas (codigo, nombre, direccion, lat, lng, radio_m, creado) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(codigo, nombre.trim(), direccion.trim(), t.lat, t.lng, Math.round(t.radio_m), reloj.ms());
      ctx.bus.emit('cambio', { tipo: 'tiendas' });
      return obtener(Number(r.lastInsertRowid));
    },
    actualizar(id, datos) {
      const act = obtener(id);
      if (!act) throw noEncontrado('Tienda');
      const t = { ...act, ...Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)) };
      t.lat = Number(t.lat); t.lng = Number(t.lng); t.radio_m = Math.round(Number(t.radio_m));
      validar(t);
      db.prepare('UPDATE tiendas SET nombre = ?, direccion = ?, lat = ?, lng = ?, radio_m = ?, activa = ? WHERE id = ?')
        .run(t.nombre.trim(), String(t.direccion || '').trim(), t.lat, t.lng, t.radio_m, t.activa ? 1 : 0, id);
      ctx.bus.emit('cambio', { tipo: 'tiendas' });
      return obtener(id);
    },

    plantillas: (tiendaId) => filas(db.prepare('SELECT * FROM plantillas WHERE tienda_id = ? ORDER BY dia, inicio').all(tiendaId)),
    todasPlantillas: () => filas(db.prepare('SELECT * FROM plantillas ORDER BY tienda_id, dia, inicio').all()),
    /** Reemplaza los turnos tipo de la tienda y actualiza los días futuros aún no trabajados. */
    guardarPlantillas(tiendaId, lista) {
      if (!obtener(tiendaId)) throw noEncontrado('Tienda');
      validarTurnos(lista);
      for (const t of lista) if (!(t.dia >= 0 && t.dia <= 6)) throw invalido('Día de la semana inválido.');
      transaccion(db, () => {
        db.prepare('DELETE FROM plantillas WHERE tienda_id = ?').run(tiendaId);
        const ins = db.prepare('INSERT INTO plantillas (tienda_id, dia, inicio, fin, cupos) VALUES (?, ?, ?, ?, ?)');
        for (const t of lista) ins.run(tiendaId, t.dia, t.inicio, t.fin, Number(t.cupos ?? 1));
        ctx.s.turnos.resincronizar(tiendaId, sumarDias(reloj.ahora().fecha, 1));
      });
      ctx.bus.emit('cambio', { tipo: 'horarios' });
      return this.plantillas(tiendaId);
    },

    diasEspeciales({ desde = null } = {}) {
      return filas(db.prepare(`SELECT * FROM dias_especiales ${desde ? 'WHERE fecha >= ?' : ''} ORDER BY fecha`).all(...(desde ? [desde] : [])))
        .map((d) => ({ ...d, cerrado: !!d.cerrado, turnos: JSON.parse(d.turnos) }));
    },
    especialPara(tiendaId, fecha) {
      const d = fila(db.prepare('SELECT * FROM dias_especiales WHERE fecha = ? AND (tienda_id = ? OR tienda_id IS NULL) ORDER BY tienda_id IS NULL LIMIT 1').get(fecha, tiendaId));
      return d ? { ...d, cerrado: !!d.cerrado, turnos: JSON.parse(d.turnos) } : null;
    },
    guardarDiaEspecial({ id = null, tienda_id = null, fecha, cerrado = false, turnos = [], motivo = '' }) {
      if (!esFecha(fecha)) throw invalido('Fecha inválida.');
      if (!cerrado) { if (!turnos.length) throw invalido('Agrega al menos un turno o marca el día como cerrado.'); validarTurnos(turnos); }
      const limpio = cerrado ? [] : turnos.map((t) => ({ inicio: t.inicio, fin: t.fin, cupos: Number(t.cupos ?? 1) }));
      transaccion(db, () => {
        if (id) db.prepare('DELETE FROM dias_especiales WHERE id = ?').run(id);
        db.prepare('DELETE FROM dias_especiales WHERE fecha = ? AND tienda_id IS ?').run(fecha, tienda_id);
        db.prepare('INSERT INTO dias_especiales (tienda_id, fecha, cerrado, turnos, motivo) VALUES (?, ?, ?, ?, ?)')
          .run(tienda_id, fecha, cerrado ? 1 : 0, JSON.stringify(limpio), String(motivo).trim().slice(0, 120));
        for (const t of tienda_id ? [obtener(tienda_id)] : this.listar()) if (t) ctx.s.turnos.resincronizarFecha(t.id, fecha);
      });
      ctx.bus.emit('cambio', { tipo: 'horarios' });
    },
    borrarDiaEspecial(id) {
      const d = fila(db.prepare('SELECT * FROM dias_especiales WHERE id = ?').get(id));
      if (!d) throw noEncontrado('Día especial');
      transaccion(db, () => {
        db.prepare('DELETE FROM dias_especiales WHERE id = ?').run(id);
        for (const t of d.tienda_id ? [obtener(d.tienda_id)] : this.listar()) if (t) ctx.s.turnos.resincronizarFecha(t.id, d.fecha);
      });
      ctx.bus.emit('cambio', { tipo: 'horarios' });
    },
  };
}
