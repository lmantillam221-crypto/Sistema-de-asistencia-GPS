import { fila, filas, transaccion } from '../db/index.js';
import { conflicto, invalido, noEncontrado, prohibido } from '../lib/errores.js';
import { aMin, esFecha, esHora, lunesDe, rango, sumarDias, fLarga, diasEntre } from '../domain/tiempo.js';
import { infoVentana, turnosPlanificados } from '../domain/horarios.js';

const SELECT = `SELECT t.*, u.nombre AS usuario_nombre, u.codigo AS usuario_codigo, u.telefono AS usuario_telefono,
  ti.nombre AS tienda_nombre FROM turnos t JOIN tiendas ti ON ti.id = t.tienda_id LEFT JOIN usuarios u ON u.id = t.usuario_id`;
const ORDEN = 'ORDER BY t.fecha, t.inicio, t.tienda_id, t.puesto';
const solapan = (a, b) => aMin(a.inicio) < aMin(b.fin) && aMin(b.inicio) < aMin(a.fin);

export function servicioTurnos(ctx) {
  const { db, reloj } = ctx;
  const T = () => ctx.s.tiendas;
  const tieneMarcas = (id) => !!db.prepare('SELECT 1 FROM marcas WHERE turno_id = ? LIMIT 1').get(id);

  function generarFecha(tiendaId, fecha) {
    const plan = turnosPlanificados(fecha, T().plantillas(tiendaId), T().especialPara(tiendaId, fecha));
    const ins = db.prepare('INSERT INTO turnos (tienda_id, fecha, inicio, fin, puesto, origen) VALUES (?, ?, ?, ?, ?, ?)');
    for (const p of plan) ins.run(tiendaId, fecha, p.inicio, p.fin, p.puesto, p.origen);
    db.prepare('INSERT OR IGNORE INTO dias_generados (tienda_id, fecha) VALUES (?, ?)').run(tiendaId, fecha);
  }

  const api = {
    obtener: (id) => fila(db.prepare(`${SELECT} WHERE t.id = ?`).get(id)),

    /** Crea (una sola vez) los turnos de cada día a partir de la plantilla semanal y los días especiales. */
    asegurarRango(desde, hasta) {
      if (diasEntre(desde, hasta) > 400) throw invalido('El rango máximo es de 400 días.');
      const tiendas = T().listar();
      if (!tiendas.length) return;
      const hechos = new Set(filas(db.prepare('SELECT tienda_id, fecha FROM dias_generados WHERE fecha BETWEEN ? AND ?').all(desde, hasta)).map((r) => r.tienda_id + '|' + r.fecha));
      const faltan = [];
      for (const f of rango(desde, hasta)) for (const t of tiendas) if (!hechos.has(t.id + '|' + f)) faltan.push([t.id, f]);
      if (faltan.length) transaccion(db, () => faltan.forEach(([t, f]) => generarFecha(t, f)));
    },

    resincronizarFecha(tiendaId, fecha) {
      if (!db.prepare('SELECT 1 FROM dias_generados WHERE tienda_id = ? AND fecha = ?').get(tiendaId, fecha)) return;
      const plan = turnosPlanificados(fecha, T().plantillas(tiendaId), T().especialPara(tiendaId, fecha));
      const existentes = filas(db.prepare("SELECT * FROM turnos WHERE tienda_id = ? AND fecha = ? AND origen != 'manual'").all(tiendaId, fecha));
      const usados = new Set();
      for (const p of plan) {
        const e = existentes.find((x) => !usados.has(x.id) && x.inicio === p.inicio && x.fin === p.fin && x.puesto === p.puesto);
        if (e) { usados.add(e.id); if (e.origen !== p.origen) db.prepare('UPDATE turnos SET origen = ? WHERE id = ?').run(p.origen, e.id); continue; }
        db.prepare('INSERT INTO turnos (tienda_id, fecha, inicio, fin, puesto, origen) VALUES (?, ?, ?, ?, ?, ?)').run(tiendaId, fecha, p.inicio, p.fin, p.puesto, p.origen);
      }
      for (const e of existentes) if (!usados.has(e.id) && !e.usuario_id && !tieneMarcas(e.id)) db.prepare('DELETE FROM turnos WHERE id = ?').run(e.id);
    },
    resincronizar(tiendaId, desde) {
      for (const r of filas(db.prepare('SELECT fecha FROM dias_generados WHERE tienda_id = ? AND fecha >= ?').all(tiendaId, desde))) api.resincronizarFecha(tiendaId, r.fecha);
    },

    listar({ desde, hasta, tiendaId = null, usuarioId = null, soloAsignados = false }) {
      api.asegurarRango(desde, hasta);
      const cond = ['t.fecha BETWEEN ? AND ?', 'ti.activa = 1'], args = [desde, hasta];
      if (tiendaId) { cond.push('t.tienda_id = ?'); args.push(tiendaId); }
      if (usuarioId) { cond.push('t.usuario_id = ?'); args.push(usuarioId); }
      if (soloAsignados) cond.push('t.usuario_id IS NOT NULL');
      return filas(db.prepare(`${SELECT} WHERE ${cond.join(' AND ')} ${ORDEN}`).all(...args));
    },
    deFecha: (fecha, tiendaId = null) => api.listar({ desde: fecha, hasta: fecha, tiendaId }),
    deUsuario: (usuarioId, desde, hasta) => api.listar({ desde, hasta, usuarioId }),
    cuentaSemana: (usuarioId, lunes) => db.prepare('SELECT COUNT(*) n FROM turnos WHERE usuario_id = ? AND fecha BETWEEN ? AND ?').get(usuarioId, lunes, sumarDias(lunes, 6)).n,

    cruce(usuarioId, turno) {
      return filas(db.prepare('SELECT * FROM turnos WHERE usuario_id = ? AND fecha = ? AND id != ?').all(usuarioId, turno.fecha, turno.id ?? 0)).find((x) => solapan(x, turno)) || null;
    },

    /** Asignación directa desde el panel (sin restricciones de ventana). */
    asignar(turnoId, usuarioId, quien) {
      const t = api.obtener(turnoId);
      if (!t) throw noEncontrado('Turno');
      if (usuarioId) {
        const u = ctx.s.usuarios.porId(usuarioId);
        if (!u || !u.activo) throw invalido('Colaboradora no válida.');
        const c = api.cruce(usuarioId, t);
        if (c) throw conflicto(`${u.nombre} ya tiene un turno que se cruza (${c.inicio}–${c.fin}).`);
      }
      db.prepare('UPDATE turnos SET usuario_id = ?, asignado_por = ?, asignado_en = ? WHERE id = ?').run(usuarioId || null, usuarioId ? 'supervisor' : null, usuarioId ? reloj.ms() : null, turnoId);
      ctx.s.auditoria.registrar(quien, usuarioId ? 'turno_asignado' : 'turno_liberado', 'turno', turnoId, { fecha: t.fecha, inicio: t.inicio, usuarioId, antes: t.usuario_id });
      ctx.bus.emit('cambio', { tipo: 'horarios' });
      return api.obtener(turnoId);
    },

    /** Una colaboradora elige un turno libre dentro de la ventana semanal. Es atómico: gana la primera. */
    elegir(usuario, turnoId) {
      const aj = ctx.s.empresa.ajustes(), ahora = reloj.ahora(), v = infoVentana(aj.ventana, ahora);
      const t = api.obtener(turnoId);
      if (!t) throw noEncontrado('Turno');
      const lunes = lunesDe(t.fecha);
      if (!api.puedeElegirSemana(lunes)) throw prohibido('La elección de horarios está cerrada.');
      if (t.usuario_id && t.usuario_id !== usuario.id) throw conflicto('Ese turno ya lo eligió otra persona.');
      if (t.usuario_id === usuario.id) return t;
      if (api.cuentaSemana(usuario.id, lunes) >= aj.maxTurnosSemana) throw conflicto(`Ya completaste tus ${aj.maxTurnosSemana} turno(s) de la semana.`);
      if (filas(db.prepare('SELECT 1 FROM turnos WHERE usuario_id = ? AND fecha = ?').all(usuario.id, t.fecha)).length) throw conflicto('Ya tienes un turno ese día.');
      const r = db.prepare("UPDATE turnos SET usuario_id = ?, asignado_por = 'colaborador', asignado_en = ? WHERE id = ? AND usuario_id IS NULL").run(usuario.id, reloj.ms(), turnoId);
      if (!r.changes) throw conflicto('Ese turno ya lo eligió otra persona.');
      ctx.s.auditoria.registrar(usuario, 'turno_elegido', 'turno', turnoId, { fecha: t.fecha, inicio: t.inicio, ventana: v.abierta });
      ctx.bus.emit('cambio', { tipo: 'horarios' });
      return api.obtener(turnoId);
    },
    soltar(usuario, turnoId) {
      const t = api.obtener(turnoId);
      if (!t || t.usuario_id !== usuario.id) throw noEncontrado('Turno');
      if (!api.puedeElegirSemana(lunesDe(t.fecha))) throw prohibido('Fuera de la ventana de elección no puedes soltar turnos. Pide una cobertura.');
      db.prepare('UPDATE turnos SET usuario_id = NULL, asignado_por = NULL, asignado_en = NULL WHERE id = ? AND usuario_id = ?').run(turnoId, usuario.id);
      ctx.s.auditoria.registrar(usuario, 'turno_soltado', 'turno', turnoId, { fecha: t.fecha, inicio: t.inicio });
      ctx.bus.emit('cambio', { tipo: 'horarios' });
    },
    puedeElegirSemana(lunes) {
      const aj = ctx.s.empresa.ajustes(), ahora = reloj.ahora(), v = infoVentana(aj.ventana, ahora);
      if (v.abierta && lunes === v.semana) return true;
      // Opción: dejar abierta la elección toda la semana previa hasta que empiece la semana.
      if (aj.ventanaSemanaCompleta && lunes > ahora.fecha && lunes === sumarDias(lunesDe(ahora.fecha), 7)) return true;
      return false;
    },

    crearExtra({ tienda_id, fecha, inicio, fin, usuario_id = null }, quien) {
      if (!T().obtener(tienda_id)) throw noEncontrado('Tienda');
      if (!esFecha(fecha) || !esHora(inicio) || !esHora(fin) || aMin(fin) <= aMin(inicio)) throw invalido('Revisa la fecha y el horario del turno.');
      api.asegurarRango(fecha, fecha);
      const puesto = db.prepare('SELECT COALESCE(MAX(puesto), 0) + 1 p FROM turnos WHERE tienda_id = ? AND fecha = ? AND inicio = ? AND fin = ?').get(tienda_id, fecha, inicio, fin).p;
      const r = db.prepare("INSERT INTO turnos (tienda_id, fecha, inicio, fin, puesto, origen) VALUES (?, ?, ?, ?, ?, 'manual')").run(tienda_id, fecha, inicio, fin, puesto);
      const id = Number(r.lastInsertRowid);
      ctx.s.auditoria.registrar(quien, 'turno_extra_creado', 'turno', id, { fecha, inicio, fin });
      if (usuario_id) return api.asignar(id, usuario_id, quien);
      ctx.bus.emit('cambio', { tipo: 'horarios' });
      return api.obtener(id);
    },
    eliminar(id, quien) {
      const t = api.obtener(id);
      if (!t) throw noEncontrado('Turno');
      if (tieneMarcas(id)) throw conflicto('Ese turno ya tiene marcas de asistencia; no se puede eliminar.');
      db.prepare('DELETE FROM turnos WHERE id = ?').run(id);
      ctx.s.auditoria.registrar(quien, 'turno_eliminado', 'turno', id, { fecha: t.fecha, inicio: t.inicio, fin: t.fin });
      ctx.bus.emit('cambio', { tipo: 'horarios' });
    },

    /** Texto del horario semanal para compartir por WhatsApp. */
    textoSemana(lunes, tiendaId = null) {
      const emp = ctx.s.empresa.obtener();
      const ts = api.listar({ desde: lunes, hasta: sumarDias(lunes, 6), tiendaId });
      const lin = [`*${emp.nombre} · Horario de la semana*`, `${fLarga(lunes)} al ${fLarga(sumarDias(lunes, 6))}`];
      const porTienda = new Map();
      for (const t of ts) { if (!porTienda.has(t.tienda_nombre)) porTienda.set(t.tienda_nombre, []); porTienda.get(t.tienda_nombre).push(t); }
      for (const [tn, lista] of porTienda) {
        lin.push('', `📍 *${tn}*`);
        const porDia = new Map();
        for (const t of lista) { if (!porDia.has(t.fecha)) porDia.set(t.fecha, []); porDia.get(t.fecha).push(t); }
        for (const [f, l] of porDia) lin.push(`${fLarga(f)}: ${l.map((t) => `${t.inicio}–${t.fin} ${t.usuario_nombre ? nombreBonito(t.usuario_nombre) : '(sin cubrir)'}`).join(' · ')}`);
      }
      return lin.join('\n');
    },
  };
  return api;
}

export const nombreBonito = (n) => String(n || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
