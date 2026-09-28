export function servicioAuditoria(ctx) {
  const { db } = ctx;
  return {
    async registrar(quien, accion, entidad = null, entidadId = null, detalle = null, ip = null) {
      await db.prepare('INSERT INTO auditoria (ts, usuario_id, accion, entidad, entidad_id, detalle, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(ctx.reloj.ms(), quien?.id ?? null, accion, entidad, entidadId == null ? null : String(entidadId), detalle == null ? null : JSON.stringify(detalle), ip);
    },
    async listar({ limite = 200, antesDe = null, usuarioId = null } = {}) {
      const cond = [], args = [];
      if (antesDe) { cond.push('a.id < ?'); args.push(antesDe); }
      if (usuarioId) { cond.push('a.usuario_id = ?'); args.push(usuarioId); }
      const rs = await db.prepare(`SELECT a.*, u.nombre AS usuario, u.codigo FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
        ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`).all(...args, Math.min(1000, limite));
      return rs.map((r) => ({ ...r, detalle: r.detalle ? JSON.parse(r.detalle) : null }));
    },
    /** Mantenimiento: conserva 3 años de bitácora. */
    async purgar() { await db.prepare('DELETE FROM auditoria WHERE ts < ?').run(Date.now() - 3 * 365 * 864e5); },
  };
}
