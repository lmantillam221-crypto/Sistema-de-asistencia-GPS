import { filas } from '../db/index.js';

export function servicioAuditoria(ctx) {
  const { db } = ctx;
  const ins = db.prepare('INSERT INTO auditoria (ts, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES (?, ?, ?, ?, ?, ?, ?)');
  return {
    registrar(quien, accion, entidad = null, entidadId = null, detalle = null, ip = null) {
      ins.run(ctx.reloj.ms(), quien?.id ?? null, accion, entidad, entidadId == null ? null : String(entidadId), detalle == null ? null : JSON.stringify(detalle), ip);
    },
    listar({ limite = 200, antesDe = null, usuarioId = null } = {}) {
      const cond = [], args = [];
      if (antesDe) { cond.push('a.id < ?'); args.push(antesDe); }
      if (usuarioId) { cond.push('a.usuario_id = ?'); args.push(usuarioId); }
      return filas(db.prepare(`SELECT a.*, u.nombre AS usuario, u.codigo FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`).all(...args, Math.min(1000, limite)))
        .map((r) => ({ ...r, detalle: r.detalle ? JSON.parse(r.detalle) : null }));
    },
  };
}
