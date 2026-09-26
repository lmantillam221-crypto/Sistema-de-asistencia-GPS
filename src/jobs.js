/* Tareas periódicas: multas automáticas, coberturas vencidas y limpieza de sesiones. */
export function iniciarTareas(ctx, { cadaMs = 60000 } = {}) {
  const ciclo = () => {
    try {
      ctx.s.multas.sincronizar();
      ctx.s.coberturas.vencer();
    } catch (e) { console.error('Error en tareas programadas:', e); }
  };
  ciclo();
  const t1 = setInterval(ciclo, cadaMs);
  const t2 = setInterval(() => { try { ctx.s.usuarios.purgarSesiones(); } catch {} }, 6 * 3600000);
  // Aviso a los paneles abiertos cada minuto para refrescar estados que dependen de la hora.
  const t3 = setInterval(() => ctx.bus.emit('cambio', { tipo: 'minuto' }), 60000);
  for (const t of [t1, t2, t3]) t.unref();
  return () => [t1, t2, t3].forEach(clearInterval);
}
