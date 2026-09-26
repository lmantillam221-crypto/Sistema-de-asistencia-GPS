/* API de la app de las colaboradoras (celular). */
import { Router } from 'express';
import { z } from 'zod';
import { validar, ErrorApp } from '../lib/errores.js';
import { COOKIE_APP, autenticar, h } from '../middleware.js';
import { infoVentana } from '../domain/horarios.js';
import { lunesDe, sumarDias, esFecha, aMin } from '../domain/tiempo.js';
import { publico } from '../services/usuarios.js';
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
  const conTienda = (t) => { const ti = ctx.s.tiendas.obtener(t.tienda_id); return { ...t, tienda: ti && { id: ti.id, nombre: ti.nombre, lat: ti.lat, lng: ti.lng, radio_m: ti.radio_m, direccion: ti.direccion } }; };

  /** Todo lo que la pantalla "Hoy" necesita en una sola llamada. */
  r.get('/hoy', h((req, res) => {
    const u = req.usuario, ahora = ctx.reloj.ahora(), aj = ctx.s.empresa.ajustes();
    const mios = ctx.s.turnos.deUsuario(u.id, ahora.fecha, sumarDias(ahora.fecha, 21));
    const hoy = mios.filter((t) => t.fecha === ahora.fecha);
    const abierto = ctx.s.asistencia.turnoAbierto(u.id, ahora.fecha);
    const trabajados = new Map();
    // Turnos de hoy donde la persona tiene marcas (propios o cubiertos)
    for (const t of [...hoy, ...(abierto ? [abierto] : [])]) trabajados.set(t.id, t);
    const cubiertos = ctx.db.prepare("SELECT DISTINCT turno_id FROM marcas WHERE usuario_id = ? AND fecha = ?").all(u.id, ahora.fecha);
    for (const c of cubiertos) if (!trabajados.has(c.turno_id)) trabajados.set(c.turno_id, ctx.s.turnos.obtener(c.turno_id));
    const turnosHoy = [...trabajados.values()].filter(Boolean).sort((a, b) => a.inicio.localeCompare(b.inicio)).map((t) => {
      const ev = ctx.s.asistencia.evaluarTurno(t, ahora);
      const mio = t.usuario_id === u.id ? ev.asignado : ev.cubrieron.find((c) => c.usuarioId === u.id);
      return { ...conTienda(t), propio: t.usuario_id === u.id, ev: mio?.ev ?? null, marcas: mio?.marcas ?? [], reporte: mio?.reporte ?? null };
    });
    const otrosHoy = ctx.s.turnos.deFecha(ahora.fecha).filter((t) => t.usuario_id !== u.id && !trabajados.has(t.id) && aMin(t.fin) > ahora.minutos)
      .map((t) => ({ id: t.id, inicio: t.inicio, fin: t.fin, usuario: t.usuario_nombre, tienda: conTienda(t).tienda }));
    const v = infoVentana(aj.ventana, ahora);
    const multas = ctx.s.multas.listar({ usuarioId: u.id, estado: 'pendiente' });
    const abiertas = ctx.s.coberturas.abiertasPara(u);
    res.json({
      ahora, usuario: publico(u), empresa: ctx.s.empresa.obtener().nombre, demo: ctx.cfg.demo, ajustes: ajustesPublicos(),
      turnosHoy, abierto: abierto?.id ?? null, otrosHoy,
      proximos: mios.filter((t) => t.fecha > ahora.fecha).slice(0, 5).map(conTienda),
      ventana: { ...v, puedeElegir: ctx.s.turnos.puedeElegirSemana(v.semana) || ctx.s.turnos.puedeElegirSemana(sumarDias(lunesDe(ahora.fecha), 7)) },
      multas: { pendiente: multas.reduce((s, m) => s + m.monto, 0), cantidad: multas.length, nuevas: multas.filter((m) => !m.vista) },
      coberturas: abiertas.filter((c) => !c.cruce).length,
    });
  }));

  r.post('/marcas', h((req, res) => {
    const d = validar(esqMarca, req.body);
    const out = ctx.s.asistencia.registrar(req.usuario, d, req.ip);
    res.status(out.repetida ? 200 : 201).json({ marca: out.marca, turnoId: out.turno.id, tienda: out.tienda?.nombre, repetida: out.repetida });
  }));
  r.put('/turnos/:id/reporte', h((req, res) => {
    const d = validar(esqCierre, req.body);
    res.json(ctx.s.asistencia.guardarReporte(req.usuario, Number(req.params.id), d));
  }));

  r.get('/horario', h((req, res) => {
    const u = req.usuario, ahora = ctx.reloj.ahora(), aj = ctx.s.empresa.ajustes();
    const v = infoVentana(aj.ventana, ahora);
    const esta = lunesDe(ahora.fecha);
    let lunes = String(req.query.semana || '');
    if (!esFecha(lunes)) lunes = ctx.s.turnos.puedeElegirSemana(v.semana) ? v.semana : esta;
    lunes = lunesDe(lunes);
    const turnos = ctx.s.turnos.listar({ desde: lunes, hasta: sumarDias(lunes, 6) }).map((t) => ({
      id: t.id, fecha: t.fecha, inicio: t.inicio, fin: t.fin, tienda_id: t.tienda_id, tienda: t.tienda_nombre,
      usuario_id: t.usuario_id, usuario: t.usuario_nombre, mio: t.usuario_id === u.id,
    }));
    res.json({
      lunes, esta, ventana: v, puedeElegir: ctx.s.turnos.puedeElegirSemana(lunes), max: aj.maxTurnosSemana,
      tengo: turnos.filter((t) => t.mio).length, turnos, tiendas: ctx.s.tiendas.listar().map((t) => ({ id: t.id, nombre: t.nombre })),
    });
  }));
  r.post('/turnos/:id/elegir', h((req, res) => res.json(ctx.s.turnos.elegir(req.usuario, Number(req.params.id)))));
  r.delete('/turnos/:id/elegir', h((req, res) => { ctx.s.turnos.soltar(req.usuario, Number(req.params.id)); res.json({ ok: true }); }));

  r.get('/multas', h((req, res) => {
    const lista = ctx.s.multas.listar({ usuarioId: req.usuario.id });
    res.json({ lista, pendiente: ctx.s.multas.pendienteDe(req.usuario.id), multas: ctx.s.empresa.ajustes().multas, tolerancia: ctx.s.empresa.ajustes().toleranciaMin, justificaciones: ctx.s.multas.justificaciones({ usuarioId: req.usuario.id }) });
  }));
  r.post('/multas/vistas', h((req, res) => { ctx.s.multas.marcarVistas(req.usuario.id); res.json({ ok: true }); }));
  r.post('/multas/:id/justificar', h((req, res) => {
    const d = validar(z.object({ motivo: z.string().max(500) }), req.body);
    res.status(201).json({ id: ctx.s.multas.justificar(req.usuario, Number(req.params.id), d.motivo) });
  }));

  r.get('/coberturas', h((req, res) => {
    const hoy = ctx.reloj.ahora().fecha;
    res.json({
      abiertas: ctx.s.coberturas.abiertasPara(req.usuario),
      mias: ctx.s.coberturas.listar({ desde: sumarDias(hoy, -7) }).filter((c) => c.solicitante_id === req.usuario.id || c.tomada_por === req.usuario.id),
    });
  }));
  r.post('/coberturas', h((req, res) => {
    const d = validar(z.object({ turnoId: z.number().int().positive(), motivo: z.string().max(200).optional() }), req.body);
    res.status(201).json({ id: ctx.s.coberturas.solicitar(req.usuario, d.turnoId, d.motivo) });
  }));
  r.post('/coberturas/:id/tomar', h((req, res) => res.json(ctx.s.coberturas.tomar(req.usuario, Number(req.params.id)))));
  r.delete('/coberturas/:id', h((req, res) => { ctx.s.coberturas.cancelar(req.usuario, Number(req.params.id)); res.json({ ok: true }); }));

  r.get('/historial', h((req, res) => {
    const hoy = ctx.reloj.ahora().fecha;
    const desde = esFecha(req.query.desde) ? req.query.desde : hoy.slice(0, 8) + '01';
    const hasta = esFecha(req.query.hasta) ? req.query.hasta : hoy;
    const filas = ctx.s.asistencia.periodo({ desde, hasta, usuarioId: req.usuario.id });
    res.json({ desde, hasta, filas, resumen: ctx.s.asistencia.planilla({ desde, hasta }).find((p) => p.usuarioId === req.usuario.id) || null });
  }));

  r.post('/clave', h((req, res) => {
    const d = validar(z.object({ actual: z.string(), nueva: z.string() }), req.body);
    if (!verificarSecreto(d.actual, req.usuario.secreto)) throw new ErrorApp(400, 'Tu clave actual no es correcta.');
    ctx.s.usuarios.cambiarSecreto(req.usuario.id, d.nueva);
    ctx.s.auditoria.registrar(req.usuario, 'clave_cambiada', 'usuario', req.usuario.id, null, req.ip);
    res.json({ ok: true });
  }));
  return r;
}
