/* Importa los datos de la versión anterior (index.html de un solo archivo o su copia de seguridad .json). */
import { transaccion } from '../db/index.js';
import { hashSecreto } from './seguridad.js';
import { AJUSTES_POR_DEFECTO } from '../domain/ajustes.js';

/** Extrae el objeto de datos desde el texto de un respaldo JSON o desde el index.html anterior. */
export function leerFuenteAnterior(texto) {
  const t = String(texto).trim();
  if (t.startsWith('{')) {
    const j = JSON.parse(t);
    if (j?.app === 'nube-chic-asistencia' && j.datos?.['config/principal']) return j.datos;
    if (j?.['config/principal']) return j;
    throw new Error('El JSON no es una copia de seguridad del sistema anterior.');
  }
  const m = t.match(/const CONFIG_INICIAL\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (!m) throw new Error('No se encontró la configuración en el archivo HTML.');
  const datos = { 'config/principal': JSON.parse(m[1]) };
  const s = t.match(/const SEMANA_INICIAL\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (s) Object.assign(datos, JSON.parse(s[1]));
  return datos;
}

/**
 * Carga los datos en la base nueva. Crea la tienda, colaboradoras (con su mismo usuario y PIN),
 * turnos asignados, marcas GPS y multas. Es idempotente para colaboradoras (no duplica códigos).
 */
export function importarAnterior(ctx, datos, quien = null) {
  const { db } = ctx;
  const c = datos['config/principal'];
  if (!c) throw new Error('Faltan datos de configuración.');
  const res = { tienda: null, colaboradoras: 0, turnos: 0, marcas: 0, multas: 0, omitidos: 0 };
  transaccion(db, () => {
    // Reglas del negocio
    const aj = {
      toleranciaMin: Number(c.toleranciaMin ?? AJUSTES_POR_DEFECTO.toleranciaMin),
      intervaloControlMin: Number(c.intervaloControlMin ?? 30),
      precisionMaximaM: Number(c.precisionMaximaM ?? 100),
      maxTurnosSemana: Number(c.maxTurnosSemana ?? 1),
      ventana: c.ventana ? { dia: Number(c.ventana.dia), desde: c.ventana.desde, hasta: c.ventana.hasta } : AJUSTES_POR_DEFECTO.ventana,
      multas: { tardanza: Number(c.multas?.tardanza ?? 5), falta: Number(c.multas?.falta ?? 20), salidaAnticipada: 0 },
      recordatorioHoras: Number(c.recordatorioHoras ?? 2),
    };
    ctx.s.empresa.actualizar({ nombre: c.empresa || 'Nube.chic', zona_horaria: c.zonaHoraria || 'America/Lima', ajustes: aj });

    // Tienda
    const l = c.local || c.locales?.[0];
    let tienda = db.prepare('SELECT * FROM tiendas WHERE codigo = ?').get(l?.id || 'L1');
    if (!tienda && l) tienda = ctx.s.tiendas.crear({ codigo: l.id || 'L1', nombre: l.nombre, lat: l.lat, lng: l.lng, radio_m: l.radioM || 80 });
    else if (tienda) tienda = ctx.s.tiendas.actualizar(tienda.id, { nombre: l.nombre, lat: l.lat, lng: l.lng, radio_m: l.radioM || tienda.radio_m });
    res.tienda = tienda?.nombre;

    // Plantilla semanal
    if (tienda && c.turnos && !ctx.s.tiendas.plantillas(tienda.id).length) {
      const lista = [];
      for (const [dia, ts] of Object.entries(c.turnos)) for (const t of ts || []) lista.push({ dia: Number(dia), inicio: t.inicio, fin: t.fin, cupos: 1 });
      ctx.s.tiendas.guardarPlantillas(tienda.id, lista);
    }

    // Colaboradoras (mismo usuario y PIN que ya conocen)
    const idDe = new Map();
    for (const s of c.socios || []) {
      let u = ctx.s.usuarios.porCodigo(s.id);
      if (!u) {
        db.prepare("INSERT INTO usuarios (codigo, nombre, telefono, rol, secreto, tienda_id, creado) VALUES (?, ?, ?, 'colaborador', ?, ?, ?)")
          .run(String(s.id).toUpperCase(), String(s.nombre).trim(), String(s.telefono || '').replace(/\D/g, ''), hashSecreto(String(s.pin)), tienda?.id ?? null, ctx.reloj.ms());
        u = ctx.s.usuarios.porCodigo(s.id);
        res.colaboradoras++;
      }
      idDe.set(s.id, u.id);
    }
    if (!tienda) return;

    // Turnos asignados (semanas/…)
    const turnoDe = new Map();
    const fechas = [];
    for (const [k, v] of Object.entries(datos)) if (k.startsWith('semanas/')) for (const f of Object.keys(v?.dias || {})) fechas.push(f);
    fechas.sort();
    if (fechas.length) ctx.s.turnos.asegurarRango(fechas[0], fechas[fechas.length - 1]);
    for (const [k, v] of Object.entries(datos)) {
      if (!k.startsWith('semanas/')) continue;
      for (const [f, ts] of Object.entries(v?.dias || {})) {
        for (const [tid, a] of Object.entries(ts || {})) {
          if (!a?.sid || !idDe.has(a.sid)) continue;
          let t = db.prepare('SELECT * FROM turnos WHERE tienda_id = ? AND fecha = ? AND inicio = ? AND fin = ? AND (usuario_id IS NULL OR usuario_id = ?) ORDER BY usuario_id IS NULL LIMIT 1')
            .get(tienda.id, f, a.inicio, a.fin, idDe.get(a.sid));
          if (!t) {
            const r = db.prepare("INSERT INTO turnos (tienda_id, fecha, inicio, fin, puesto, origen) VALUES (?, ?, ?, ?, 1, 'manual')").run(tienda.id, f, a.inicio, a.fin);
            t = { id: Number(r.lastInsertRowid) };
          }
          db.prepare('UPDATE turnos SET usuario_id = ?, asignado_por = ?, asignado_en = ?, ejemplo = ? WHERE id = ?')
            .run(idDe.get(a.sid), a.por === 'socio' ? 'colaborador' : 'supervisor', a.en || ctx.reloj.ms(), a.ejemplo ? 1 : 0, t.id);
          turnoDe.set(`${f}|${tid}|${a.sid}`, t.id);
          turnoDe.set(`${f}|${a.sid}`, t.id);
          res.turnos++;
        }
      }
    }

    // Marcas GPS
    const insM = db.prepare(`INSERT INTO marcas (usuario_id, turno_id, tienda_id, tipo, fecha, hora, ts, lat, lng, precision_m, distancia_m, estado, observaciones, simulado, ejemplo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const [k, m] of Object.entries(datos)) {
      if (!k.startsWith('marcas/') || !idDe.has(m?.socioId)) continue;
      let tId = turnoDe.get(`${m.fecha}|${m.socioId}`);
      if (!tId) { // cubrió un turno ajeno: se enlaza al primer turno del día
        tId = db.prepare('SELECT id FROM turnos WHERE tienda_id = ? AND fecha = ? ORDER BY inicio LIMIT 1').get(tienda.id, m.fecha)?.id;
      }
      if (!tId) { res.omitidos++; continue; }
      insM.run(idDe.get(m.socioId), tId, tienda.id, m.tipo, m.fecha, m.hora.length === 5 ? m.hora + ':00' : m.hora, m.creado || ctx.reloj.ms(),
        m.lat, m.lng, m.precision, m.distancia, ['dentro', 'fuera', 'imprecisa'].includes(m.estado) ? m.estado : 'imprecisa',
        JSON.stringify(m.observacion ? [m.observacion] : []), m.simulado ? 1 : 0, m.ejemplo ? 1 : 0);
      res.marcas++;
    }

    // Multas (con su estado de pago)
    for (const [k, m] of Object.entries(datos)) {
      if (!k.startsWith('multas/') || !idDe.has(m?.socioId)) continue;
      const tId = turnoDe.get(`${m.fecha}|${m.turnoId}|${m.socioId}`) ?? turnoDe.get(`${m.fecha}|${m.socioId}`) ?? null;
      const r = db.prepare(`INSERT INTO multas (usuario_id, turno_id, fecha, tipo, monto, detalle, estado, creada, notificada, vista, pagada, ejemplo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`).run(
        idDe.get(m.socioId), tId, m.fecha, m.tipo === 'falta' ? 'falta' : 'tardanza', Number(m.monto || 0), m.detalle || '',
        ['pendiente', 'pagada', 'anulada'].includes(m.estado) ? m.estado : 'pendiente', m.creada || ctx.reloj.ms(),
        m.notificada ? (m.notificadaEn || ctx.reloj.ms()) : null, m.vistaSocio ? ctx.reloj.ms() : null,
        m.estado === 'pagada' ? (m.pagadaEn ? Date.parse(m.pagadaEn + 'T12:00:00Z') : ctx.reloj.ms()) : null, m.ejemplo ? 1 : 0);
      res.multas += r.changes;
    }
  });
  ctx.s.auditoria.registrar(quien, 'importacion_version_anterior', null, null, res);
  ctx.bus.emit('cambio', { tipo: 'todo' });
  return res;
}
