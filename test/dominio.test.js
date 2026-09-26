import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluar, franjas, multasDelTurno } from '../src/domain/asistencia.js';
import { infoVentana, turnosPlanificados } from '../src/domain/horarios.js';
import { clasificarPosicion, desplazar, distancia } from '../src/domain/geo.js';
import { instante, partes, lunesDe, sumarDias, esFecha } from '../src/domain/tiempo.js';
import { esquemaAjustes } from '../src/domain/ajustes.js';

const cfg = { toleranciaMin: 10, intervaloControlMin: 30 };
const turno = { fecha: '2026-09-23', inicio: '16:00', fin: '19:00' };
const m = (tipo, hora, estado = 'dentro', extra = {}) => ({ tipo, hora: hora + ':00', estado, distancia_m: 10, precision_m: 10, observaciones: [], ...extra });

test('tiempo: instante y partes son inversos en Lima', () => {
  const t = instante('2026-09-23', '16:05', 'America/Lima');
  assert.deepEqual([partes(t).fecha, partes(t).hora], ['2026-09-23', '16:05']);
  assert.equal(lunesDe('2026-09-27'), '2026-09-21');
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  assert.ok(esFecha('2026-02-28') && !esFecha('2026-02-30'));
});

test('asistencia: turno futuro está programado y sin alertas', () => {
  const ev = evaluar([], turno, { fecha: '2026-09-22', minutos: 600 }, cfg);
  assert.equal(ev.estado, 'PROGRAMADO');
  assert.equal(ev.resultado, 'programado');
});

test('asistencia: sin entrada pasada la tolerancia → NO LLEGA; pasado el fin → FALTA', () => {
  assert.equal(evaluar([], turno, { fecha: turno.fecha, minutos: 16 * 60 + 11 }, cfg).estado, 'NO LLEGA');
  const ev = evaluar([], turno, { fecha: turno.fecha, minutos: 19 * 60 + 1 }, cfg);
  assert.equal(ev.resultado, 'falta');
  assert.deepEqual(multasDelTurno(ev, turno, { tardanza: 5, falta: 20 }).map((x) => x.tipo), ['falta']);
});

test('asistencia: tardanza, reportes cada 30 min y salida', () => {
  const ms = [m('entrada', '16:25'), m('control', '16:55'), m('control', '17:26', 'fuera', { distancia_m: 400 }), m('salida', '19:02')];
  const ev = evaluar(ms, turno, { fecha: '2026-09-24', minutos: 0 }, cfg);
  assert.equal(ev.resultado, 'tarde');
  assert.equal(ev.minutosTarde, 25);
  assert.equal(ev.estado, 'TERMINÓ');
  assert.equal(ev.minutosEnLocal, 157);
  // Franjas 16:55, 17:25, 17:55, 18:25, 18:55 → 2 recibidas, 3 perdidas
  assert.equal(ev.esperados, 5);
  assert.equal(ev.recibidos, 2);
  const tipos = ev.alertas.map((a) => a.tipo);
  assert.ok(tipos.includes('TARDANZA') && tipos.includes('FUERA_DEL_LOCAL') && tipos.includes('SIN_REPORTES'));
  assert.deepEqual(multasDelTurno(ev, turno, { tardanza: 5, falta: 20 }).map((x) => x.monto), [5]);
});

test('asistencia: salida anticipada genera alerta y multa si está configurada', () => {
  const ev = evaluar([m('entrada', '15:58'), m('salida', '17:30')], turno, { fecha: '2026-09-24', minutos: 0 }, { ...cfg, intervaloControlMin: 0 });
  assert.equal(ev.salidaAnticipada, 90);
  assert.deepEqual(multasDelTurno(ev, turno, { tardanza: 5, falta: 20, salidaAnticipada: 10 }).map((x) => x.tipo), ['salida_anticipada']);
});

test('asistencia: franjas pendientes y futuras', () => {
  const fr = franjas([m('entrada', '16:00')], turno, { fecha: turno.fecha, minutos: 16 * 60 + 40 }, 30);
  assert.deepEqual(fr.lista.map((x) => x.estado), ['pendiente', 'futuro']);
});

test('horarios: ventana del domingo 21:00–22:00 para la semana siguiente', () => {
  const v = { dia: 0, desde: '21:00', hasta: '22:00' };
  const abierta = infoVentana(v, { fecha: '2026-09-27', minutos: 21 * 60 + 15 });
  assert.equal(abierta.abierta, true);
  assert.equal(abierta.semana, '2026-09-28');
  assert.equal(abierta.quedan, 45);
  const cerrada = infoVentana(v, { fecha: '2026-09-23', minutos: 600 });
  assert.equal(cerrada.abierta, false);
  assert.equal(cerrada.fecha, '2026-09-27');
});

test('horarios: plantilla con cupos y días especiales', () => {
  const pl = [{ dia: 3, inicio: '10:00', fin: '14:00', cupos: 2 }, { dia: 3, inicio: '16:00', fin: '19:00', cupos: 1 }];
  assert.equal(turnosPlanificados('2026-09-23', pl, null).length, 3);
  assert.equal(turnosPlanificados('2026-09-23', pl, { cerrado: true, turnos: [] }).length, 0);
  assert.deepEqual(turnosPlanificados('2026-09-23', pl, { cerrado: false, turnos: [{ inicio: '09:00', fin: '21:00', cupos: 3 }] }).map((t) => t.origen), ['especial', 'especial', 'especial']);
});

test('geo: geocerca con margen de precisión y detección de GPS falso', () => {
  const tienda = { lat: -7.1547444, lng: -78.5166566, radio_m: 80 };
  const cerca = desplazar(tienda.lat, tienda.lng, 50, 0);
  assert.equal(clasificarPosicion({ pos: { ...cerca, precision: 10 }, tienda }).estado, 'dentro');
  const lejos = desplazar(tienda.lat, tienda.lng, 500, 1);
  assert.equal(clasificarPosicion({ pos: { ...lejos, precision: 10 }, tienda }).estado, 'fuera');
  assert.equal(clasificarPosicion({ pos: { ...cerca, precision: 300 }, tienda, precisionMaxima: 100 }).estado, 'imprecisa');
  const salto = clasificarPosicion({ pos: { ...desplazar(tienda.lat, tienda.lng, 5000, 0), precision: 10 }, tienda, anterior: { ...cerca, ts: 0 }, recibido: 10000 });
  assert.match(salto.observaciones[0], /GPS falso/);
  assert.match(clasificarPosicion({ pos: { ...cerca, precision: 5 }, tienda, dispositivo: 'b', dispositivoHabitual: 'a' }).observaciones[0], /celular distinto/);
  assert.ok(Math.abs(distancia(tienda.lat, tienda.lng, cerca.lat, cerca.lng) - 50) < 1);
});

test('ajustes: valores por defecto y validación', () => {
  const a = esquemaAjustes.parse({});
  assert.equal(a.toleranciaMin, 30);
  assert.equal(a.checklistApertura.length, 3);
  assert.equal(esquemaAjustes.safeParse({ ventana: { dia: 0, desde: '22:00', hasta: '21:00' } }).success, false);
});
