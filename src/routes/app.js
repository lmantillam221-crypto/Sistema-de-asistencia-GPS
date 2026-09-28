/* API de la app de las colaboradoras (celular). */
import { Router } from '../lib/enrutador.js';
import { z } from 'zod';
import { validar, ErrorApp } from '../lib/errores.js';
import { COOKIE_APP, autenticar, h } from '../middleware.js';
import { infoVentana } from '../domain/horarios.js';
import { lunesDe, sumarDias, esFecha, aMin } from '../domain/tiempo.js';
import { publico } from '../services/usuarios.js';
import { evaluar } from '../domain/asistencia.js';
import { verificarSecreto } from '../lib/seguridad.js';

const num = z.number().finite();
const monto = z.number().min(0).max(1e6).nullable().optional();
const esqCierre = z.object({
  cierre: z.array(z.string().max(120)).max(20).optional(),
  ventas: z.number().int().min(0).max(10000).nullable().optional(),
  prendas: z.number().int().min(0).max(100000).nullable().optional(),
  efectivo: monto, digital: monto, tarjeta: monto,
  nota: z.string().max(500).optional(),
});
const esqMarca = z.object({
  tipo: z.enum(['entrada', 'control', 'salida']),
  lat: num, lng: num, precision: num.optional(),
  capturado: z.number().int().positive().optional(),
  dispositivo: z.string().max(80).optional(),
  turnoId: z.number().int().positive().optional(),
  apertura: z.array(z.string().max(120)).max(20).optional(),
  cierre: esqCierre.optional(),
  simulado: z.boolean().optional(),
});

