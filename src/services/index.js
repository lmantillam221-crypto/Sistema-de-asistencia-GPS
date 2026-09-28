import { EventEmitter } from 'node:events';
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

/** Crea el contexto de la aplicación a partir de una base ya abierta y migrada (abrirDB, motor PostgreSQL o sql.js). */
export async function crearContexto(cfg, { db, ahora } = {}) {
  if (!db) throw new Error('crearContexto necesita una base de datos abierta.');
  const ctx = { cfg, db, reloj: crearReloj({ ahora }), bus: new EventEmitter(), s: {} };
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
  await inicializar(ctx);
  return ctx;
}

/** Primer arranque: datos de la empresa. El primer administrador se crea con ADMIN_PASSWORD
    o desde el asistente de configuración del panel (/panel). */
async function inicializar(ctx) {
  await ctx.s.empresa.asegurar(ctx.cfg.marca ? { nombre: ctx.cfg.marca.nombre, rubro: ctx.cfg.marca.rubro } : {});
  const hayAdmin = (await ctx.db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin'").get()).n > 0;
  if (!hayAdmin && ctx.cfg.admin.password) {
    try {
      await ctx.s.usuarios.crear({ codigo: ctx.cfg.admin.codigo, nombre: ctx.cfg.admin.nombre, rol: 'admin', secreto: ctx.cfg.admin.password });
      ctx.adminInicial = { codigo: ctx.cfg.admin.codigo };
    } catch (e) { if (e.status !== 409) throw e; } // otra instancia lo creó al mismo tiempo
  }
}
