/* Tareas de mantenimiento: multas automáticas, coberturas vencidas y limpieza.
   En el servidor Node corren cada minuto; en Netlify, como función programada (netlify.toml). */
export async function ejecutarTareas(ctx, { limpieza = false } = {}) {
  return ctx.db.exclusivo(async () => {
    await ctx.s.empresa.refrescar();
    const nuevas = await ctx.s.multas.sincronizar();
    await ctx.s.coberturas.vencer();
    if (limpieza) { await ctx.s.usuarios.purgarSesiones(); await ctx.s.auditoria.purgar(); }
    return { multasNuevas: nuevas };
  });
}

export function iniciarTareas(ctx, { cadaMs = 60000 } = {}) {
  let n = 0;
  const ciclo = () => ejecutarTareas(ctx, { limpieza: n++ % 360 === 0 }).catch((e) => console.error('Error en tareas programadas:', e));
  ciclo();
  const t1 = setInterval(ciclo, cadaMs);
  // Aviso a los paneles abiertos cada minuto para refrescar estados que dependen de la hora.
  const t2 = setInterval(() => ctx.bus.emit('cambio', { tipo: 'minuto' }), 60000);
  for (const t of [t1, t2]) t.unref();
  return () => [t1, t2].forEach(clearInterval);
}