export function rutasApp(ctx) {
  const r = Router();
  r.use(autenticar(ctx, COOKIE_APP));

  const ajustesPublicos = () => {
    const a = ctx.s.empresa.ajustes();
    return {
      intervaloControlMin: a.intervaloControlMin, toleranciaMin: a.toleranciaMin, precisionMaximaM: a.precisionMaximaM,
      maxTurnosSemana: a.maxTurnosSemana, ventana: a.ventana, multas: a.multas, permitirCubrir: a.permitirCubrir,
      registrarVentas: a.registrarVentas, checklistApertura: a.checklistApertura, checklistCierre: a.checklistCierre,
      exigirUbicacionEnEntrada: a.exigirUbicacionEnEntrada,
    };
  };
  /** Todo lo que la pantalla "Hoy" necesita en una sola llamada (consultas en lote). */
  r.get('/hoy', h(async (req, res) => {
    const u = req.usuario, ahora = ctx.reloj.ahora(), aj = ctx.s.empresa.ajustes();
    const tiendas = new Map((await ctx.s.tiendas.listar({ todas: true })).map((ti) => [ti.id, ti]));
    const conTienda = (t) => { const ti = tiendas.get(t.tienda_id); return { ...t, tienda: ti && { id: ti.id, nombre: ti.nombre, lat: ti.lat, lng: ti.lng, radio_m: ti.radio_m, direccion: ti.direccion } }; };
    const mios = await ctx.s.turnos.deUsuario(u.id, ahora.fecha, sumarDias(ahora.fecha, 21));
    const delDia = await ctx.s.turnos.deFecha(ahora.fecha);
    const abierto = await ctx.s.asistencia.turnoAbierto(u.id, ahora.fecha);
    const trabajados = new Map();
    // Turnos de hoy donde la persona tiene marcas (propios o cubiertos)
    for (const t of [...mios.filter((t) => t.fecha === ahora.fecha), ...(abierto ? [abierto] : [])]) trabajados.set(t.id, t);
    const cubiertos = await ctx.db.prepare('SELECT DISTINCT turno_id FROM marcas WHERE usuario_id = ? AND fecha = ?').all(u.id, ahora.fecha);
    for (const c of cubiertos) if (!trabajados.has(c.turno_id)) trabajados.set(c.turno_id, delDia.find((t) => t.id === c.turno_id) || await ctx.s.turnos.obtener(c.turno_id));
    const lista = [...trabajados.values()].filter(Boolean).sort((a, b) => a.inicio.localeCompare(b.inicio));
    const lote = await ctx.s.asistencia.cargarLote(lista);
    const aj2 = aj;
    const turnosHoy = lista.map((t) => {
      const ms = lote.marcas.get(t.id + '|' + u.id) || [];
      const tieneTurno = t.usuario_id === u.id;
      const ev = ms.length || tieneTurno ? evaluar(ms, t, ahora, aj2) : null;
      return { ...conTienda(t), propio: tieneTurno, ev, marcas: ms, reporte: lote.reportes.get(t.id + '|' + u.id) || null };
    });
    const otrosHoy = delDia.filter((t) => t.usuario_id !== u.id && !trabajados.has(t.id) && aMin(t.fin) > ahora.minutos)
      .map((t) => ({ id: t.id, inicio: t.inicio, fin: t.fin, usuario: t.usuario_nombre, tienda: conTienda(t).tienda }));
    const v = infoVentana(aj.ventana, ahora);
    const multas = await ctx.s.multas.listar({ usuarioId: u.id, estado: 'pendiente' });
    const abiertas = await ctx.s.coberturas.abiertasPara(u);
    res.json({
      ahora, usuario: publico(u), empresa: ctx.s.empresa.obtener().nombre, demo: ctx.cfg.demo, ajustes: ajustesPublicos(),
      turnosHoy, abierto: abierto?.id ?? null, otrosHoy,
      proximos: mios.filter((t) => t.fecha > ahora.fecha).slice(0, 5).map(conTienda),
      ventana: { ...v, puedeElegir: ctx.s.turnos.puedeElegirSemana(v.semana) || ctx.s.turnos.puedeElegirSemana(sumarDias(lunesDe(ahora.fecha), 7)) },
      multas: { pendiente: multas.reduce((s, m) => s + m.monto, 0), cantidad: multas.length, nuevas: multas.filter((m) => !m.vista) },
      coberturas: abiertas.filter((c) => !c.cruce).length,
    });
  }));

  r.post('/marcas', h(async (req, res) => {
    const d = validar(esqMarca, req.body);
    const out = await ctx.s.asistencia.registrar(req.usuario, d, req.ip);
    res.status(out.repetida ? 200 : 201).json({ marca: out.marca, turnoId: out.turno.id, tienda: out.tienda?.nombre, repetida: out.repetida });
  }));
  r.put('/turnos/:id/reporte', h(async (req, res) => {
    const d = validar(esqCierre, req.body);
    res.json(await ctx.s.asistencia.guardarReporte(req.usuario, Number(req.params.id), d));
  }));

  r.get('/horario', h(async (req, res) => {
    const u = req.usuario, ahora = ctx.reloj.ahora(), aj = ctx.s.empresa.ajustes();
    const v = infoVentana(aj.ventana, ahora);
    const esta = lunesDe(ahora.fecha);
    let lunes = String(req.query.semana || '');
    if (!esFecha(lunes)) lunes = ctx.s.turnos.puedeElegirSemana(v.semana) ? v.semana : esta;
    lunes = lunesDe(lunes);
    const turnos = (await ctx.s.turnos.listar({ desde: lunes, hasta: sumarDias(lunes, 6) })).map((t) => ({
      id: t.id, fecha: t.fecha, inicio: t.inicio, fin: t.fin, tienda_id: t.tienda_id, tienda: t.tienda_nombre,
      usuario_id: t.usuario_id, usuario: t.usuario_nombre, mio: t.usuario_id === u.id,
    }));
    res.json({
      lunes, esta, ventana: v, puedeElegir: ctx.s.turnos.puedeElegirSemana(lunes), max: aj.maxTurnosSemana,
      tengo: turnos.filter((t) => t.mio).length, turnos, tiendas: (await ctx.s.tiendas.listar()).map((t) => ({ id: t.id, nombre: t.nombre })),
    });
  }));
  r.post('/turnos/:id/elegir', h(async (req, res) => res.json(await ctx.s.turnos.elegir(req.usuario, Number(req.params.id)))));
  r.delete('/turnos/:id/elegir', h(async (req, res) => { await ctx.s.turnos.soltar(req.usuario, Number(req.params.id)); res.json({ ok: true }); }));

  r.get('/multas', h(async (req, res) => {
    const aj = ctx.s.empresa.ajustes();
    res.json({
      lista: await ctx.s.multas.listar({ usuarioId: req.usuario.id }), pendiente: await ctx.s.multas.pendienteDe(req.usuario.id),
      multas: aj.multas, tolerancia: aj.toleranciaMin, justificaciones: await ctx.s.multas.justificaciones({ usuarioId: req.usuario.id }),
    });
  }));
  r.post('/multas/vistas', h(async (req, res) => { await ctx.s.multas.marcarVistas(req.usuario.id); res.json({ ok: true }); }));
  r.post('/multas/:id/justificar', h(async (req, res) => {
    const d = validar(z.object({ motivo: z.string().max(500) }), req.body);
    res.status(201).json({ id: await ctx.s.multas.justificar(req.usuario, Number(req.params.id), d.motivo) });
  }));

  r.get('/coberturas', h(async (req, res) => {
    const hoy = ctx.reloj.ahora().fecha;
    res.json({
      abiertas: await ctx.s.coberturas.abiertasPara(req.usuario),
      mias: (await ctx.s.coberturas.listar({ desde: sumarDias(hoy, -7) })).filter((c) => c.solicitante_id === req.usuario.id || c.tomada_por === req.usuario.id),
    });
  }));
  r.post('/coberturas', h(async (req, res) => {
    const d = validar(z.object({ turnoId: z.number().int().positive(), motivo: z.string().max(200).optional() }), req.body);
    res.status(201).json({ id: await ctx.s.coberturas.solicitar(req.usuario, d.turnoId, d.motivo) });
  }));
  r.post('/coberturas/:id/tomar', h(async (req, res) => res.json(await ctx.s.coberturas.tomar(req.usuario, Number(req.params.id)))));
  r.delete('/coberturas/:id', h(async (req, res) => { await ctx.s.coberturas.cancelar(req.usuario, Number(req.params.id)); res.json({ ok: true }); }));

  r.get('/historial', h(async (req, res) => {
    const hoy = ctx.reloj.ahora().fecha;
    const desde = esFecha(req.query.desde) ? req.query.desde : hoy.slice(0, 8) + '01';
    const hasta = esFecha(req.query.hasta) ? req.query.hasta : hoy;
    const filas = await ctx.s.asistencia.periodo({ desde, hasta, usuarioId: req.usuario.id });
    res.json({ desde, hasta, filas, resumen: (await ctx.s.asistencia.planilla({ desde, hasta, usuarioId: req.usuario.id }))[0] || null });
  }));

  r.post('/clave', h(async (req, res) => {
    const d = validar(z.object({ actual: z.string(), nueva: z.string() }), req.body);
    if (!(await verificarSecreto(d.actual, req.usuario.secreto))) throw new ErrorApp(400, 'Tu clave actual no es correcta.');
    await ctx.s.usuarios.cambiarSecreto(req.usuario.id, d.nueva);
    await ctx.s.auditoria.registrar(req.usuario, 'clave_cambiada', 'usuario', req.usuario.id, null, req.ip);
    res.json({ ok: true });
  }));
  return r;
}
