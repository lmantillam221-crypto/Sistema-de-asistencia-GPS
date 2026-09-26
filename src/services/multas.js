import { fila, filas, transaccion } from '../db/index.js';
import { conflicto, invalido, noEncontrado, prohibido } from '../lib/errores.js';
import { multasDelTurno, evaluar } from '../domain/asistencia.js';
import { sumarDias } from '../domain/tiempo.js';

const DIAS_REVISION = 14;

export function servicioMultas(ctx) {
  const { db, reloj } = ctx;
  const SELECT = `SELECT m.*, u.nombre AS usuario_nombre, u.codigo AS usuario_codigo, u.telefono AS usuario_telefono,
    t.inicio AS turno_inicio, t.fin AS turno_fin, ti.nombre AS tienda_nombre,
    (SELECT j.estado FROM justificaciones j WHERE j.multa_id = m.id ORDER BY j.id DESC LIMIT 1) AS justificacion
    FROM multas m JOIN usuarios u ON u.id = m.usuario_id LEFT JOIN turnos t ON t.id = m.turno_id LEFT JOIN tiendas ti ON ti.id = t.tienda_id`;
  const obtener = (id) => fila(db.prepare(`${SELECT} WHERE m.id = ?`).get(id));
  const ins = () => db.prepare(`INSERT INTO multas (usuario_id, turno_id, fecha, tipo, monto, detalle, creada, ejemplo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING`);

  function sincronizarTurno(turnoId, ahora = reloj.ahora()) {
    const t = ctx.s.turnos.obtener(turnoId);
    if (!t || !t.usuario_id || t.fecha > ahora.fecha) return 0;
    const aj = ctx.s.empresa.ajustes();
    const ms = ctx.s.asistencia.marcasDe(t.id, t.usuario_id);
    const ev = evaluar(ms, t, ahora, aj);
    let n = 0;
    for (const m of multasDelTurno(ev, t, aj.multas)) {
      n += ins().run(t.usuario_id, t.id, t.fecha, m.tipo, m.monto, m.detalle, reloj.ms(), t.ejemplo).changes;
    }
    // Si se registró una falta y luego aparece la entrada, la falta se anula sola.
    if (ev.entrada) {
      const f = fila(db.prepare("SELECT * FROM multas WHERE turno_id = ? AND usuario_id = ? AND tipo = 'falta' AND estado = 'pendiente'").get(t.id, t.usuario_id));
      if (f) db.prepare("UPDATE multas SET estado = 'anulada', motivo_anulada = 'Sí marcó entrada' WHERE id = ?").run(f.id);
    }
    return n;
  }

  const api = {
    obtener,
    sincronizarTurno,
    /** Genera las multas de los turnos de los últimos días. Idempotente. */
    sincronizar() {
      const ahora = reloj.ahora();
      const turnos = filas(db.prepare('SELECT id FROM turnos WHERE usuario_id IS NOT NULL AND fecha BETWEEN ? AND ?').all(sumarDias(ahora.fecha, -DIAS_REVISION), ahora.fecha));
      let nuevas = 0;
      transaccion(db, () => { for (const t of turnos) nuevas += sincronizarTurno(t.id, ahora); });
      if (nuevas) ctx.bus.emit('cambio', { tipo: 'multas' });
      return nuevas;
    },
    listar({ estado = null, usuarioId = null, desde = null, hasta = null } = {}) {
      const c = [], a = [];
      if (estado && estado !== 'todas') { c.push('m.estado = ?'); a.push(estado); }
      if (usuarioId) { c.push('m.usuario_id = ?'); a.push(usuarioId); }
      if (desde) { c.push('m.fecha >= ?'); a.push(desde); }
      if (hasta) { c.push('m.fecha <= ?'); a.push(hasta); }
      return filas(db.prepare(`${SELECT} ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY m.fecha DESC, m.id DESC LIMIT 2000`).all(...a));
    },
    resumen() {
      const mes = reloj.ahora().fecha.slice(0, 7);
      const r = fila(db.prepare(`SELECT
        COALESCE(SUM(CASE WHEN estado = 'pendiente' THEN monto END), 0) AS pendiente,
        COALESCE(SUM(CASE WHEN estado = 'pendiente' THEN 1 END), 0) AS nPendientes,
        COALESCE(SUM(CASE WHEN estado = 'pendiente' AND notificada IS NULL THEN 1 END), 0) AS sinNotificar,
        COALESCE(SUM(CASE WHEN estado = 'pagada' THEN 1 END), 0) AS nPagadas
        FROM multas`).get());
      const cobradoMes = filas(db.prepare("SELECT monto, pagada FROM multas WHERE estado = 'pagada' AND pagada IS NOT NULL").all())
        .filter((m) => new Date(m.pagada).toISOString().slice(0, 7) === mes).reduce((s, m) => s + m.monto, 0);
      const porUsuario = filas(db.prepare(`SELECT u.id, u.nombre, u.codigo, u.telefono, COALESCE(SUM(CASE WHEN m.estado = 'pendiente' THEN m.monto END), 0) AS pendiente,
        COUNT(CASE WHEN m.estado = 'pendiente' THEN 1 END) AS n FROM usuarios u LEFT JOIN multas m ON m.usuario_id = u.id
        WHERE u.rol = 'colaborador' AND u.activo = 1 GROUP BY u.id ORDER BY pendiente DESC, u.codigo`).all());
      return { ...r, cobradoMes, porUsuario };
    },
    pendienteDe: (usuarioId) => db.prepare("SELECT COALESCE(SUM(monto), 0) t FROM multas WHERE usuario_id = ? AND estado = 'pendiente'").get(usuarioId).t,
    cambiarEstado(id, estado, quien, motivo = null) {
      const m = obtener(id);
      if (!m) throw noEncontrado('Multa');
      if (!['pendiente', 'pagada', 'anulada'].includes(estado)) throw invalido('Estado inválido.');
      db.prepare('UPDATE multas SET estado = ?, pagada = ?, motivo_anulada = ? WHERE id = ?')
        .run(estado, estado === 'pagada' ? reloj.ms() : null, estado === 'anulada' ? (motivo || 'Anulada por supervisión') : null, id);
      ctx.s.auditoria.registrar(quien, `multa_${estado}`, 'multa', id, { monto: m.monto, usuario: m.usuario_nombre, motivo });
      ctx.bus.emit('cambio', { tipo: 'multas' });
      return obtener(id);
    },
    pagarTodo(usuarioId, quien) {
      const r = db.prepare("UPDATE multas SET estado = 'pagada', pagada = ? WHERE usuario_id = ? AND estado = 'pendiente'").run(reloj.ms(), usuarioId);
      ctx.s.auditoria.registrar(quien, 'multas_pagadas', 'usuario', usuarioId, { cantidad: r.changes });
      ctx.bus.emit('cambio', { tipo: 'multas' });
      return r.changes;
    },
    marcarNotificada(id) { db.prepare('UPDATE multas SET notificada = ? WHERE id = ?').run(reloj.ms(), id); },
    marcarVistas(usuarioId) { db.prepare('UPDATE multas SET vista = ? WHERE usuario_id = ? AND vista IS NULL').run(reloj.ms(), usuarioId); },
    crearManual({ usuario_id, fecha, monto, detalle }, quien) {
      if (!ctx.s.usuarios.porId(usuario_id)) throw noEncontrado('Colaboradora');
      if (!(monto > 0)) throw invalido('El monto debe ser mayor a 0.');
      if (!String(detalle || '').trim()) throw invalido('Describe el motivo de la multa.');
      const r = db.prepare("INSERT INTO multas (usuario_id, fecha, tipo, monto, detalle, creada) VALUES (?, ?, 'manual', ?, ?, ?)").run(usuario_id, fecha, monto, String(detalle).trim(), reloj.ms());
      ctx.s.auditoria.registrar(quien, 'multa_manual', 'multa', Number(r.lastInsertRowid), { monto, detalle });
      ctx.bus.emit('cambio', { tipo: 'multas' });
      return obtener(Number(r.lastInsertRowid));
    },

    /* ---- Justificaciones ---- */
    justificar(usuario, multaId, motivo) {
      const m = obtener(multaId);
      if (!m || m.usuario_id !== usuario.id) throw noEncontrado('Multa');
      if (m.estado !== 'pendiente') throw conflicto('Solo se pueden justificar multas pendientes.');
      if (String(motivo || '').trim().length < 5) throw invalido('Explica el motivo (al menos 5 letras).');
      if (fila(db.prepare("SELECT 1 FROM justificaciones WHERE multa_id = ? AND estado = 'pendiente'").get(multaId))) throw conflicto('Ya enviaste una justificación para esta multa.');
      const r = db.prepare('INSERT INTO justificaciones (usuario_id, multa_id, turno_id, motivo, creada) VALUES (?, ?, ?, ?, ?)').run(usuario.id, multaId, m.turno_id, String(motivo).trim().slice(0, 500), reloj.ms());
      ctx.s.auditoria.registrar(usuario, 'justificacion_enviada', 'multa', multaId, null);
      ctx.bus.emit('cambio', { tipo: 'justificaciones' });
      return Number(r.lastInsertRowid);
    },
    justificaciones({ estado = null, usuarioId = null } = {}) {
      const c = [], a = [];
      if (estado) { c.push('j.estado = ?'); a.push(estado); }
      if (usuarioId) { c.push('j.usuario_id = ?'); a.push(usuarioId); }
      return filas(db.prepare(`SELECT j.*, u.nombre AS usuario_nombre, m.tipo AS multa_tipo, m.monto AS multa_monto, m.fecha AS multa_fecha, m.detalle AS multa_detalle,
        r.nombre AS resuelta_por_nombre FROM justificaciones j JOIN usuarios u ON u.id = j.usuario_id LEFT JOIN multas m ON m.id = j.multa_id
        LEFT JOIN usuarios r ON r.id = j.resuelta_por ${c.length ? 'WHERE ' + c.join(' AND ') : ''} ORDER BY j.estado = 'pendiente' DESC, j.id DESC LIMIT 500`).all(...a));
    },
    resolverJustificacion(id, aprobar, respuesta, quien) {
      const j = fila(db.prepare('SELECT * FROM justificaciones WHERE id = ?').get(id));
      if (!j) throw noEncontrado('Justificación');
      if (j.estado !== 'pendiente') throw conflicto('Esa justificación ya fue resuelta.');
      transaccion(db, () => {
        db.prepare('UPDATE justificaciones SET estado = ?, respuesta = ?, resuelta = ?, resuelta_por = ? WHERE id = ?')
          .run(aprobar ? 'aprobada' : 'rechazada', String(respuesta || '').trim().slice(0, 300) || null, reloj.ms(), quien.id, id);
        if (aprobar && j.multa_id) db.prepare("UPDATE multas SET estado = 'anulada', motivo_anulada = ? WHERE id = ? AND estado = 'pendiente'").run('Justificada: ' + j.motivo.slice(0, 120), j.multa_id);
      });
      ctx.s.auditoria.registrar(quien, aprobar ? 'justificacion_aprobada' : 'justificacion_rechazada', 'justificacion', id, { multa: j.multa_id });
      ctx.bus.emit('cambio', { tipo: 'multas' });
    },
  };
  return api;
}
