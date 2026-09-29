/* Horarios flexibles: elegir hora de entrada y salida, límites de horas, edición y borrado desde el panel,
   y que la plantilla no cambie días editados a mano ni duplique turnos elegidos con otra hora. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servidorPrueba } from './ayuda.js';

let S, panel, ana, lucia, tiendaId;
const semana = async (lunes = '2026-09-28') => (await panel.get(`/api/panel/semana?lunes=${lunes}`)).body.turnos;
const delDia = async (f) => (await semana()).filter((t) => t.fecha === f);
const plantilla = (inicio, fin, cupos) => panel.put(`/api/panel/tiendas/${tiendaId}/plantillas`, { turnos: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, inicio, fin, cupos })) });

before(async () => {
  S = await servidorPrueba({ fecha: '2026-09-23', hora: '10:00' });
  panel = S.cliente(); ana = S.cliente(); lucia = S.cliente();
  await panel.post('/api/panel/login', { codigo: 'admin', clave: 'admin-clave-123' });
  tiendaId = (await panel.post('/api/panel/tiendas', { nombre: 'Tienda', lat: -7.15, lng: -78.51, radio_m: 80 })).body.id;
  assert.equal((await plantilla('10:00', '21:00', 2)).status, 200);
  await panel.post('/api/panel/usuarios', { codigo: 'V01', nombre: 'Ana Torres', secreto: '1111' });
  await panel.post('/api/panel/usuarios', { codigo: 'V02', nombre: 'Lucía Ramos', secreto: '2222' });
  await ana.post('/api/app/login', { codigo: 'V01', clave: '1111' });
  await lucia.post('/api/app/login', { codigo: 'V02', clave: '2222' });
});
after(() => S.cerrar());

test('configuración: horas mínimas y máximas por turno y por semana', async () => {
  const mal = await panel.put('/api/panel/ajustes', { ajustes: { horasMinTurno: 6, horasMaxTurno: 4 } });
  assert.equal(mal.status, 400, 'mínimo mayor que máximo');
  const r = await panel.put('/api/panel/ajustes', { ajustes: { elegirHoras: true, pasoMinutos: 30, horasMinTurno: 3, horasMaxTurno: 6, horasMaxSemana: 8, maxTurnosSemana: 3, mostrarCompaneras: false } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ajustes.horasMaxSemana, 8);
});

test('elegir: con hora de entrada y salida dentro del bloque y respetando los límites', async () => {
  S.irA('2026-09-27', '21:10'); // domingo, ventana abierta para la semana del 28
  const h = (await ana.get('/api/app/horario?semana=2026-09-28')).body;
  assert.equal(h.reglas.minTurno, 3);
  const mar = h.turnos.find((t) => t.fecha === '2026-09-29'), mie = h.turnos.find((t) => t.fecha === '2026-09-30');
  const elegir = (c, t, inicio, fin) => c.post(`/api/app/turnos/${t.id}/elegir`, { inicio, fin });
  assert.equal((await elegir(ana, mar, '12:00', '14:00')).status, 400, 'menos del mínimo');
  assert.equal((await elegir(ana, mar, '10:00', '17:00')).status, 400, 'más del máximo por turno');
  assert.equal((await elegir(ana, mar, '12:15', '16:00')).status, 400, 'fuera del intervalo de 30 min');
  assert.equal((await elegir(ana, mar, '09:00', '13:00')).status, 400, 'fuera del bloque');
  const ok = await elegir(ana, mar, '12:00', '16:00');
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.inicio, '12:00'); assert.equal(ok.body.fin, '16:00');
  assert.equal((await elegir(ana, mie, '10:00', '15:00')).status, 409, 'pasaría las 8 h semanales');
  assert.equal((await elegir(ana, mie, '15:00', '19:00')).status, 200);
  const l = (await lucia.get('/api/app/horario?semana=2026-09-28')).body;
  assert.equal(l.turnos.find((t) => t.id === mar.id).usuario, 'Ocupado', 'no muestra compañeras si está desactivado');
  const a = (await ana.get('/api/app/horario?semana=2026-09-28')).body;
  assert.equal(a.horasTengo, 8);
});

test('soltar: el turno vuelve a su bloque original', async () => {
  const mar = (await delDia('2026-09-29')).find((t) => t.usuario_id);
  assert.equal((await ana.del(`/api/app/turnos/${mar.id}/elegir`)).status, 200);
  const t = (await delDia('2026-09-29')).find((x) => x.id === mar.id);
  assert.equal(t.inicio, '10:00'); assert.equal(t.fin, '21:00'); assert.equal(t.usuario_id, null);
});

test('plantilla: no duplica turnos elegidos con otra hora', async () => {
  S.irA('2026-09-27', '23:00');
  assert.equal((await plantilla('10:00', '21:00', 1)).status, 200);
  const mie = await delDia('2026-09-30');
  assert.equal(mie.length, 1, 'queda solo el turno elegido (15:00–19:00), sin un bloque duplicado');
  assert.equal(mie[0].inicio, '15:00');
});

test('panel: modificar y borrar cualquier turno; la plantilla ya no cambia ese día', async () => {
  const jue = (await delDia('2026-10-01'))[0];
  const e = await panel.put(`/api/panel/turnos/${jue.id}`, { inicio: '14:00', fin: '18:00', usuarioId: null });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal((await panel.put(`/api/panel/turnos/${jue.id}`, { inicio: '18:00', fin: '14:00' })).status, 400);
  const vie = (await delDia('2026-10-02'))[0];
  assert.equal(vie.origen, 'plantilla');
  assert.equal((await panel.del(`/api/panel/turnos/${vie.id}`)).status, 200, 'se puede borrar un turno de plantilla');
  assert.equal((await plantilla('11:00', '20:00', 1)).status, 200);
  const j = await delDia('2026-10-01');
  assert.deepEqual(j.map((t) => `${t.inicio}-${t.fin}`), ['14:00-18:00'], 'el día editado a mano no cambia');
  assert.equal((await delDia('2026-10-02')).length, 0, 'el turno borrado no vuelve');
  assert.deepEqual((await delDia('2026-10-03')).map((t) => `${t.inicio}-${t.fin}`), ['11:00-20:00'], 'los demás días sí toman la plantilla nueva');
});

test('panel: asignar a alguien al editar y avisar cruces', async () => {
  const sab = (await delDia('2026-10-03'))[0];
  const lu = (await panel.get('/api/panel/usuarios')).body.usuarios.find((u) => u.codigo === 'V02');
  const r = await panel.put(`/api/panel/turnos/${sab.id}`, { inicio: '12:00', fin: '18:00', usuarioId: lu.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.usuario_id, lu.id);
  const extra = await panel.post('/api/panel/turnos', { tienda_id: tiendaId, fecha: '2026-10-03', inicio: '17:00', fin: '20:00' });
  assert.equal((await panel.put(`/api/panel/turnos/${extra.body.id}`, { usuarioId: lu.id })).status, 409, 'se cruza con su turno');
});
