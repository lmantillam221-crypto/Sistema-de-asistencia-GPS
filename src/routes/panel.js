/* API del panel de control (administración y supervisión). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { validar, prohibido, invalido } from '../lib/errores.js';
import { COOKIE_PANEL, autenticar, h, soloRoles } from '../middleware.js';
import { infoVentana } from '../domain/horarios.js';
import { lunesDe, sumarDias, esFecha, DIAS } from '../domain/tiempo.js';
import { publico } from '../services/usuarios.js';
import { enviarCSV } from '../lib/csv.js';
import { importarAnterior, leerFuenteAnterior } from '../lib/importar.js';
import { generarEjemplo, borrarEjemplo } from '../lib/demo.js';
import { verificarSecreto } from '../lib/seguridad.js';

const id = (req) => Number(req.params.id);
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const turnoPlantilla = z.object({ dia: z.number().int().min(0).max(6), inicio: hora, fin: hora, cupos: z.number().int().min(1).max(10).default(1) });
const esqTienda = z.object({
  codigo: z.string().max(20).optional(), nombre: z.string().trim().min(1).max(80), direccion: z.string().max(160).optional(),
  lat: z.number(), lng: z.number(), radio_m: z.number().int().min(10).max(5000), activa: z.boolean().optional(),
});
const esqUsuario = z.object({
  codigo: z.string().max(20).optional(), nombre: z.string().trim().min(1).max(80), telefono: z.string().max(20).optional(),
  rol: z.enum(['admin', 'supervisor', 'colaborador']).default('colaborador'), secreto: z.string().max(100).optional(),
  tienda_id: z.number().int().nullable().optional(), activo: z.boolean().optional(),
});

export function rutasPanel(ctx) {
  const r = Router();
  r.use(autenticar(ctx, COOKIE_PANEL, ['admin', 'supervisor']));
  const admin = soloRoles('admin');
  const hoy = () => ctx.reloj.ahora().fecha;
  const rangoQ = (q, porDefecto = 'mes') => {
    const f = hoy();
    let desde = esFecha(q.desde) ? q.desde : porDefecto === 'mes' ? f.slice(0, 8) + '01' : sumarDias(f, -29);
    let hasta = esFecha(q.hasta) ? q.hasta : f;
    if (desde > hasta) [desde, hasta] = [hasta, desde];
    return { desde, hasta, tiendaId: Number(q.tienda) || null };
  };
  /** Un supervisor solo gestiona colaboradoras; un admin gestiona a todos. */
  const puedeGestionar = (quien, rolObjetivo) => quien.rol === 'admin' || rolObjetivo === 'colaborador';

  r.get('/yo', h((req, res) => {
    const emp = ctx.s.empresa.obtener();
    res.json({ usuario: publico(req.usuario), empresa: { nombre: emp.nombre, rubro: emp.rubro, zona: emp.zona_horaria }, ajustes: emp.ajustes, demo: ctx.cfg.demo, ahora: ctx.reloj.ahora(), relojSimulado: ctx.reloj.simulado });
  }));

  /* Tiempo real: el panel se actualiza solo cuando llega una marca, un cambio de horario, etc. */
  r.get('/stream', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 5000\n\n');
    const enviar = (ev) => res.write(`event: cambio\ndata: ${JSON.stringify(ev)}\n\n`);
    const latido = setInterval(() => res.write(': ping\n\n'), 25000);
    ctx.bus.on('cambio', enviar);
    req.on('close', () => { clearInterval(latido); ctx.bus.off('cambio', enviar); });
  });

  /* ---------- Operación del día ---------- */
  r.get('/dia', h((req, res) => {
    const fecha = esFecha(req.query.fecha) ? req.query.fecha : hoy();
    const d = ctx.s.asistencia.dia(fecha, Number(req.query.tienda) || null);
    res.json({ ...d, recordatorios: ctx.s.recordatorios.listar(), tiendas: ctx.s.tiendas.listar(), coberturas: ctx.s.coberturas.listar({ estado: 'abierta' }), justificacionesPendientes: ctx.s.multas.justificaciones({ estado: 'pendiente' }).length });
  }));
  r.get('/en-vivo', h((req, res) => res.json({ tiendas: ctx.s.tiendas.listar(), posiciones: ctx.s.asistencia.enVivo(), ahora: ctx.reloj.ahora() })));
  r.post('/avisos', h((req, res) => {
    const d = validar(z.object({ clave: z.string().max(120), tipo: z.string().max(30) }), req.body);
    ctx.s.recordatorios.marcar(d.clave, d.tipo, req.usuario);
    res.json({ ok: true });
  }));

  /* ---------- Reportes ---------- */
  r.get('/periodo', h((req, res) => { const q = rangoQ(req.query); res.json({ ...q, filas: ctx.s.asistencia.periodo(q) }); }));
  r.get('/planilla', h((req, res) => { const q = rangoQ(req.query); res.json({ ...q, filas: ctx.s.asistencia.planilla(q) }); }));
  r.get('/export/asistencia.csv', h((req, res) => {
    const q = rangoQ(req.query);
    const filas = ctx.s.asistencia.periodo(q);
    enviarCSV(res, `asistencia_${q.desde}_a_${q.hasta}.csv`, [
      ['Fecha', 'Día', 'Tienda', 'Código', 'Colaborador(a)', 'Turno', 'Entrada', 'Salida', 'Minutos en tienda', 'Minutos tarde', 'Resultado', 'Reportes GPS recibidos', 'Reportes GPS esperados', 'Reportes en tienda', 'Alertas', 'Ventas (n°)', 'Prendas', 'Efectivo', 'Yape/Plin', 'Tarjeta', 'Total vendido', 'Multa'],
      ...filas.map((f) => [f.fecha, DIAS[new Date(f.fecha + 'T12:00:00Z').getUTCDay()], f.tienda, f.codigo, f.nombre, `${f.inicio}-${f.fin}`, f.entrada, f.salida, f.minutosEnLocal ?? '', f.entrada ? f.minutosTarde : '', f.resultado,
        f.recibidos, f.esperados, f.reportesDentro, f.alertas.join(' '), f.ventas ?? '', f.prendas ?? '', f.efectivo ?? '', f.digital ?? '', f.tarjeta ?? '', f.montoVentas ?? '', f.multa ? f.multa.toFixed(2) : '']),
    ]);
  }));
  r.get('/export/planilla.csv', h((req, res) => {
    const q = rangoQ(req.query);
    enviarCSV(res, `planilla_${q.desde}_a_${q.hasta}.csv`, [
      ['Código', 'Colaborador(a)', 'Turnos', 'A tiempo', 'Tardanzas', 'Faltas', 'Coberturas', 'Horas en tienda', 'Asistencia %', 'Puntualidad %', 'GPS en tienda %', 'Ventas (n°)', 'Prendas', 'Total vendido', 'Venta por hora', 'Multas del período', 'Multas pendientes (total)'],
      ...ctx.s.asistencia.planilla(q).map((p) => [p.codigo, p.nombre, p.turnos, p.aTiempo, p.tarde, p.faltas, p.coberturas, (p.minutos / 60).toFixed(2), p.asistencia ?? '', p.puntualidad ?? '', p.gpsEnLocal ?? '', p.ventas, p.prendas, p.monto.toFixed(2), p.ventaPorHora ?? '', p.multas.toFixed(2), p.pendiente.toFixed(2)]),
    ]);
  }));
  r.get('/export/multas.csv', h((req, res) => {
    const lista = ctx.s.multas.listar({ estado: req.query.estado || 'todas' });
    enviarCSV(res, `multas_${hoy()}.csv`, [
      ['Fecha', 'Código', 'Colaborador(a)', 'Tipo', 'Detalle', 'Monto', 'Estado', 'Pagada el', 'Motivo anulación'],
      ...lista.map((m) => [m.fecha, m.usuario_codigo, m.usuario_nombre, m.tipo, m.detalle, m.monto.toFixed(2), m.estado, m.pagada ? new Date(m.pagada).toISOString().slice(0, 10) : '', m.motivo_anulada || '']),
    ]);
  }));

  /* ---------- Horarios ---------- */
  r.get('/semana', h((req, res) => {
    const aj = ctx.s.empresa.ajustes(), ahora = ctx.reloj.ahora();
    const v = infoVentana(aj.ventana, ahora);
    const lunes = lunesDe(esFecha(req.query.lunes) ? req.query.lunes : v.abierta ? v.semana : ahora.fecha);
    const tiendaId = Number(req.query.tienda) || null;
    const turnos = ctx.s.turnos.listar({ desde: lunes, hasta: sumarDias(lunes, 6), tiendaId });
    res.json({
      lunes, ventana: v, turnos, tiendas: ctx.s.tiendas.listar(), colaboradores: ctx.s.usuarios.colaboradores(),
      especiales: ctx.s.tiendas.diasEspeciales({ desde: lunes }).filter((d) => d.fecha <= sumarDias(lunes, 6)),
      texto: ctx.s.turnos.textoSemana(lunes, tiendaId),
    });
  }));
  r.put('/turnos/:id/asignar', h((req, res) => {
    const d = validar(z.object({ usuarioId: z.number().int().positive().nullable() }), req.body);
    res.json(ctx.s.turnos.asignar(id(req), d.usuarioId, req.usuario));
  }));
  r.post('/turnos', h((req, res) => {
    const d = validar(z.object({ tienda_id: z.number().int(), fecha: z.string(), inicio: hora, fin: hora, usuario_id: z.number().int().nullable().optional() }), req.body);
    res.status(201).json(ctx.s.turnos.crearExtra(d, req.usuario));
  }));
  r.delete('/turnos/:id', h((req, res) => { ctx.s.turnos.eliminar(id(req), req.usuario); res.json({ ok: true }); }));
  r.get('/plantillas', h((req, res) => res.json({ tiendas: ctx.s.tiendas.listar(), plantillas: ctx.s.tiendas.todasPlantillas(), especiales: ctx.s.tiendas.diasEspeciales({ desde: sumarDias(hoy(), -30) }) })));
  r.put('/tiendas/:id/plantillas', admin, h((req, res) => {
    const d = validar(z.object({ turnos: z.array(turnoPlantilla).max(100) }), req.body);
    const out = ctx.s.tiendas.guardarPlantillas(id(req), d.turnos);
    ctx.s.auditoria.registrar(req.usuario, 'plantilla_guardada', 'tienda', id(req), { turnos: d.turnos.length });
    res.json(out);
  }));
  r.post('/dias-especiales', admin, h((req, res) => {
    const d = validar(z.object({
      tienda_id: z.number().int().nullable().optional(), fecha: z.string(), cerrado: z.boolean().default(false), motivo: z.string().max(120).default(''),
      turnos: z.array(z.object({ inicio: hora, fin: hora, cupos: z.number().int().min(1).max(10).default(1) })).max(20).default([]),
    }), req.body);
    ctx.s.tiendas.guardarDiaEspecial(d);
    ctx.s.auditoria.registrar(req.usuario, 'dia_especial_guardado', 'fecha', d.fecha, d);
    res.status(201).json({ ok: true });
  }));
  r.delete('/dias-especiales/:id', admin, h((req, res) => { ctx.s.tiendas.borrarDiaEspecial(id(req)); ctx.s.auditoria.registrar(req.usuario, 'dia_especial_borrado', 'dia_especial', id(req)); res.json({ ok: true }); }));

  /* ---------- Tiendas ---------- */
  r.get('/tiendas', h((req, res) => res.json(ctx.s.tiendas.listar({ todas: true }))));
  r.post('/tiendas', admin, h((req, res) => {
    const d = validar(esqTienda, req.body);
    const t = ctx.s.tiendas.crear(d);
    ctx.s.auditoria.registrar(req.usuario, 'tienda_creada', 'tienda', t.id, d);
    res.status(201).json(t);
  }));
  r.put('/tiendas/:id', admin, h((req, res) => {
    const d = validar(esqTienda.partial(), req.body);
    const t = ctx.s.tiendas.actualizar(id(req), d);
    ctx.s.auditoria.registrar(req.usuario, 'tienda_actualizada', 'tienda', t.id, d);
    res.json(t);
  }));

  /* ---------- Equipo ---------- */
  r.get('/usuarios', h((req, res) => res.json({ usuarios: ctx.s.usuarios.listar(), siguiente: ctx.s.usuarios.siguienteCodigo('V') })));
  r.post('/usuarios', h((req, res) => {
    const d = validar(esqUsuario, req.body);
    if (!puedeGestionar(req.usuario, d.rol)) throw prohibido('Solo un administrador puede crear usuarios del panel.');
    if (!d.secreto) throw invalido(d.rol === 'colaborador' ? 'Escribe la clave (PIN).' : 'Escribe la contraseña.');
    const u = ctx.s.usuarios.crear({ ...d, codigo: d.codigo || ctx.s.usuarios.siguienteCodigo('V') });
    ctx.s.auditoria.registrar(req.usuario, 'usuario_creado', 'usuario', u.id, { codigo: u.codigo, rol: u.rol });
    res.status(201).json(u);
  }));
  r.put('/usuarios/:id', h((req, res) => {
    const d = validar(esqUsuario.partial(), req.body);
    const obj = ctx.s.usuarios.porId(id(req));
    if (!obj || !puedeGestionar(req.usuario, obj.rol) || (d.rol && !puedeGestionar(req.usuario, d.rol))) throw prohibido();
    const u = ctx.s.usuarios.actualizar(id(req), d);
    ctx.s.auditoria.registrar(req.usuario, 'usuario_actualizado', 'usuario', u.id, { ...d, secreto: undefined });
    ctx.bus.emit('cambio', { tipo: 'usuarios' });
    res.json(u);
  }));
  r.post('/usuarios/:id/clave', h((req, res) => {
    const d = validar(z.object({ secreto: z.string().max(100) }), req.body);
    const obj = ctx.s.usuarios.porId(id(req));
    if (!obj || !puedeGestionar(req.usuario, obj.rol)) throw prohibido();
    ctx.s.usuarios.cambiarSecreto(obj.id, d.secreto, { debeCambiar: obj.rol !== 'colaborador' && obj.id !== req.usuario.id });
    ctx.s.usuarios.cerrarSesionesDe(obj.id);
    ctx.s.auditoria.registrar(req.usuario, 'clave_restablecida', 'usuario', obj.id);
    res.json({ ok: true });
  }));
  r.post('/usuarios/:id/desvincular', h((req, res) => {
    ctx.s.usuarios.desvincularDispositivo(id(req));
    ctx.s.auditoria.registrar(req.usuario, 'celular_desvinculado', 'usuario', id(req));
    res.json({ ok: true });
  }));
  r.post('/clave', h((req, res) => {
    const d = validar(z.object({ actual: z.string(), nueva: z.string() }), req.body);
    if (!verificarSecreto(d.actual, req.usuario.secreto)) throw invalido('Tu contraseña actual no es correcta.');
    ctx.s.usuarios.cambiarSecreto(req.usuario.id, d.nueva);
    ctx.s.auditoria.registrar(req.usuario, 'clave_cambiada', 'usuario', req.usuario.id, null, req.ip);
    res.json({ ok: true });
  }));

  /* ---------- Multas y justificaciones ---------- */
  r.get('/multas', h((req, res) => res.json({
    lista: ctx.s.multas.listar({ estado: req.query.estado || 'pendiente', usuarioId: Number(req.query.usuario) || null }),
    resumen: ctx.s.multas.resumen(), ajustes: ctx.s.empresa.ajustes().multas,
  })));
  r.post('/multas', h((req, res) => {
    const d = validar(z.object({ usuario_id: z.number().int(), fecha: z.string(), monto: z.number(), detalle: z.string().max(200) }), req.body);
    if (!esFecha(d.fecha)) throw invalido('Fecha inválida.');
    res.status(201).json(ctx.s.multas.crearManual(d, req.usuario));
  }));
  r.post('/multas/:id/estado', h((req, res) => {
    const d = validar(z.object({ estado: z.enum(['pendiente', 'pagada', 'anulada']), motivo: z.string().max(200).optional() }), req.body);
    res.json(ctx.s.multas.cambiarEstado(id(req), d.estado, req.usuario, d.motivo));
  }));
  r.post('/multas/:id/notificada', h((req, res) => { ctx.s.multas.marcarNotificada(id(req)); res.json({ ok: true }); }));
  r.post('/usuarios/:id/pagar-todo', h((req, res) => res.json({ pagadas: ctx.s.multas.pagarTodo(id(req), req.usuario) })));
  r.get('/justificaciones', h((req, res) => res.json(ctx.s.multas.justificaciones({ estado: req.query.estado || null }))));
  r.post('/justificaciones/:id/resolver', h((req, res) => {
    const d = validar(z.object({ aprobar: z.boolean(), respuesta: z.string().max(300).optional() }), req.body);
    ctx.s.multas.resolverJustificacion(id(req), d.aprobar, d.respuesta, req.usuario);
    res.json({ ok: true });
  }));
  r.get('/coberturas', h((req, res) => res.json(ctx.s.coberturas.listar({ desde: sumarDias(hoy(), -30) }))));
  r.delete('/coberturas/:id', h((req, res) => { ctx.s.coberturas.cancelar(req.usuario, id(req), true); res.json({ ok: true }); }));

  /* ---------- Configuración ---------- */
  r.get('/ajustes', h((req, res) => res.json(ctx.s.empresa.obtener())));
  r.put('/ajustes', admin, h((req, res) => {
    const d = validar(z.object({ nombre: z.string().max(80).optional(), rubro: z.string().max(80).optional(), zona_horaria: z.string().max(60).optional(), ajustes: z.record(z.any()).optional() }), req.body);
    const emp = ctx.s.empresa.actualizar(d);
    ctx.s.auditoria.registrar(req.usuario, 'ajustes_guardados', 'empresa', 1, d);
    res.json(emp);
  }));
  r.get('/auditoria', admin, h((req, res) => res.json(ctx.s.auditoria.listar({ limite: Number(req.query.limite) || 300, antesDe: Number(req.query.antes) || null }))));
  r.get('/respaldo', admin, h((req, res) => {
    const tmp = path.join(os.tmpdir(), `respaldo-${Date.now()}.db`);
    ctx.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    ctx.s.auditoria.registrar(req.usuario, 'respaldo_descargado', null, null, null, req.ip);
    res.download(tmp, `asistencia-respaldo-${hoy()}.db`, () => fs.rm(tmp, { force: true }, () => {}));
  }));
  r.post('/importar-anterior', admin, h((req, res) => {
    const d = validar(z.object({ texto: z.string().min(10).max(20e6) }), req.body);
    let datos;
    try { datos = leerFuenteAnterior(d.texto); } catch (e) { throw invalido(e.message); }
    res.json(importarAnterior(ctx, datos, req.usuario));
  }));

  /* ---------- Modo demostración ---------- */
  if (ctx.cfg.demo) {
    r.post('/demo/reloj', admin, h((req, res) => {
      const d = validar(z.object({ fecha: z.string().optional(), hora: hora.optional() }), req.body);
      if (d.fecha && !esFecha(d.fecha)) throw invalido('Fecha inválida.');
      ctx.reloj.simular(d.fecha || null, d.hora || '12:00');
      ctx.s.multas.sincronizar();
      ctx.bus.emit('cambio', { tipo: 'reloj' });
      res.json({ ahora: ctx.reloj.ahora(), simulado: ctx.reloj.simulado });
    }));
    r.post('/demo/ejemplo', admin, h((req, res) => res.json({ marcas: generarEjemplo(ctx) })));
    r.delete('/demo/ejemplo', admin, h((req, res) => { borrarEjemplo(ctx); res.json({ ok: true }); }));
    r.get('/demo/accesos', h((req, res) => res.json(ctx.s.usuarios.colaboradores().map((u) => ({ codigo: u.codigo, nombre: u.nombre })))));
  }
  return r;
}

