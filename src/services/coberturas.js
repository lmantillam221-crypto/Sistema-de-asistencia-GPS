import { transaccion } from '../db/index.js';
import { conflicto, invalido, noEncontrado } from '../lib/errores.js';
import { aMin } from '../domain/tiempo.js';

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
      return db.prepare(`${SELECT} ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY t.fecha, t.inicio LIMIT 500`).all(...a);
    },
    async solicitar(usuario, turnoId, motivo = '') {
      const t = await ctx.s.turnos.obtener(turnoId);
      if (!t || t.usuario_id !== usuario.id) throw noEncontrado('Turno');
      if (empezo(t, reloj.ahora())) throw conflicto('Ese turno ya empezó.');
      if (await db.prepare("SELECT 1 AS x FROM coberturas WHERE turno_id = ? AND estado = 'abierta'").get(turnoId)) throw conflicto('Ya pediste cobertura para ese turno.');
      const r = await db.prepare('INSERT INTO coberturas (turno_id, solicitante_id, motivo, creada) VALUES (?, ?, ?, ?)').run(turnoId, usuario.id, String(motivo).trim().slice(0, 200), reloj.ms());
      await ctx.s.auditoria.registrar(usuario, 'cobertura_solicitada', 'turno', turnoId, { motivo });
      ctx.bus.emit('cambio', { tipo: 'coberturas' });
      return r.lastInsertRowid;
    },
    async cancelar(usuario, id, esSupervisor = false) {
      const c = await db.prepare('SELECT * FROM coberturas WHERE id = ?').get(id);
      if (!c || (!esSupervisor && c.solicitante_id !== usuario.id)) throw noEncontrado('Solicitud');
      if (c.estado !== 'abierta') throw conflicto('Esa solicitud ya no está abierta.');
      await db.prepare("UPDATE coberturas SET estado = 'cancelada', resuelta = ? WHERE id = ? AND estado = 'abierta'").run(reloj.ms(), id);
      ctx.bus.emit('cambio', { tipo: 'coberturas' });
    },
    async tomar(usuario, id) {
      const c = await db.prepare(`${SELECT} WHERE c.id = ?`).get(id);
      if (!c) throw noEncontrado('Solicitud');
      if (c.estado !== 'abierta') throw conflicto('Otra persona ya tomó ese turno.');
      if (c.solicitante_id === usuario.id) throw invalido('No puedes tomar tu propio turno.');
      const t = await ctx.s.turnos.obtener(c.turno_id);
      if (empezo(t, reloj.ahora())) throw conflicto('Ese turno ya empezó.');
      await transaccion(db, async () => {
        await db.bloquearFila('usuarios', usuario.id);
        const cruce = await ctx.s.turnos.cruce(usuario.id, t);
        if (cruce) throw conflicto(`Se cruza con tu turno de ${cruce.inicio}–${cruce.fin}.`);
        const r = await db.prepare("UPDATE coberturas SET estado = 'tomada', tomada_por = ?, resuelta = ? WHERE id = ? AND estado = 'abierta'").run(usuario.id, reloj.ms(), id);
        if (!r.changes) throw conflicto('Otra persona ya tomó ese turno.');
        await db.prepare("UPDATE turnos SET usuario_id = ?, asignado_por = 'cobertura', asignado_en = ? WHERE id = ?").run(usuario.id, reloj.ms(), c.turno_id);
      });
      await ctx.s.auditoria.registrar(usuario, 'cobertura_tomada', 'turno', c.turno_id, { de: c.solicitante_nombre });
      ctx.bus.emit('cambio', { tipo: 'coberturas' });
      return db.prepare(`${SELECT} WHERE c.id = ?`).get(id);
    },
    async vencer() {
      const ahora = reloj.ahora();
      for (const c of await api.listar({ estado: 'abierta' })) {
        if (empezo(c, ahora)) await db.prepare("UPDATE coberturas SET estado = 'vencida', resuelta = ? WHERE id = ? AND estado = 'abierta'").run(reloj.ms(), c.id);
      }
    },
    async abiertasPara(usuario) {
      const ahora = reloj.ahora();
      const lista = (await api.listar({ estado: 'abierta', desde: ahora.fecha })).filter((c) => c.solicitante_id !== usuario.id && !empezo(c, ahora));
      const out = [];
      for (const c of lista) out.push({ ...c, cruce: !!(await ctx.s.turnos.cruce(usuario.id, { id: c.turno_id, fecha: c.fecha, inicio: c.inicio, fin: c.fin })) });
      return out;
    },
  };
  return api;
}
