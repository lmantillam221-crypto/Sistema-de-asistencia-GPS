/* API del panel de control (administración y supervisión). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from '../lib/enrutador.js';
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
import { volcar } from '../lib/respaldo.js';

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
    // Tope de un año por consulta: los reportes responden rápido aunque haya muchos años de historial.
    if (desde < sumarDias(hasta, -366)) desde = sumarDias(hasta, -366);
    return { desde, hasta, tiendaId: Number(q.tienda) || null };
  };
  /** Un supervisor solo gestiona colaboradoras; un admin gestiona a todos. */
  const puedeGestionar = (quien, rolObjetivo) => quien.rol === 'admin' || rolObjetivo === 'colaborador';

  r.get('/yo', h(async (req, res) => {
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
  r.get('/dia', h(async (req, res) => {
    const fecha = esFecha(req.query.fecha) ? req.query.fecha : hoy();
    await ctx.s.turnos.asegurarRango(fecha, fecha);
    const [d, recordatorios, tiendas, coberturas, justificaciones] = await Promise.all([
      ctx.s.asistencia.dia(fecha, Number(req.query.tienda) || null), ctx.s.recordatorios.listar(), ctx.s.tiendas.listar(),
      ctx.s.coberturas.listar({ estado: 'abierta' }), ctx.s.multas.justificaciones({ estado: 'pendiente' }),
    ]);
    res.json({ ...d, recordatorios, tiendas, coberturas, justificacionesPendientes: justificaciones.length });
  }));
  r.get('/en-vivo', h(async (req, res) => {
    const [tiendas, posiciones] = await Promise.all([ctx.s.tiendas.listar(), ctx.s.asistencia.enVivo()]);
    res.json({ tiendas, posiciones, ahora: ctx.reloj.ahora() });
  }));
  r.post('/avisos', h(async (req, res) => {
    const d = validar(z.object({ clave: z.string().max(120), tipo: z.string().max(30) }), req.body);
    await ctx.s.recordatorios.marcar(d.clave, d.tipo, req.usuario);
    res.json({ ok: true });
  }));

  /* ---------- Reportes ---------- */
  r.get('/periodo', h(async (req, res) => { const q = rangoQ(req.query); res.json({ ...q, filas: await ctx.s.asistencia.periodo(q) }); }));
  r.get('/planilla', h(async (req, res) => { const q = rangoQ(req.query); res.json({ ...q, filas: await ctx.s.asistencia.planilla(q) }); }));
  r.get('/export/asistencia.csv', h(async (req, res) => {
    const q = rangoQ(req.query);
    const filas = await ctx.s.asistencia.periodo(q);
    enviarCSV(res, `asistencia_${q.desde}_a_${q.hasta}.csv`, [
      ['Fecha', 'Día', 'Tienda', 'Código', 'Colaborador(a)', 'Turno', 'Entrada', 'Salida', 'Minutos en tienda', 'Minutos tarde', 'Resultado', 'Reportes GPS recibidos', 'Reportes GPS esperados', 'Reportes en tienda', 'Alertas', 'Ventas (n°)', 'Prendas', 'Efectivo', 'Yape/Plin', 'Tarjeta', 'Total vendido', 'Multa'],
      ...filas.map((f) => [f.fecha, DIAS[new Date(f.fecha + 'T12:00:00Z').getUTCDay()], f.tienda, f.codigo, f.nombre, `${f.inicio}-${f.fin}`, f.entrada, f.salida, f.minutosEnLocal ?? '', f.entrada ? f.minutosTarde : '', f.resultado,
        f.recibidos, f.esperados, f.reportesDentro, f.alertas.join(' '), f.ventas ?? '', f.prendas ?? '', f.efectivo ?? '', f.digital ?? '', f.tarjeta ?? '', f.montoVentas ?? '', f.multa ? f.multa.toFixed(2) : '']),
    ]);
  }));
  r.get('/export/planilla.csv', h(async (req, res) => {
    const q = rangoQ(req.query);
    enviarCSV(res, `planilla_${q.desde}_a_${q.hasta}.csv`, [
      ['Código', 'Colaborador(a)', 'Turnos', 'A tiempo', 'Tardanzas', 'Faltas', 'Coberturas', 'Horas en tienda', 'Asistencia %', 'Puntualidad %', 'GPS en tienda %', 'Ventas (n°)', 'Prendas', 'Total vendido', 'Venta por hora', 'Multas del período', 'Multas pendientes (total)'],
      ...(await ctx.s.asistencia.planilla(q)).map((p) => [p.codigo, p.nombre, p.turnos, p.aTiempo, p.tarde, p.faltas, p.coberturas, (p.minutos / 60).toFixed(2), p.asistencia ?? '', p.puntualidad ?? '', p.gpsEnLocal ?? '', p.ventas, p.prendas, p.monto.toFixed(2), p.ventaPorHora ?? '', p.multas.toFixed(2), p.pendiente.toFixed(2)]),
    ]);
  }));
  r.get('/export/multas.csv', h(async (req, res) => {
    const lista = await ctx.s.multas.listar({ estado: req.query.estado || 'todas' });
    enviarCSV(res, `multas_${hoy()}.csv`, [
      ['Fecha', 'Código', 'Colaborador(a)', 'Tipo', 'Detalle', 'Monto', 'Estado', 'Pagada el', 'Motivo anulación'],
      ...lista.map((m) => [m.fecha, m.usuario_codigo, m.usuario_nombre, m.tipo, m.detalle, m.monto.toFixed(2), m.estado, m.pagada ? new Date(m.pagada).toISOString().slice(0, 10) : '', m.motivo_anulada || '']),
    ]);
  }));

  /* ---------- Horarios ---------- */
  r.get('/semana', h(async (req, res) => {
    const aj = ctx.s.empresa.ajustes(), ahora = ctx.reloj.ahora();
    const v = infoVentana(aj.ventana, ahora);
    // El día de elección (domingo) se trabaja directamente sobre la semana siguiente.
    const lunes = lunesDe(esFecha(req.query.lunes) ? req.query.lunes : v.abierta || v.esHoy ? v.semana : ahora.fecha);
    const tiendaId = Number(req.query.tienda) || null;
    await ctx.s.turnos.asegurarRango(lunes, sumarDias(lunes, 6));
    const [turnos, tiendas, colaboradores, especiales, texto] = await Promise.all([
      ctx.s.turnos.listar({ desde: lunes, hasta: sumarDias(lunes, 6), tiendaId }), ctx.s.tiendas.listar(), ctx.s.usuarios.colaboradores(),
      ctx.s.tiendas.diasEspeciales({ desde: lunes }), ctx.s.turnos.textoSemana(lunes, tiendaId),
    ]);
    res.json({ lunes, ventana: v, turnos, tiendas, colaboradores, especiales: especiales.filter((d) => d.fecha <= sumarDias(lunes, 6)), texto });
  }));
  r.put('/turnos/:id/asignar', h(async (req, res) => {
    const d = validar(z.object({ usuarioId: z.number().int().positive().nullable() }), req.body);
    res.json(await ctx.s.turnos.asignar(id(req), d.usuarioId, req.usuario));
  }));
  r.post('/turnos', h(async (req, res) => {
    const d = validar(z.object({ tienda_id: z.number().int(), fecha: z.string(), inicio: hora, fin: hora, usuario_id: z.number().int().nullable().optional() }), req.body);
    res.status(201).json(await ctx.s.turnos.crearExtra(d, req.usuario));
  }));
  r.delete('/turnos/:id', h(async (req, res) => { await ctx.s.turnos.eliminar(id(req), req.usuario); res.json({ ok: true }); }));
  r.get('/plantillas', h(async (req, res) => res.json({ tiendas: await ctx.s.tiendas.listar(), plantillas: await ctx.s.tiendas.todasPlantillas(), especiales: await ctx.s.tiendas.diasEspeciales({ desde: sumarDias(hoy(), -30) }) })));
  r.put('/tiendas/:id/plantillas', admin, h(async (req, res) => {
    const d = validar(z.object({ turnos: z.array(turnoPlantilla).max(100) }), req.body);
    const out = await ctx.s.tiendas.guardarPlantillas(id(req), d.turnos);
    await ctx.s.auditoria.registrar(req.usuario, 'plantilla_guardada', 'tienda', id(req), { turnos: d.turnos.length });
    res.json(out);
  }));
  r.post('/dias-especiales', admin, h(async (req, res) => {
    const d = validar(z.object({
      tienda_id: z.number().int().nullable().optional(), fecha: z.string(), cerrado: z.boolean().default(false), motivo: z.string().max(120).default(''),
      turnos: z.array(z.object({ inicio: hora, fin: hora, cupos: z.number().int().min(1).max(10).default(1) })).max(20).default([]),
    }), req.body);
    await ctx.s.tiendas.guardarDiaEspecial(d);
    await ctx.s.auditoria.registrar(req.usuario, 'dia_especial_guardado', 'fecha', d.fecha, d);
    res.status(201).json({ ok: true });
  }));
  r.delete('/dias-especiales/:id', admin, h(async (req, res) => { await ctx.s.tiendas.borrarDiaEspecial(id(req)); await ctx.s.auditoria.registrar(req.usuario, 'dia_especial_borrado', 'dia_especial', id(req)); res.json({ ok: true }); }));

  /* ---------- Tiendas ---------- */
  r.get('/tiendas', h(async (req, res) => res.json(await ctx.s.tiendas.listar({ todas: true }))));
  r.post('/tiendas', admin, h(async (req, res) => {
    const d = validar(esqTienda, req.body);
    const t = await ctx.s.tiendas.crear(d);
    await ctx.s.auditoria.registrar(req.usuario, 'tienda_creada', 'tienda', t.id, d);
    res.status(201).json(t);
  }));
  r.put('/tiendas/:id', admin, h(async (req, res) => {
    const d = validar(esqTienda.partial(), req.body);
    const t = await ctx.s.tiendas.actualizar(id(req), d);
    await ctx.s.auditoria.registrar(req.usuario, 'tienda_actualizada', 'tienda', t.id, d);
    res.json(t);
  }));

  /* ---------- Equipo ---------- */
  r.get('/usuarios', h(async (req, res) => res.json({ usuarios: await ctx.s.usuarios.listar(), siguiente: await ctx.s.usuarios.siguienteCodigo('V') })));
  r.post('/usuarios', h(async (req, res) => {
    const d = validar(esqUsuario, req.body);
    if (!puedeGestionar(req.usuario, d.rol)) throw prohibido('Solo un administrador puede crear usuarios del panel.');
    if (!d.secreto) throw invalido(d.rol === 'colaborador' ? 'Escribe la clave (PIN).' : 'Escribe la contraseña.');
    const u = await ctx.s.usuarios.crear({ ...d, codigo: d.codigo || await ctx.s.usuarios.siguienteCodigo('V') });
    await ctx.s.auditoria.registrar(req.usuario, 'usuario_creado', 'usuario', u.id, { codigo: u.codigo, rol: u.rol });
    res.status(201).json(u);
  }));
  r.put('/usuarios/:id', h(async (req, res) => {
    const d = validar(esqUsuario.partial(), req.body);
    const obj = await ctx.s.usuarios.porId(id(req));
    if (!obj || !puedeGestionar(req.usuario, obj.rol) || (d.rol && !puedeGestionar(req.usuario, d.rol))) throw prohibido();
    const u = await ctx.s.usuarios.actualizar(id(req), d);
    await ctx.s.auditoria.registrar(req.usuario, 'usuario_actualizado', 'usuario', u.id, { ...d, secreto: undefined });
    ctx.bus.emit('cambio', { tipo: 'usuarios' });
    res.json(u);
  }));
  r.post('/usuarios/:id/clave', h(async (req, res) => {
    const d = validar(z.object({ secreto: z.string().max(100) }), req.body);
    const obj = await ctx.s.usuarios.porId(id(req));
    if (!obj || !puedeGestionar(req.usuario, obj.rol)) throw prohibido();
    await ctx.s.usuarios.cambiarSecreto(obj.id, d.secreto, { debeCambiar: obj.rol !== 'colaborador' && obj.id !== req.usuario.id });
    await ctx.s.usuarios.cerrarSesionesDe(obj.id);
    await ctx.s.auditoria.registrar(req.usuario, 'clave_restablecida', 'usuario', obj.id);
    res.json({ ok: true });
  }));
  r.post('/usuarios/:id/desvincular', h(async (req, res) => {
    await ctx.s.usuarios.desvincularDispositivo(id(req));
    await ctx.s.auditoria.registrar(req.usuario, 'celular_desvinculado', 'usuario', id(req));
    res.json({ ok: true });
  }));
  r.post('/clave', h(async (req, res) => {
    const d = validar(z.object({ actual: z.string(), nueva: z.string() }), req.body);
    if (!(await verificarSecreto(d.actual, req.usuario.secreto))) throw invalido('Tu contraseña actual no es correcta.');
    await ctx.s.usuarios.cambiarSecreto(req.usuario.id, d.nueva);
    await ctx.s.auditoria.registrar(req.usuario, 'clave_cambiada', 'usuario', req.usuario.id, null, req.ip);
    res.json({ ok: true });
  }));

  /* ---------- Multas y justificaciones ---------- */
  r.get('/multas', h(async (req, res) => res.json({
    lista: await ctx.s.multas.listar({ estado: req.query.estado || 'pendiente', usuarioId: Number(req.query.usuario) || null }),
    resumen: await ctx.s.multas.resumen(), ajustes: ctx.s.empresa.ajustes().multas,
  })));
  r.post('/multas', h(async (req, res) => {
    const d = validar(z.object({ usuario_id: z.number().int(), fecha: z.string(), monto: z.number(), detalle: z.string().max(200) }), req.body);
    if (!esFecha(d.fecha)) throw invalido('Fecha inválida.');
    res.status(201).json(await ctx.s.multas.crearManual(d, req.usuario));
  }));
  r.post('/multas/:id/estado', h(async (req, res) => {
    const d = validar(z.object({ estado: z.enum(['pendiente', 'pagada', 'anulada']), motivo: z.string().max(200).optional() }), req.body);
    res.json(await ctx.s.multas.cambiarEstado(id(req), d.estado, req.usuario, d.motivo));
  }));
  r.post('/multas/:id/notificada', h(async (req, res) => { await ctx.s.multas.marcarNotificada(id(req)); res.json({ ok: true }); }));
  r.post('/usuarios/:id/pagar-todo', h(async (req, res) => res.json({ pagadas: await ctx.s.multas.pagarTodo(id(req), req.usuario) })));
  r.get('/justificaciones', h(async (req, res) => res.json(await ctx.s.multas.justificaciones({ estado: req.query.estado || null }))));
  r.post('/justificaciones/:id/resolver', h(async (req, res) => {
    const d = validar(z.object({ aprobar: z.boolean(), respuesta: z.string().max(300).optional() }), req.body);
    await ctx.s.multas.resolverJustificacion(id(req), d.aprobar, d.respuesta, req.usuario);
    res.json({ ok: true });
  }));
  r.get('/coberturas', h(async (req, res) => res.json(await ctx.s.coberturas.listar({ desde: sumarDias(hoy(), -30) }))));
  r.delete('/coberturas/:id', h(async (req, res) => { await ctx.s.coberturas.cancelar(req.usuario, id(req), true); res.json({ ok: true }); }));

  /* ---------- Configuración ---------- */
  r.get('/ajustes', h(async (req, res) => res.json(ctx.s.empresa.obtener())));
  r.put('/ajustes', admin, h(async (req, res) => {
    const d = validar(z.object({ nombre: z.string().max(80).optional(), rubro: z.string().max(80).optional(), zona_horaria: z.string().max(60).optional(), ajustes: z.record(z.any()).optional() }), req.body);
    const emp = await ctx.s.empresa.actualizar(d);
    await ctx.s.auditoria.registrar(req.usuario, 'ajustes_guardados', 'empresa', 1, d);
    res.json(emp);
  }));
  r.get('/auditoria', admin, h(async (req, res) => res.json(await ctx.s.auditoria.listar({ limite: Number(req.query.limite) || 300, antesDe: Number(req.query.antes) || null }))));
  r.get('/respaldo', admin, h(async (req, res) => {
    await ctx.s.auditoria.registrar(req.usuario, 'respaldo_descargado', null, null, null, req.ip);
    if (ctx.db.tipo === 'sqlite' && typeof ctx.db.crudo.exportar === 'function') { // demo en el navegador (sql.js)
      res.setHeader('Content-Type', 'application/vnd.sqlite3');
      res.setHeader('Content-Disposition', `attachment; filename="asistencia-respaldo-${hoy()}.db"`);
      return res.send(ctx.db.crudo.exportar());
    }
    if (ctx.db.tipo === 'sqlite') { // servidor propio: copia exacta del archivo SQLite
      const tmp = path.join(os.tmpdir(), `respaldo-${Date.now()}.db`);
      await ctx.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      return res.download(tmp, `asistencia-respaldo-${hoy()}.db`, () => fs.rm(tmp, { force: true }, () => {}));
    }
    // PostgreSQL: volcado completo en JSON (además de las copias automáticas del proveedor)
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="asistencia-respaldo-${hoy()}.json"`);
    res.send(JSON.stringify(await volcar(ctx.db)));
  }));
  r.post('/importar-anterior', admin, h(async (req, res) => {
    const d = validar(z.object({ texto: z.string().min(10).max(20e6) }), req.body);
    let datos;
    try { datos = leerFuenteAnterior(d.texto); } catch (e) { throw invalido(e.message); }
    res.json(await importarAnterior(ctx, datos, req.usuario));
  }));

  /* ---------- Modo demostración ---------- */
  if (ctx.cfg.demo) {
    r.post('/demo/reloj', admin, h(async (req, res) => {
      const d = validar(z.object({ fecha: z.string().optional(), hora: hora.optional() }), req.body);
      if (d.fecha && !esFecha(d.fecha)) throw invalido('Fecha inválida.');
      ctx.reloj.simular(d.fecha || null, d.hora || '12:00');
      await ctx.s.multas.sincronizar();
      ctx.bus.emit('cambio', { tipo: 'reloj' });
      res.json({ ahora: ctx.reloj.ahora(), simulado: ctx.reloj.simulado });
    }));
    r.post('/demo/ejemplo', admin, h(async (req, res) => res.json({ marcas: await generarEjemplo(ctx) })));
    r.delete('/demo/ejemplo', admin, h(async (req, res) => { await borrarEjemplo(ctx); res.json({ ok: true }); }));
    r.get('/demo/accesos', h(async (req, res) => res.json((await ctx.s.usuarios.colaboradores()).map((u) => ({ codigo: u.codigo, nombre: u.nombre })))));
  }
  return r;
}

