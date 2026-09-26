import { fila, filas, transaccion } from '../db/index.js';
import { conflicto, invalido, noEncontrado } from '../lib/errores.js';
import { aMin, sumarDias } from '../domain/tiempo.js';

/* Una colaboradora que no puede asistir publica su turno; otra lo toma y el turno pasa a su nombre. */
export function servicioCoberturas(ctx) {
  const { db, reloj } = ctx;
  const SELECT = `SELECT c.*, t.fecha, t.inicio, t.fin, t.tienda_id, ti.nombre AS tienda_nombre, s.nombre AS solicitante_nombre, s.telefono AS solicitante_telefono,
    k.nombre AS tomada_por_nombre FROM coberturas c JOIN turnos t ON t.id = c.turno_id JOIN tiendas ti ON ti.id = t.tienda_id
    JOIN usuarios s ON s.id = c.solicitante_id LEFT JOIN usuarios k ON k.id = c.tomada_por`;
  const empezo = (t, ahora) => t.fecha < ahora.fecha || (t.fecha === ahora.fecha && ahora.minutos >= aMin(t.inicio));
  const api = {
    listar({ estado = null, desde = null } = {}) {
      const c = [], a = [];
      if (estado) { c.push('c.estado = ?'); a.push(estado); }
      if (desde) { c.push('t.fecha >= ?'); a.push(desde); }
      return filas(db.prepare(`${SELECT} ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY t.fecha, t.inicio LIMIT 500`).all(...a));
    },
    solicitar(usuario, turnoId, motivo = '') {
      const t = ctx.s.turnos.obtener(turnoId);
      if (!t || t.usuario_id !== usuario.id) throw noEncontrado('Turno');
      if (empezo(t, reloj.ahora())) throw conflicto('Ese turno ya empezó.');
      if (fila(db.prepare("SELECT 1 FROM coberturas WHERE turno_id = ? AND estado = 'abierta'").get(turnoId))) throw conflicto('Ya pediste cobertura para ese turno.');
      const r = db.prepare('INSERT INTO coberturas (turno_id, solicitante_id, motivo, creada) VALUES (?, ?, ?, ?)').run(turnoId, usuario.id, String(motivo).trim().slice(0, 200), reloj.ms());
      ctx.s.auditoria.registrar(usuario, 'cobertura_solicitada', 'turno', turnoId, { motivo });
      ctx.bus.emit('cambio', { tipo: 'coberturas' });
      return Number(r.lastInsertRowid);
    },
    cancelar(usuario, id, esSupervisor = false) {
      const c = fila(db.prepare('SELECT * FROM coberturas WHERE id = ?').get(id));
      if (!c || (!esSupervisor && c.solicitante_id !== usuario.id)) throw noEncontrado('Solicitud');
      if (c.estado !== 'abierta') throw conflicto('Esa solicitud ya no está abierta.');
      db.prepare("UPDATE coberturas SET estado = 'cancelada', resuelta = ? WHERE id = ?").run(reloj.ms(), id);
      ctx.bus.emit('cambio', { tipo: 'coberturas' });
    },
    tomar(usuario, id) {
      const c = fila(db.prepare(`${SELECT} WHERE c.id = ?`).get(id));
      if (!c) throw noEncontrado('Solicitud');
      if (c.estado !== 'abierta') throw conflicto('Otra persona ya tomó ese turno.');
      if (c.solicitante_id === usuario.id) throw invalido('No puedes tomar tu propio turno.');
      const t = ctx.s.turnos.obtener(c.turno_id);
      if (empezo(t, reloj.ahora())) throw conflicto('Ese turno ya empezó.');
      const cruce = ctx.s.turnos.cruce(usuario.id, t);
      if (cruce) throw conflicto(`Se cruza con tu turno de ${cruce.inicio}–${cruce.fin}.`);
      transaccion(db, () => {
        const r = db.prepare("UPDATE coberturas SET estado = 'tomada', tomada_por = ?, resuelta = ? WHERE id = ? AND estado = 'abierta'").run(usuario.id, reloj.ms(), id);
        if (!r.changes) throw conflicto('Otra persona ya tomó ese turno.');
        db.prepare("UPDATE turnos SET usuario_id = ?, asignado_por = 'cobertura', asignado_en = ? WHERE id = ?").run(usuario.id, reloj.ms(), c.turno_id);
      });
      ctx.s.auditoria.registrar(usuario, 'cobertura_tomada', 'turno', c.turno_id, { de: c.solicitante_nombre });
      ctx.bus.emit('cambio', { tipo: 'coberturas' });
      return fila(db.prepare(`${SELECT} WHERE c.id = ?`).get(id));
    },
    vencer() {
      const ahora = reloj.ahora();
      for (const c of api.listar({ estado: 'abierta' })) {
        if (empezo(c, ahora)) db.prepare("UPDATE coberturas SET estado = 'vencida', resuelta = ? WHERE id = ?").run(reloj.ms(), c.id);
      }
    },
    abiertasPara(usuario) {
      const ahora = reloj.ahora();
      return api.listar({ estado: 'abierta', desde: ahora.fecha })
        .filter((c) => c.solicitante_id !== usuario.id && !empezo(c, ahora))
        .map((c) => ({ ...c, cruce: !!ctx.s.turnos.cruce(usuario.id, { id: c.turno_id, fecha: c.fecha, inicio: c.inicio, fin: c.fin }) }));
    },
  };
  return api;
}
