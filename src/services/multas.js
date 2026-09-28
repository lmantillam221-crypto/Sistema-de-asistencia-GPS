import { transaccion } from '../db/index.js';
import { conflicto, invalido, noEncontrado } from '../lib/errores.js';
import { multasDelTurno, evaluar } from '../domain/asistencia.js';
import { sumarDias, instante } from '../domain/tiempo.js';

const DIAS_REVISION = 14;

export function servicioMultas(ctx) {
  const { db, reloj } = ctx;
  const SELECT = `SELECT m.*, u.nombre AS usuario_nombre, u.codigo AS usuario_codigo, u.telefono AS usuario_telefono,
    t.inicio AS turno_inicio, t.fin AS turno_fin, ti.nombre AS tienda_nombre,
    (SELECT j.estado FROM justificaciones j WHERE j.multa_id = m.id ORDER BY j.id DESC LIMIT 1) AS justificacion
    FROM multas m JOIN usuarios u ON u.id = m.usuario_id LEFT JOIN turnos t ON t.id = m.turno_id LEFT JOIN tiendas ti ON ti.id = t.tienda_id`;
  const obtener = (id) => db.prepare(`${SELECT} WHERE m.id = ?`).get(id);
  const insertar = (usuarioId, turnoId, fecha, m, ejemplo) => db.prepare(`INSERT INTO multas (usuario_id, turno_id, fecha, tipo, monto, detalle, creada, ejemplo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(usuarioId, turnoId, fecha, m.tipo, m.monto, m.detalle, reloj.ms(), ejemplo ? 1 : 0);

  /** Aplica las reglas de multas a un turno ya evaluado. Idempotente (índice único por turno, persona y tipo). */
  async function aplicar(t, ev, aj) {
    let n = 0;
    for (const m of multasDelTurno(ev, t, aj.multas)) n += (await insertar(t.usuario_id, t.id, t.fecha, m, t.ejemplo)).changes;
    // Si se registró una falta y luego aparece la entrada, la falta se anula sola.
    if (ev.entrada) await db.prepare("UPDATE multas SET estado = 'anulada', motivo_anulada = 'Sí marcó entrada' WHERE turno_id = ? AND usuario_id = ? AND tipo = 'falta' AND estado = 'pendiente'").run(t.id, t.usuario_id);
    return n;
  }

  const api = {
    obtener,
    async sincronizarTurno(turnoId, ahora = reloj.ahora()) {
      const t = await ctx.s.turnos.obtener(turnoId);
      if (!t || !t.usuario_id || t.fecha > ahora.fecha) return 0;
      const aj = ctx.s.empresa.ajustes();
      return aplicar(t, evaluar(await ctx.s.asistencia.marcasDe(t.id, t.usuario_id), t, ahora, aj), aj);
    },
    /**
     * Genera las multas de los turnos de los últimos días (tarea programada). Idempotente.
     * Carga turnos, marcas y multas existentes en lote y solo escribe lo que falta.
     */
    async sincronizar({ dias = DIAS_REVISION } = {}) {
      const ahora = reloj.ahora(), aj = ctx.s.empresa.ajustes();
      const desde = sumarDias(ahora.fecha, -dias);
      const turnos = await db.prepare('SELECT * FROM turnos WHERE usuario_id IS NOT NULL AND fecha BETWEEN ? AND ?').all(desde, ahora.fecha);
      if (!turnos.length) return 0;
      const marcas = (await db.prepare('SELECT * FROM marcas WHERE fecha BETWEEN ? AND ? AND turno_id IS NOT NULL ORDER BY hora, id').all(desde, ahora.fecha))
        .map((m) => ({ ...m, observaciones: JSON.parse(m.observaciones || '[]') }));
      const porClave = new Map();
      for (const m of marcas) { const k = m.turno_id + '|' + m.usuario_id; if (!porClave.has(k)) porClave.set(k, []); porClave.get(k).push(m); }
      const existentes = new Set((await db.prepare('SELECT turno_id, usuario_id, tipo, estado FROM multas WHERE fecha BETWEEN ? AND ? AND turno_id IS NOT NULL').all(desde, ahora.fecha))
        .map((m) => `${m.turno_id}|${m.usuario_id}|${m.tipo}${m.tipo === 'falta' && m.estado === 'pendiente' ? '|pend' : ''}`));
      let nuevas = 0;
      for (const t of turnos) {
        const ms = porClave.get(t.id + '|' + t.usuario_id) || [];
        const ev = evaluar(ms, t, ahora, aj);
        const faltan = multasDelTurno(ev, t, aj.multas).filter((m) => !existentes.has(`${t.id}|${t.usuario_id}|${m.tipo}`));
        const anularFalta = ev.entrada && existentes.has(`${t.id}|${t.usuario_id}|falta|pend`);
        if (faltan.length || anularFalta) nuevas += await aplicar(t, ev, aj);
      }
      if (nuevas) ctx.bus.emit('cambio', { tipo: 'multas' });
      return nuevas;
    },
    async listar({ estado = null, usuarioId = null, desde = null, hasta = null } = {}) {
      const c = [], a = [];
      if (estado && estado !== 'todas') { c.push('m.estado = ?'); a.push(estado); }
      if (usuarioId) { c.push('m.usuario_id = ?'); a.push(usuarioId); }
      if (desde) { c.push('m.fecha >= ?'); a.push(desde); }
      if (hasta) { c.push('m.fecha <= ?'); a.push(hasta); }
      return db.prepare(`${SELECT} ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY m.fecha DESC, m.id DESC LIMIT 2000`).all(...a);
    },
    async resumen() {
      const ahora = reloj.ahora();
      const inicioMes = instante(ahora.fecha.slice(0, 8) + '01', '00:00', reloj.tz);
      const r = await db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN estado = 'pendiente' THEN monto END), 0) AS pendiente,
        COUNT(CASE WHEN estado = 'pendiente' THEN 1 END) AS "nPendientes",
        COUNT(CASE WHEN estado = 'pendiente' AND notificada IS NULL THEN 1 END) AS "sinNotificar",
        COUNT(CASE WHEN estado = 'pagada' THEN 1 END) AS "nPagadas",
        COALESCE(SUM(CASE WHEN estado = 'pagada' AND pagada >= ? THEN monto END), 0) AS "cobradoMes"
        FROM multas`).get(inicioMes);
      const porUsuario = await db.prepare(`SELECT u.id, u.nombre, u.codigo, u.telefono, COALESCE(SUM(CASE WHEN m.estado = 'pendiente' THEN m.monto END), 0) AS pendiente,
        COUNT(CASE WHEN m.estado = 'pendiente' THEN 1 END) AS n FROM usuarios u LEFT JOIN multas m ON m.usuario_id = u.id
        WHERE u.rol = 'colaborador' AND u.activo = 1 GROUP BY u.id, u.nombre, u.codigo, u.telefono ORDER BY pendiente DESC, u.codigo`).all();
      return { ...r, pendiente: Number(r.pendiente), cobradoMes: Number(r.cobradoMes), porUsuario: porUsuario.map((u) => ({ ...u, pendiente: Number(u.pendiente) })) };
    },
    pendienteDe: async (usuarioId) => Number((await db.prepare("SELECT COALESCE(SUM(monto), 0) AS t FROM multas WHERE usuario_id = ? AND estado = 'pendiente'").get(usuarioId)).t),
    async cambiarEstado(id, estado, quien, motivo = null) {
      const m = await obtener(id);
      if (!m) throw noEncontrado('Multa');
      if (!['pendiente', 'pagada', 'anulada'].includes(estado)) throw invalido('Estado inválido.');
      await db.prepare('UPDATE multas SET estado = ?, pagada = ?, motivo_anulada = ? WHERE id = ?')
        .run(estado, estado === 'pagada' ? reloj.ms() : null, estado === 'anulada' ? (motivo || 'Anulada por supervisión') : null, id);
      await ctx.s.auditoria.registrar(quien, `multa_${estado}`, 'multa', id, { monto: m.monto, usuario: m.usuario_nombre, motivo });
      ctx.bus.emit('cambio', { tipo: 'multas' });
      return obtener(id);
    },
    async pagarTodo(usuarioId, quien) {
      const r = await db.prepare("UPDATE multas SET estado = 'pagada', pagada = ? WHERE usuario_id = ? AND estado = 'pendiente'").run(reloj.ms(), usuarioId);
      await ctx.s.auditoria.registrar(quien, 'multas_pagadas', 'usuario', usuarioId, { cantidad: r.changes });
      ctx.bus.emit('cambio', { tipo: 'multas' });
      return r.changes;
    },
    marcarNotificada: (id) => db.prepare('UPDATE multas SET notificada = ? WHERE id = ?').run(reloj.ms(), id),
    marcarVistas: (usuarioId) => db.prepare('UPDATE multas SET vista = ? WHERE usuario_id = ? AND vista IS NULL').run(reloj.ms(), usuarioId),
    async crearManual({ usuario_id, fecha, monto, detalle }, quien) {
      if (!(await ctx.s.usuarios.porId(usuario_id))) throw noEncontrado('Colaboradora');
      if (!(monto > 0)) throw invalido('El monto debe ser mayor a 0.');
      if (!String(detalle || '').trim()) throw invalido('Describe el motivo de la multa.');
      const r = await db.prepare("INSERT INTO multas (usuario_id, fecha, tipo, monto, detalle, creada) VALUES (?, ?, 'manual', ?, ?, ?)").run(usuario_id, fecha, monto, String(detalle).trim(), reloj.ms());
      await ctx.s.auditoria.registrar(quien, 'multa_manual', 'multa', r.lastInsertRowid, { monto, detalle });
      ctx.bus.emit('cambio', { tipo: 'multas' });
      return obtener(r.lastInsertRowid);
    },

    /* ---- Justificaciones ---- */
    async justificar(usuario, multaId, motivo) {
      const m = await obtener(multaId);
      if (!m || m.usuario_id !== usuario.id) throw noEncontrado('Multa');
      if (m.estado !== 'pendiente') throw conflicto('Solo se pueden justificar multas pendientes.');
      if (String(motivo || '').trim().length < 5) throw invalido('Explica el motivo (al menos 5 letras).');
      if (await db.prepare("SELECT 1 AS x FROM justificaciones WHERE multa_id = ? AND estado = 'pendiente'").get(multaId)) throw conflicto('Ya enviaste una justificación para esta multa.');
      const r = await db.prepare('INSERT INTO justificaciones (usuario_id, multa_id, turno_id, motivo, creada) VALUES (?, ?, ?, ?, ?)').run(usuario.id, multaId, m.turno_id, String(motivo).trim().slice(0, 500), reloj.ms());
      await ctx.s.auditoria.registrar(usuario, 'justificacion_enviada', 'multa', multaId, null);
      ctx.bus.emit('cambio', { tipo: 'justificaciones' });
      return r.lastInsertRowid;
    },
    justificaciones({ estado = null, usuarioId = null } = {}) {
      const c = [], a = [];
      if (estado) { c.push('j.estado = ?'); a.push(estado); }
      if (usuarioId) { c.push('j.usuario_id = ?'); a.push(usuarioId); }
      return db.prepare(`SELECT j.*, u.nombre AS usuario_nombre, m.tipo AS multa_tipo, m.monto AS multa_monto, m.fecha AS multa_fecha, m.detalle AS multa_detalle,
        r.nombre AS resuelta_por_nombre FROM justificaciones j JOIN usuarios u ON u.id = j.usuario_id LEFT JOIN multas m ON m.id = j.multa_id
        LEFT JOIN usuarios r ON r.id = j.resuelta_por ${c.length ? 'WHERE ' + c.join(' AND ') : ''}
        ORDER BY CASE WHEN j.estado = 'pendiente' THEN 0 ELSE 1 END, j.id DESC LIMIT 500`).all(...a);
    },
    async resolverJustificacion(id, aprobar, respuesta, quien) {
      await transaccion(db, async () => {
        const j = await db.prepare('SELECT * FROM justificaciones WHERE id = ?').get(id);
        if (!j) throw noEncontrado('Justificación');
        await db.bloquearFila('justificaciones', id);
        const actual = await db.prepare('SELECT estado FROM justificaciones WHERE id = ?').get(id);
        if (actual.estado !== 'pendiente') throw conflicto('Esa justificación ya fue resuelta.');
        await db.prepare('UPDATE justificaciones SET estado = ?, respuesta = ?, resuelta = ?, resuelta_por = ? WHERE id = ?')
          .run(aprobar ? 'aprobada' : 'rechazada', String(respuesta || '').trim().slice(0, 300) || null, reloj.ms(), quien.id, id);
        if (aprobar && j.multa_id) await db.prepare("UPDATE multas SET estado = 'anulada', motivo_anulada = ? WHERE id = ? AND estado = 'pendiente'").run('Justificada: ' + j.motivo.slice(0, 120), j.multa_id);
        await ctx.s.auditoria.registrar(quien, aprobar ? 'justificacion_aprobada' : 'justificacion_rechazada', 'justificacion', id, { multa: j.multa_id });
      });
      ctx.bus.emit('cambio', { tipo: 'multas' });
    },
  };
  return api;
}
