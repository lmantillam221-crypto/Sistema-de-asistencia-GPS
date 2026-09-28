import { transaccion } from '../db/index.js';
import { conflicto, invalido, noEncontrado, prohibido, ErrorApp } from '../lib/errores.js';
import { aMin, partes, diasEntre } from '../domain/tiempo.js';
import { clasificarPosicion, fmtDist } from '../domain/geo.js';
import { evaluar, ALERTAS_GRAVES } from '../domain/asistencia.js';

const MARGEN_ENTRADA_MIN = 120; // se puede marcar entrada desde 2 h antes del turno

const leerMarca = (m) => ({ ...m, observaciones: JSON.parse(m.observaciones || '[]'), simulado: !!m.simulado });
const leerReporte = (r) => (r ? { ...r, apertura: JSON.parse(r.apertura), cierre: JSON.parse(r.cierre) } : null);
const agrupar = (lista, clave) => { const m = new Map(); for (const x of lista) { const k = clave(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };

export function servicioAsistencia(ctx) {
  const { db, reloj } = ctx;

  const marcasDe = async (turnoId, usuarioId) => (await db.prepare('SELECT * FROM marcas WHERE turno_id = ? AND usuario_id = ? ORDER BY hora, id').all(turnoId, usuarioId)).map(leerMarca);
  const reporteDe = async (turnoId, usuarioId) => leerReporte(await db.prepare('SELECT * FROM reportes_turno WHERE turno_id = ? AND usuario_id = ?').get(turnoId, usuarioId));

  /** Turno abierto (con entrada y sin salida) de la persona en la fecha indicada. */
  async function turnoAbierto(usuarioId, fecha) {
    const r = await db.prepare(`SELECT m.turno_id FROM marcas m WHERE m.usuario_id = ? AND m.fecha = ? AND m.tipo = 'entrada'
      AND NOT EXISTS (SELECT 1 FROM marcas s WHERE s.usuario_id = m.usuario_id AND s.turno_id = m.turno_id AND s.tipo = 'salida')
      ORDER BY m.ts DESC LIMIT 1`).get(usuarioId, fecha);
    return r ? ctx.s.turnos.obtener(r.turno_id) : null;
  }

  async function guardarReporte(turnoId, usuarioId, datos) {
    const prev = (await reporteDe(turnoId, usuarioId)) || { apertura: [], cierre: [], ventas: null, prendas: null, efectivo: null, digital: null, tarjeta: null, nota: '' };
    const r = { ...prev, ...Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)) };
    await db.prepare(`INSERT INTO reportes_turno (turno_id, usuario_id, apertura, cierre, ventas, prendas, efectivo, digital, tarjeta, nota, actualizado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (turno_id, usuario_id) DO UPDATE SET apertura = excluded.apertura, cierre = excluded.cierre,
      ventas = excluded.ventas, prendas = excluded.prendas, efectivo = excluded.efectivo, digital = excluded.digital, tarjeta = excluded.tarjeta,
      nota = excluded.nota, actualizado = excluded.actualizado`)
      .run(turnoId, usuarioId, JSON.stringify(r.apertura || []), JSON.stringify(r.cierre || []), r.ventas ?? null, r.prendas ?? null, r.efectivo ?? null, r.digital ?? null, r.tarjeta ?? null, String(r.nota || '').slice(0, 500), reloj.ms());
  }

  /** Carga en lote las marcas y reportes de varios turnos (evita una consulta por turno). */
  async function cargarLote(turnos) {
    const ids = turnos.map((t) => t.id);
    if (!ids.length) return { marcas: new Map(), reportes: new Map(), nombres: new Map() };
    const marcas = [], reportes = [];
    for (let i = 0; i < ids.length; i += 500) {
      const parte = ids.slice(i, i + 500), ph = parte.map(() => '?').join(',');
      marcas.push(...(await db.prepare(`SELECT * FROM marcas WHERE turno_id IN (${ph}) ORDER BY hora, id`).all(...parte)));
      reportes.push(...(await db.prepare(`SELECT * FROM reportes_turno WHERE turno_id IN (${ph})`).all(...parte)));
    }
    const uids = [...new Set(marcas.map((m) => m.usuario_id))];
    const nombres = new Map(uids.length ? (await db.prepare(`SELECT id, nombre FROM usuarios WHERE id IN (${uids.map(() => '?').join(',')})`).all(...uids)).map((u) => [u.id, u.nombre]) : []);
    return {
      marcas: agrupar(marcas.map(leerMarca), (m) => m.turno_id + '|' + m.usuario_id),
      reportes: new Map(reportes.map((r) => [r.turno_id + '|' + r.usuario_id, leerReporte(r)])),
      nombres,
    };
  }

  /** Evaluación de un turno (persona asignada y quienes lo cubrieron) a partir de datos ya cargados. */
  function evaluarConLote(t, lote, ahora) {
    const aj = ctx.s.empresa.ajustes();
    const res = { turno: t, asignado: null, cubrieron: [] };
    if (t.usuario_id) {
      const ms = lote.marcas.get(t.id + '|' + t.usuario_id) || [];
      res.asignado = { usuarioId: t.usuario_id, ev: evaluar(ms, t, ahora, aj), marcas: ms, reporte: lote.reportes.get(t.id + '|' + t.usuario_id) || null };
    }
    for (const [k, ms] of lote.marcas) {
      const [tid, uid] = k.split('|').map(Number);
      if (tid !== t.id || uid === t.usuario_id) continue;
      const ev = evaluar(ms, t, ahora, aj);
      ev.alertas = ev.alertas.filter((a) => !['TARDANZA', 'AUSENTE', 'FALTA'].includes(a.tipo));
      ev.alertas.unshift({ tipo: 'CUBRIO', detalle: `Cubrió el turno ${t.inicio}–${t.fin}${t.usuario_nombre ? ' de ' + t.usuario_nombre : ''} (entrada ${ev.entrada})` });
      res.cubrieron.push({ usuarioId: uid, nombre: lote.nombres.get(uid), ev, marcas: ms, reporte: lote.reportes.get(k) || null });
    }
    return res;
  }

  const api = {
    marcasDe,
    reporteDe,
    turnoAbierto,
    cargarLote,

    /**
     * Registra una marca (entrada, reporte automático o salida). La hora la pone el servidor;
     * la ubicación se valida contra la geocerca de la tienda del turno.
     */
    async registrar(usuario, { tipo, lat, lng, precision, capturado = null, dispositivo = null, turnoId = null, apertura, cierre, simulado = false }, ip = null) {
      const aj = ctx.s.empresa.ajustes();
      const recibido = reloj.ms();
      if (!(Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw invalido('No llegó una ubicación válida. Activa el GPS e inténtalo de nuevo.');
      if (simulado && !ctx.cfg.demo) throw prohibido('La ubicación simulada solo está disponible en modo demostración.');
      // Los reportes automáticos que se enviaron sin internet conservan la hora en que se tomaron (hasta 3 h).
      let momento = recibido;
      if (tipo === 'control' && capturado && capturado <= recibido + 60000 && recibido - capturado < 3 * 3600000) momento = Math.min(capturado, recibido);
      const p = partes(momento, reloj.tz);

      const salida = await transaccion(db, async () => {
        // Una marca a la vez por persona (evita dobles entradas por doble toque o reintentos).
        await db.bloquearFila('usuarios', usuario.id);
        let turno;
        if (tipo === 'entrada') {
          const abierto = await turnoAbierto(usuario.id, p.fecha);
          if (abierto) throw conflicto(`Ya marcaste tu entrada a las ${(await marcasDe(abierto.id, usuario.id))[0]?.hora.slice(0, 5)}.`);
          const hechos = new Set((await db.prepare("SELECT turno_id FROM marcas WHERE usuario_id = ? AND fecha = ? AND tipo = 'entrada'").all(usuario.id, p.fecha)).map((r) => r.turno_id));
          if (turnoId) {
            turno = await ctx.s.turnos.obtener(turnoId);
            if (!turno || turno.fecha !== p.fecha) throw invalido('Ese turno no es de hoy.');
            if (turno.usuario_id !== usuario.id && !aj.permitirCubrir) throw prohibido('La empresa no permite cubrir turnos sin coordinarlo antes.');
          } else {
            const mios = (await ctx.s.turnos.deUsuario(usuario.id, p.fecha, p.fecha)).filter((t) => !hechos.has(t.id));
            turno = mios.find((t) => aMin(t.fin) > p.minutos) || null;
            if (!turno) throw new ErrorApp(422, mios.length ? 'Tu turno de hoy ya terminó.' : 'Hoy no tienes turno asignado.', { codigo: 'SIN_TURNO' });
          }
          if (hechos.has(turno.id)) throw conflicto('Ya marcaste entrada en ese turno.');
          if (p.minutos < aMin(turno.inicio) - MARGEN_ENTRADA_MIN) throw new ErrorApp(422, `Tu turno empieza a las ${turno.inicio}. Puedes marcar entrada desde ${MARGEN_ENTRADA_MIN / 60} horas antes.`);
        } else {
          turno = await turnoAbierto(usuario.id, p.fecha);
          if (!turno) throw new ErrorApp(422, tipo === 'salida' ? 'Primero marca tu entrada.' : 'No tienes un turno en curso.', { codigo: 'SIN_ENTRADA' });
        }
        const tienda = await ctx.s.tiendas.obtener(turno.tienda_id);
        const previas = await marcasDe(turno.id, usuario.id);
        const anterior = previas[previas.length - 1] || null;
        if (tipo === 'control' && anterior && momento - (anterior.capturado ?? anterior.ts) < Math.min(10, aj.intervaloControlMin / 3) * 60000) {
          return { marca: anterior, turno, tienda, repetida: true };
        }
        const pos = { lat, lng, precision: Number.isFinite(precision) ? Math.max(0, precision) : 9999 };
        const c = clasificarPosicion({
          pos, tienda, precisionMaxima: aj.precisionMaximaM, anterior, capturado: capturado ?? null, recibido,
          dispositivo, dispositivoHabitual: aj.controlDispositivo ? usuario.dispositivo : null,
        });
        if (tipo === 'entrada' && aj.exigirUbicacionEnEntrada && c.estado === 'fuera') {
          throw new ErrorApp(422, `Estás a ${fmtDist(c.distancia)} de ${tienda.nombre}. Acércate a la tienda para marcar tu entrada.`, { codigo: 'FUERA' });
        }
        const r = await db.prepare(`INSERT INTO marcas (usuario_id, turno_id, tienda_id, tipo, fecha, hora, ts, capturado, lat, lng, precision_m, distancia_m, estado, observaciones, dispositivo, simulado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          usuario.id, turno.id, tienda.id, tipo, p.fecha, p.horaSeg, recibido, capturado ?? null,
          +lat.toFixed(6), +lng.toFixed(6), Math.round(pos.precision), c.distancia, c.estado, JSON.stringify(c.observaciones), dispositivo, simulado ? 1 : 0,
        );
        if (dispositivo && aj.controlDispositivo && !usuario.dispositivo) await ctx.s.usuarios.vincularDispositivo(usuario.id, dispositivo);
        if (tipo === 'entrada' && Array.isArray(apertura)) await guardarReporte(turno.id, usuario.id, { apertura: apertura.slice(0, 20).map(String) });
        if (tipo === 'salida' && cierre) await guardarReporte(turno.id, usuario.id, cierre);
        const marca = leerMarca(await db.prepare('SELECT * FROM marcas WHERE id = ?').get(r.lastInsertRowid));
        return { marca, turno, tienda, repetida: false, estado: c.estado, distancia: c.distancia };
      });
      if (salida.repetida) return salida;
      const { marca, turno, tienda } = salida;
      if (tipo !== 'control') {
        await ctx.s.auditoria.registrar(usuario, `marca_${tipo}`, 'turno', turno.id, { estado: salida.estado, distancia: salida.distancia, cubre: turno.usuario_id !== usuario.id }, ip);
        await ctx.s.multas.sincronizarTurno(turno.id);
      }
      ctx.bus.emit('cambio', { tipo: 'marca', marca: { id: marca.id, tipo, estado: marca.estado, hora: marca.hora, usuario: usuario.nombre, tienda: tienda.nombre } });
      return salida;
    },

    async guardarReporte(usuario, turnoId, datos) {
      const t = await ctx.s.turnos.obtener(turnoId);
      if (!t) throw noEncontrado('Turno');
      if (!(await db.prepare('SELECT 1 AS x FROM marcas WHERE turno_id = ? AND usuario_id = ? LIMIT 1').get(turnoId, usuario.id))) throw prohibido('Solo puedes reportar turnos que trabajaste.');
      if (diasEntre(t.fecha, reloj.ahora().fecha) > 2) throw prohibido('El cuadre solo se puede corregir hasta 2 días después del turno.');
      await guardarReporte(turnoId, usuario.id, datos);
      ctx.bus.emit('cambio', { tipo: 'reporte' });
      return reporteDe(turnoId, usuario.id);
    },

    /** Evaluación completa de un turno para la persona asignada y quienes lo cubrieron. */
    async evaluarTurno(t, ahora = reloj.ahora()) {
      return evaluarConLote(t, await cargarLote([t]), ahora);
    },

    /** Vista del día para el panel: turnos con su evaluación y alertas (consultas en lote). */
    async dia(fecha, tiendaId = null) {
      const ahora = reloj.ahora();
      const turnos = await ctx.s.turnos.deFecha(fecha, tiendaId);
      const lote = await cargarLote(turnos);
      const alertas = [];
      const items = turnos.map((t) => {
        const r = evaluarConLote(t, lote, ahora);
        if (r.asignado) for (const a of r.asignado.ev.alertas) alertas.push({ ...a, nombre: t.usuario_nombre, tienda: t.tienda_nombre, turnoId: t.id });
        for (const c of r.cubrieron) for (const a of c.ev.alertas) alertas.push({ ...a, nombre: c.nombre, tienda: t.tienda_nombre, turnoId: t.id });
        return r;
      });
      alertas.sort((a, b) => ALERTAS_GRAVES.has(b.tipo) - ALERTAS_GRAVES.has(a.tipo));
      return { fecha, ahora, items, alertas };
    },

    /** Filas de turnos trabajados (o faltados) en un período, para el dashboard y exportaciones. */
    async periodo({ desde, hasta, tiendaId = null, usuarioId = null }) {
      const ahora = reloj.ahora();
      const tope = hasta > ahora.fecha ? ahora.fecha : hasta;
      if (desde > tope) return [];
      const aj = ctx.s.empresa.ajustes();
      const turnos = await ctx.s.turnos.listar({ desde, hasta: tope, tiendaId });
      const marcas = (await db.prepare(`SELECT id, usuario_id, turno_id, tipo, hora, ts, capturado, estado, distancia_m, precision_m, observaciones FROM marcas
        WHERE fecha BETWEEN ? AND ? AND turno_id IS NOT NULL ORDER BY hora, id`).all(desde, tope)).map(leerMarca);
      const porClave = agrupar(marcas, (m) => m.turno_id + '|' + m.usuario_id);
      const personasPorTurno = agrupar(marcas, (m) => m.turno_id);
      const multas = await db.prepare("SELECT turno_id, usuario_id, SUM(monto) AS total FROM multas WHERE fecha BETWEEN ? AND ? AND estado <> 'anulada' AND turno_id IS NOT NULL GROUP BY turno_id, usuario_id").all(desde, tope);
      const multaDe = new Map(multas.map((m) => [m.turno_id + '|' + m.usuario_id, Number(m.total)]));
      const reportes = await db.prepare('SELECT r.* FROM reportes_turno r JOIN turnos t ON t.id = r.turno_id WHERE t.fecha BETWEEN ? AND ?').all(desde, tope);
      const repDe = new Map(reportes.map((r) => [r.turno_id + '|' + r.usuario_id, r]));
      const usuarios = new Map((await db.prepare('SELECT id, nombre, codigo FROM usuarios').all()).map((u) => [u.id, u]));
      const out = [];
      for (const t of turnos) {
        const quienes = new Set();
        if (t.usuario_id) quienes.add(t.usuario_id);
        for (const m of personasPorTurno.get(t.id) || []) quienes.add(m.usuario_id);
        for (const uid of quienes) {
          if (usuarioId && uid !== usuarioId) continue;
          const ms = porClave.get(t.id + '|' + uid) || [];
          const ev = evaluar(ms, t, ahora, aj);
          const cubre = uid !== t.usuario_id;
          if (ev.resultado === 'programado' || (cubre && !ms.length)) continue;
          const rep = repDe.get(t.id + '|' + uid);
          const u = usuarios.get(uid);
          out.push({
            turnoId: t.id, fecha: t.fecha, inicio: t.inicio, fin: t.fin, tiendaId: t.tienda_id, tienda: t.tienda_nombre,
            usuarioId: uid, nombre: u?.nombre || '—', codigo: u?.codigo || '', cubre,
            resultado: cubre ? 'cubrió' : ev.resultado, estado: ev.estado,
            entrada: ev.entrada, salida: ev.salida, minutosTarde: ev.minutosTarde, minutosEnLocal: ev.minutosEnLocal, horasEstimadas: !!ev.horasEstimadas,
            reportes: ev.reportes, reportesDentro: ev.reportesDentro, esperados: ev.esperados, recibidos: ev.recibidos,
            alertas: ev.alertas.map((a) => a.tipo),
            multa: multaDe.get(t.id + '|' + uid) || 0,
            ventas: rep?.ventas ?? null, prendas: rep?.prendas ?? null,
            montoVentas: rep && (rep.efectivo != null || rep.digital != null || rep.tarjeta != null) ? (rep.efectivo || 0) + (rep.digital || 0) + (rep.tarjeta || 0) : null,
            efectivo: rep?.efectivo ?? null, digital: rep?.digital ?? null, tarjeta: rep?.tarjeta ?? null,
            checklist: rep ? { apertura: JSON.parse(rep.apertura).length, cierre: JSON.parse(rep.cierre).length } : null,
          });
        }
      }
      return out;
    },

    /** Resumen por persona (planilla de horas, puntualidad, ventas y multas). */
    async planilla({ desde, hasta, tiendaId = null, usuarioId = null }) {
      const filasP = await api.periodo({ desde, hasta, tiendaId, usuarioId });
      const pend = new Map((await db.prepare("SELECT usuario_id, SUM(monto) AS t FROM multas WHERE estado = 'pendiente' GROUP BY usuario_id").all()).map((r) => [r.usuario_id, Number(r.t)]));
      const por = new Map();
      for (const r of filasP) {
        if (!por.has(r.usuarioId)) por.set(r.usuarioId, { usuarioId: r.usuarioId, nombre: r.nombre, codigo: r.codigo, turnos: 0, aTiempo: 0, tarde: 0, faltas: 0, coberturas: 0, minutos: 0, minutosTarde: 0, ventas: 0, prendas: 0, monto: 0, multas: 0, reportes: 0, reportesDentro: 0 });
        const p = por.get(r.usuarioId);
        if (r.cubre) p.coberturas++;
        else if (r.resultado !== 'en curso') { p.turnos++; if (r.resultado === 'a tiempo') p.aTiempo++; if (r.resultado === 'tarde') { p.tarde++; p.minutosTarde += r.minutosTarde; } if (r.resultado === 'falta') p.faltas++; }
        p.minutos += r.minutosEnLocal || 0; p.ventas += r.ventas || 0; p.prendas += r.prendas || 0; p.monto += r.montoVentas || 0; p.multas += r.multa;
        p.reportes += r.reportes; p.reportesDentro += r.reportesDentro;
      }
      return [...por.values()].map((p) => ({
        ...p,
        pendiente: pend.get(p.usuarioId) || 0,
        asistencia: p.turnos ? Math.round(((p.aTiempo + p.tarde) / p.turnos) * 100) : null,
        puntualidad: p.turnos ? Math.round((p.aTiempo / p.turnos) * 100) : null,
        gpsEnLocal: p.reportes ? Math.round((p.reportesDentro / p.reportes) * 100) : null,
        ventaPorHora: p.minutos ? +(p.monto / (p.minutos / 60)).toFixed(2) : null,
      })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    },

    /** Última posición conocida de cada persona con turno hoy (para el mapa en vivo). */
    async enVivo() {
      const hoy = reloj.ahora().fecha;
      return (await db.prepare(`SELECT m.*, u.nombre, u.codigo, u.telefono, t.inicio, t.fin, ti.nombre AS tienda FROM marcas m
        JOIN usuarios u ON u.id = m.usuario_id JOIN turnos t ON t.id = m.turno_id JOIN tiendas ti ON ti.id = m.tienda_id
        WHERE m.fecha = ? AND m.id = (SELECT MAX(id) FROM marcas x WHERE x.usuario_id = m.usuario_id AND x.turno_id = m.turno_id)`).all(hoy)).map(leerMarca);
    },
  };
  return api;
}
