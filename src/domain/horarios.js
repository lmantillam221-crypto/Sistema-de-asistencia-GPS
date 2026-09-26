/* Reglas de la ventana semanal para elegir horarios. */
import { aMin, diaDe, sumarDias } from './tiempo.js';

/** Ventana de elección: p. ej. domingo 21:00–22:00 para la semana que empieza el lunes siguiente. */
export function infoVentana(ventana, ahora) {
  const v = ventana || { dia: 0, desde: '21:00', hasta: '22:00' };
  const dia = diaDe(ahora.fecha);
  const abierta = dia === v.dia && ahora.minutos >= aMin(v.desde) && ahora.minutos < aMin(v.hasta);
  let f = ahora.fecha;
  for (let i = 0; i < 8; i++) {
    if (diaDe(f) === v.dia && (f !== ahora.fecha || ahora.minutos < aMin(v.hasta))) break;
    f = sumarDias(f, 1);
  }
  let semana = sumarDias(f, 1);
  while (diaDe(semana) !== 1) semana = sumarDias(semana, 1);
  return { abierta, fecha: f, dia: v.dia, desde: v.desde, hasta: v.hasta, semana, quedan: abierta ? aMin(v.hasta) - ahora.minutos : null, esHoy: f === ahora.fecha };
}

/** Turnos que se generan para una fecha según plantilla y días especiales. */
export function turnosPlanificados(fecha, plantillas, especial) {
  if (especial?.cerrado) return [];
  const fuente = especial ? especial.turnos.map((t) => ({ ...t, origen: 'especial' })) : plantillas.filter((p) => p.dia === diaDe(fecha)).map((p) => ({ ...p, origen: 'plantilla' }));
  const out = [];
  for (const t of fuente.sort((a, b) => a.inicio.localeCompare(b.inicio))) {
    for (let i = 1; i <= Math.max(1, Number(t.cupos || 1)); i++) out.push({ fecha, inicio: t.inicio, fin: t.fin, puesto: i, origen: t.origen });
  }
  return out;
}
