import { EventEmitter } from 'node:events';
import { abrirDB } from '../db/index.js';
import { crearReloj } from '../domain/tiempo.js';
import { servicioEmpresa } from './empresa.js';
import { servicioAuditoria } from './auditoria.js';
import { servicioUsuarios } from './usuarios.js';
import { servicioTiendas } from './tiendas.js';
import { servicioTurnos } from './turnos.js';
import { servicioAsistencia } from './asistencia.js';
import { servicioMultas } from './multas.js';
import { servicioCoberturas } from './coberturas.js';
import { servicioRecordatorios } from './recordatorios.js';
import { pinAleatorio } from '../lib/seguridad.js';

/** Crea el contexto de la aplicación: base de datos, reloj, bus de eventos y servicios. */
export function crearContexto(cfg, { db = null, ahora } = {}) {
  const ctx = { cfg, db: db || abrirDB(cfg.dbPath), reloj: crearReloj({ ahora }), bus: new EventEmitter(), s: {} };
  ctx.bus.setMaxListeners(500);
  ctx.s.empresa = servicioEmpresa(ctx);
  ctx.s.auditoria = servicioAuditoria(ctx);
  ctx.s.usuarios = servicioUsuarios(ctx);
  ctx.s.tiendas = servicioTiendas(ctx);
  ctx.s.turnos = servicioTurnos(ctx);
  ctx.s.asistencia = servicioAsistencia(ctx);
  ctx.s.multas = servicioMultas(ctx);
  ctx.s.coberturas = servicioCoberturas(ctx);
  ctx.s.recordatorios = servicioRecordatorios(ctx);
  inicializar(ctx);
  return ctx;
}

/** Primer arranque: datos de la empresa y primer administrador. */
function inicializar(ctx) {
  const emp = ctx.s.empresa.asegurar();
  ctx.reloj.tz = emp.zona_horaria;
  const hayAdmin = ctx.db.prepare("SELECT COUNT(*) n FROM usuarios WHERE rol = 'admin'").get().n > 0;
  if (!hayAdmin) {
    const generado = !ctx.cfg.admin.password;
    const password = ctx.cfg.admin.password || `nube-${pinAleatorio()}-${pinAleatorio()}`;
    ctx.s.usuarios.crear({ codigo: ctx.cfg.admin.codigo, nombre: ctx.cfg.admin.nombre, rol: 'admin', secreto: password, debe_cambiar: generado });
    ctx.adminInicial = { codigo: ctx.cfg.admin.codigo, password, generado };
  }
}
