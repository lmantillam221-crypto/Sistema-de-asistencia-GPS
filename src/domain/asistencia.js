/* Evaluación de asistencia de un turno. Funciones puras: reciben marcas y devuelven el estado. */
import { aMin, aHora } from './tiempo.js';
import { fmtDist } from './geo.js';

export const NOMBRE_ALERTA = {
  AUSENTE: 'No llegó', FALTA: 'Falta', TARDANZA: 'Tardanza', FUERA_DEL_LOCAL: 'Fuera del local',
  UBICACION_IMPRECISA: 'GPS impreciso', SIN_REPORTES: 'GPS sin reportar', SALIDA_ANTICIPADA: 'Salida anticipada',
  SIN_SALIDA: 'No marcó salida', GPS_SOSPECHOSO: 'GPS sospechoso', CUBRIO: 'Cubrió turno', SIN_CIERRE: 'Sin cuadre de caja',
};
export const ALERTAS_GRAVES = new Set(['AUSENTE', 'FALTA', 'FUERA_DEL_LOCAL', 'SIN_REPORTES', 'GPS_SOSPECHOSO']);

export const CLASE_ESTADO = {
  'EN EL LOCAL': 'ok', 'TERMINÓ': 'ok', 'AÚN NO LLEGA': 'warn', 'PROGRAMADO': 'grey', 'NO LLEGA': 'bad',
  'FALTÓ': 'bad', 'FUERA DEL LOCAL': 'bad', 'SIN SEÑAL': 'bad', 'SIN ASIGNAR': 'grey',
};

const hm = (m) => m.hora.slice(0, 5);

/** Minuto "actual" relativo a la fecha del turno: 1440 si ya pasó, -1 si es futuro. */
export function minutoRelativo(fecha, ahora) {
  return fecha === ahora.fecha ? ahora.minutos : fecha < ahora.fecha ? 1440 : -1;
}

/**
 * Franjas de reporte automático (cada N minutos desde la entrada).
 * Cada franja se empareja con el reporte más cercano dentro de ±N/2 minutos.
 */
export function franjas(marcas, turno, ahora, intervalo) {
  const entrada = marcas.find((m) => m.tipo === 'entrada'), salida = marcas.find((m) => m.tipo === 'salida');
  const ctrl = marcas.filter((m) => m.tipo === 'control').map((m) => ({ m, t: aMin(hm(m)), usado: false }));
  if (!(intervalo > 0) || !entrada) return { lista: [], extras: ctrl.map((c) => c.m) };
  const minAhora = minutoRelativo(turno.fecha, ahora);
  const e0 = aMin(hm(entrada));
  const limite = salida ? aMin(hm(salida)) : Math.max(aMin(turno.fin || '23:59'), e0);
  const lista = [];
  for (let t = e0 + intervalo; t <= limite && lista.length < 96; t += intervalo) {
    let mejor = null;
    for (const c of ctrl) if (!c.usado && Math.abs(c.t - t) <= intervalo / 2 && (!mejor || Math.abs(c.t - t) < Math.abs(mejor.t - t))) mejor = c;
    if (mejor) { mejor.usado = true; lista.push({ t, hora: aHora(t), marca: mejor.m, estado: 'recibido' }); continue; }
    const estado = minAhora < t ? 'futuro' : minAhora < t + Math.ceil(intervalo / 2) ? 'pendiente' : 'falta';
    lista.push({ t, hora: aHora(t), marca: null, estado });
    if (estado === 'futuro') break;
  }
  return { lista, extras: ctrl.filter((c) => !c.usado).map((c) => c.m) };
}

/**
 * Evalúa el turno de una persona.
 * @param {object[]} marcas  marcas de la persona para ese turno, ordenadas por hora
 * @param {{fecha:string,inicio:string,fin:string}} turno
 * @param {{fecha:string,minutos:number}} ahora
 * @param {{toleranciaMin:number,intervaloControlMin:number}} cfg
 */
export function evaluar(marcas, turno, ahora, cfg) {
  const minAhora = minutoRelativo(turno.fecha, ahora);
  const ini = aMin(turno.inicio), fin = aMin(turno.fin), tol = Number(cfg.toleranciaMin ?? 10);
  const intervalo = Number(cfg.intervaloControlMin ?? 30);
  const alertas = [];
  const entrada = marcas.find((m) => m.tipo === 'entrada'), salida = marcas.find((m) => m.tipo === 'salida');
  const reportes = marcas.filter((m) => m.tipo === 'control');
  const base = { entrada: '', salida: '', minutosTarde: 0, minutosEnLocal: null, reportes: 0, reportesDentro: 0, esperados: 0, recibidos: 0, proximo: null, ultimo: '', franjas: [] };

  if (!entrada) {
    if (minAhora > fin) {
      alertas.push({ tipo: 'FALTA', detalle: `No asistió a su turno de ${turno.inicio} a ${turno.fin}` });
      return { ...base, estado: 'FALTÓ', resultado: 'falta', alertas };
    }
    if (minAhora > ini + tol) {
      alertas.push({ tipo: 'AUSENTE', detalle: `No marcó entrada (el turno empezó a las ${turno.inicio})` });
      return { ...base, estado: 'NO LLEGA', resultado: 'en curso', alertas };
    }
    return { ...base, estado: minAhora < 0 || minAhora < ini - 120 ? 'PROGRAMADO' : 'AÚN NO LLEGA', resultado: minAhora < 0 || minAhora < ini ? 'programado' : 'en curso', alertas };
  }

  const hE = hm(entrada), tarde = aMin(hE) - ini;
  if (tarde > tol) alertas.push({ tipo: 'TARDANZA', detalle: `Llegó ${hE} (${tarde} min tarde)` });
  for (const m of marcas) {
    const q = m.tipo === 'control' ? 'reporte' : m.tipo;
    if (m.estado === 'fuera') alertas.push({ tipo: 'FUERA_DEL_LOCAL', detalle: `${q} de las ${hm(m)}: a ${fmtDist(m.distancia_m)} del local` });
    if (m.estado === 'imprecisa') alertas.push({ tipo: 'UBICACION_IMPRECISA', detalle: `${q} de las ${hm(m)} con precisión de ±${Math.round(m.precision_m)} m` });
    for (const o of m.observaciones || []) alertas.push({ tipo: 'GPS_SOSPECHOSO', detalle: `${q} de las ${hm(m)}: ${o}` });
  }
  const fr = franjas(marcas, turno, ahora, intervalo);
  const vencidas = fr.lista.filter((f) => f.estado === 'recibido' || f.estado === 'falta');
  for (let i = 0; i < fr.lista.length; i++) {
    if (fr.lista[i].estado !== 'falta') continue;
    let j = i;
    while (j + 1 < fr.lista.length && fr.lista[j + 1].estado === 'falta') j++;
    alertas.push({ tipo: 'SIN_REPORTES', detalle: i === j ? `No llegó el reporte de las ${fr.lista[i].hora}` : `No llegaron los reportes de ${fr.lista[i].hora} a ${fr.lista[j].hora}` });
    i = j;
  }
  const sinSenal = !salida && vencidas[vencidas.length - 1]?.estado === 'falta';
  let salidaAnticipada = 0;
  if (salida) {
    const hS = hm(salida);
    if (aMin(hS) < fin - tol) { salidaAnticipada = fin - aMin(hS); alertas.push({ tipo: 'SALIDA_ANTICIPADA', detalle: `Salió ${hS} (turno hasta ${turno.fin})` }); }
  } else if (minAhora > fin + 60) {
    alertas.push({ tipo: 'SIN_SALIDA', detalle: `No marcó salida; entró a las ${hE}` });
  }
  const ultima = marcas[marcas.length - 1];
  const estado = salida ? 'TERMINÓ' : sinSenal ? 'SIN SEÑAL' : ultima.estado === 'fuera' ? 'FUERA DEL LOCAL' : 'EN EL LOCAL';
  const finEfectivo = salida ? aMin(hm(salida)) : minAhora > fin ? fin : null;
  return {
    estado,
    resultado: tarde > tol ? 'tarde' : 'a tiempo',
    alertas,
    entrada: hE,
    minutosTarde: Math.max(0, tarde),
    salida: salida ? hm(salida) : '',
    salidaAnticipada,
    minutosEnLocal: finEfectivo != null ? Math.max(0, finEfectivo - aMin(hE)) : null,
    horasEstimadas: !salida && finEfectivo != null,
    reportes: reportes.length,
    reportesDentro: reportes.filter((c) => c.estado === 'dentro').length,
    ultimo: hm(ultima),
    esperados: vencidas.length,
    recibidos: vencidas.filter((f) => f.estado === 'recibido').length,
    proximo: fr.lista.find((f) => f.estado === 'futuro' || f.estado === 'pendiente')?.t ?? null,
    franjas: fr.lista.map(({ marca, ...f }) => ({ ...f, marcaId: marca?.id ?? null })),
  };
}

/** Multas que corresponden a un turno evaluado. */
export function multasDelTurno(ev, turno, cfgMultas = {}) {
  const out = [];
  if (ev.resultado === 'tarde' && Number(cfgMultas.tardanza) > 0) {
    out.push({ tipo: 'tardanza', monto: Number(cfgMultas.tardanza), detalle: `Llegó ${ev.entrada}, ${ev.minutosTarde} min tarde (turno ${turno.inicio})` });
  }
  if (ev.resultado === 'falta' && Number(cfgMultas.falta) > 0) {
    out.push({ tipo: 'falta', monto: Number(cfgMultas.falta), detalle: `No asistió al turno de ${turno.inicio} a ${turno.fin}` });
  }
  if (ev.salidaAnticipada > 0 && Number(cfgMultas.salidaAnticipada) > 0) {
    out.push({ tipo: 'salida_anticipada', monto: Number(cfgMultas.salidaAnticipada), detalle: `Salió ${ev.salida}, ${ev.salidaAnticipada} min antes (turno hasta ${turno.fin})` });
  }
  return out;
}
