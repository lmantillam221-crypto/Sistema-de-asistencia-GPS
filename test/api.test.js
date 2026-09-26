import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { servidorPrueba } from './ayuda.js';
import { desplazar } from '../src/domain/geo.js';
import { leerFuenteAnterior, importarAnterior } from '../src/lib/importar.js';

const TIENDA = { lat: -7.1547444, lng: -78.5166566 };
const aqui = (m = 5) => ({ ...desplazar(TIENDA.lat, TIENDA.lng, m, 0.3), precision: 12 });
let S, panel, ana, lucia, tiendaId;
const turnoDe = async (cli, fecha, quien) => {
  const r = await panel.get(`/api/panel/semana?lunes=${fecha}`);
  return r.body.turnos.find((t) => t.fecha === fecha && (quien === undefined || t.usuario_id === quien));
};

before(async () => {
  S = await servidorPrueba({ fecha: '2026-09-23', hora: '10:00' }); // miércoles
  panel = S.cliente(); ana = S.cliente(); lucia = S.cliente();
});
after(() => S.cerrar());

test('seguridad: sin sesión 401, sin JSON 415', async () => {
  assert.equal((await panel.get('/api/panel/yo')).status, 401);
  const r = await fetch(S.base + '/api/panel/login', { method: 'POST', body: 'codigo=admin' });
  assert.equal(r.status, 415);
});

test('panel: el admin configura tienda, plantilla y equipo', async () => {
  assert.equal((await panel.post('/api/panel/login', { codigo: 'admin', clave: 'mala' })).status, 401);
  const l = await panel.post('/api/panel/login', { codigo: 'admin', clave: 'admin-clave-123' });
  assert.equal(l.status, 200);
  const t = await panel.post('/api/panel/tiendas', { nombre: 'Galería Arcángel', lat: TIENDA.lat, lng: TIENDA.lng, radio_m: 80 });
  assert.equal(t.status, 201);
  tiendaId = t.body.id;
  const pl = await panel.put(`/api/panel/tiendas/${tiendaId}/plantillas`, { turnos: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, inicio: '16:00', fin: '19:00' })) });
  assert.equal(pl.status, 200);
  assert.equal((await panel.post('/api/panel/usuarios', { codigo: 'V01', nombre: 'Ana Torres', secreto: '1111', telefono: '911111111' })).status, 201);
  assert.equal((await panel.post('/api/panel/usuarios', { codigo: 'V02', nombre: 'Lucía Ramos', secreto: '2222' })).status, 201);
  assert.equal((await panel.post('/api/panel/usuarios', { codigo: 'V03', nombre: 'X', secreto: '12' })).status, 400, 'PIN corto');
  assert.equal((await panel.post('/api/panel/usuarios', { codigo: 'V01', nombre: 'Dup', secreto: '1234' })).status, 409);
});

test('login: una colaboradora no entra al panel', async () => {
  assert.equal((await S.cliente().post('/api/panel/login', { codigo: 'V01', clave: '1111' })).status, 403);
  assert.equal((await ana.post('/api/app/login', { codigo: 'v01', clave: '1111' })).status, 200);
  assert.equal((await lucia.post('/api/app/login', { codigo: 'V02', clave: '2222' })).status, 200);
});

test('horarios: elección solo dentro de la ventana y el primero gana', async () => {
  const h = await ana.get('/api/app/horario?semana=2026-09-28');
  const t = h.body.turnos.find((x) => x.fecha === '2026-09-30');
  assert.equal((await ana.post(`/api/app/turnos/${t.id}/elegir`)).status, 403, 'ventana cerrada');
  S.irA('2026-09-27', '21:10'); // domingo, ventana abierta
  assert.equal((await ana.post(`/api/app/turnos/${t.id}/elegir`)).status, 200);
  assert.equal((await lucia.post(`/api/app/turnos/${t.id}/elegir`)).status, 409, 'ya elegido');
  const otro = h.body.turnos.find((x) => x.fecha === '2026-10-01');
  assert.equal((await ana.post(`/api/app/turnos/${otro.id}/elegir`)).status, 409, 'máximo 1 por semana');
  assert.equal((await lucia.post(`/api/app/turnos/${otro.id}/elegir`)).status, 200);
});

test('marcas: entrada tarde con GPS, reportes, salida con cuadre de caja', async () => {
  S.irA('2026-09-30', '13:00');
  assert.equal((await ana.post('/api/app/marcas', { tipo: 'entrada', ...aqui() })).status, 422, 'demasiado temprano');
  assert.equal((await lucia.post('/api/app/marcas', { tipo: 'entrada', ...aqui() })).status, 422, 'no tiene turno hoy');
  S.irA('2026-09-30', '16:45');
  const e = await ana.post('/api/app/marcas', { tipo: 'entrada', ...aqui(), dispositivo: 'cel-ana', apertura: ['Caja inicial contada'] });
  assert.equal(e.status, 201);
  assert.equal(e.body.marca.estado, 'dentro');
  assert.equal(e.body.marca.hora.slice(0, 5), '16:45', 'la hora la pone el servidor');
  assert.equal((await ana.post('/api/app/marcas', { tipo: 'entrada', ...aqui() })).status, 409);
  S.irA('2026-09-30', '17:15');
  const lejos = desplazar(TIENDA.lat, TIENDA.lng, 900, 1);
  const c = await ana.post('/api/app/marcas', { tipo: 'control', ...lejos, precision: 10, dispositivo: 'otro-cel' });
  assert.equal(c.body.marca.estado, 'fuera');
  assert.ok(c.body.marca.observaciones.some((o) => /celular distinto/.test(o)));
  const hoy = await ana.get('/api/app/hoy');
  assert.equal(hoy.body.abierto, hoy.body.turnosHoy[0].id);
  assert.equal(hoy.body.turnosHoy[0].ev.resultado, 'tarde');
  assert.equal(hoy.body.multas.cantidad, 1, 'multa por tardanza inmediata');
  S.irA('2026-09-30', '19:02');
  const s = await ana.post('/api/app/marcas', { tipo: 'salida', ...aqui(), cierre: { ventas: 6, prendas: 9, efectivo: 120, digital: 250.5, tarjeta: 0, cierre: ['Caja cuadrada'] } });
  assert.equal(s.status, 201);
  assert.equal((await ana.post('/api/app/marcas', { tipo: 'control', ...aqui() })).status, 422, 'turno cerrado');
});

test('panel: día, período, planilla y exportación', async () => {
  const d = await panel.get('/api/panel/dia?fecha=2026-09-30');
  const it = d.body.items.find((x) => x.asignado);
  assert.equal(it.asignado.ev.estado, 'TERMINÓ');
  assert.ok(d.body.alertas.some((a) => a.tipo === 'FUERA_DEL_LOCAL'));
  const p = await panel.get('/api/panel/periodo?desde=2026-09-28&hasta=2026-10-04');
  const fila = p.body.filas.find((f) => f.nombre === 'Ana Torres');
  assert.equal(fila.resultado, 'tarde');
  assert.equal(fila.montoVentas, 370.5);
  assert.equal(fila.multa, 5);
  const pl = await panel.get('/api/panel/planilla?desde=2026-09-28&hasta=2026-10-04');
  assert.equal(pl.body.filas.find((f) => f.codigo === 'V01').ventas, 6);
  const csv = await panel.get('/api/panel/export/asistencia.csv?desde=2026-09-28&hasta=2026-10-04');
  assert.match(csv.body, /Ana Torres/);
});

test('multas: falta automática, justificación y anulación', async () => {
  S.irA('2026-10-01', '19:30'); // Lucía no fue
  S.ctx.s.multas.sincronizar();
  const m = await lucia.get('/api/app/multas');
  const falta = m.body.lista.find((x) => x.tipo === 'falta');
  assert.ok(falta);
  assert.equal(m.body.pendiente, 20);
  assert.equal((await lucia.post(`/api/app/multas/${falta.id}/justificar`, { motivo: 'Cita médica con certificado' })).status, 201);
  const js = await panel.get('/api/panel/justificaciones?estado=pendiente');
  assert.equal(js.body.length, 1);
  assert.equal((await panel.post(`/api/panel/justificaciones/${js.body[0].id}/resolver`, { aprobar: true })).status, 200);
  assert.equal((await lucia.get('/api/app/multas')).body.pendiente, 0);
  // pagar la tardanza de Ana
  const ma = await panel.get('/api/panel/multas?estado=pendiente');
  assert.equal(ma.body.lista.length, 1);
  assert.equal((await panel.post(`/api/panel/multas/${ma.body.lista[0].id}/estado`, { estado: 'pagada' })).body.estado, 'pagada');
});

test('coberturas: Ana ofrece su turno y Lucía lo toma', async () => {
  S.irA('2026-10-02', '09:00');
  const t = await turnoDe(panel, '2026-10-03');
  const anaId = (await ana.get('/api/app/hoy')).body.usuario.id;
  assert.equal((await panel.put(`/api/panel/turnos/${t.id}/asignar`, { usuarioId: anaId })).status, 200);
  const sol = await ana.post('/api/app/coberturas', { turnoId: t.id, motivo: 'Viaje' });
  assert.equal(sol.status, 201);
  const ab = await lucia.get('/api/app/coberturas');
  assert.equal(ab.body.abiertas.length, 1);
  assert.equal((await lucia.post(`/api/app/coberturas/${sol.body.id}/tomar`)).status, 200);
  assert.equal((await turnoDe(panel, '2026-10-03')).usuario_nombre, 'Lucía Ramos');
  assert.equal((await ana.post(`/api/app/coberturas/${sol.body.id}/tomar`)).status, 409);
});

test('días especiales: cierre por feriado elimina turnos libres', async () => {
  const antes = (await panel.get('/api/panel/semana?lunes=2026-10-05')).body.turnos.filter((t) => t.fecha === '2026-10-08').length;
  assert.equal(antes, 1);
  assert.equal((await panel.post('/api/panel/dias-especiales', { fecha: '2026-10-08', cerrado: true, motivo: 'Feriado' })).status, 201);
  const despues = (await panel.get('/api/panel/semana?lunes=2026-10-05')).body.turnos.filter((t) => t.fecha === '2026-10-08').length;
  assert.equal(despues, 0);
});

test('seguridad: bloqueo tras 5 intentos fallidos', async () => {
  const c = S.cliente();
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/app/login', { codigo: 'V02', clave: '0000' })).status, 401);
  assert.equal((await c.post('/api/app/login', { codigo: 'V02', clave: '2222' })).status, 429);
});

test('importación desde la versión anterior (respaldo JSON)', async () => {
  const S2 = await servidorPrueba({ fecha: '2026-09-23', hora: '20:00' });
  try {
    const respaldo = {
      app: 'nube-chic-asistencia', version: 3, datos: {
        'config/principal': { empresa: 'Nube.chic', zonaHoraria: 'America/Lima', claveSupervisor: 'x', intervaloControlMin: 30, precisionMaximaM: 100,
          local: { id: 'L1', nombre: 'GALERIA DEMO', lat: -7.15, lng: -78.51, radioM: 80 },
          socios: [{ id: 'V01', nombre: 'SOCIA UNO', pin: '4321', telefono: '900000001' }, { id: 'V02', nombre: 'SOCIA DOS', pin: '8765', telefono: '' }],
          turnos: { 3: [{ id: 'A', inicio: '16:00', fin: '19:00' }] }, toleranciaMin: 30, maxTurnosSemana: 1, ventana: { dia: 0, desde: '21:00', hasta: '22:00' }, multas: { tardanza: 5, falta: 20 } },
        'semanas/2026-09-21': { dias: { '2026-09-23': { A: { sid: 'V01', inicio: '16:00', fin: '19:00', por: 'socio', en: 1 } } } },
        'marcas/a': { socioId: 'V01', tipo: 'entrada', fecha: '2026-09-23', hora: '16:40:00', lat: -7.15, lng: -78.51, precision: 10, distancia: 3, estado: 'dentro', observacion: null, creado: 1 },
        'multas/2026-09-23_A_V01_tardanza': { socioId: 'V01', fecha: '2026-09-23', turnoId: 'A', tipo: 'tardanza', monto: 5, detalle: 'tarde', estado: 'pagada', pagadaEn: '2026-09-24' },
      },
    };
    const datos = leerFuenteAnterior(JSON.stringify(respaldo));
    const r = importarAnterior(S2.ctx, datos);
    assert.deepEqual([r.colaboradoras, r.turnos, r.marcas, r.multas], [2, 1, 1, 1]);
    const c = S2.cliente();
    assert.equal((await c.post('/api/app/login', { codigo: 'V01', clave: '4321' })).status, 200, 'mantiene su PIN');
    S2.ctx.s.multas.sincronizar();
    assert.equal(S2.ctx.s.multas.listar({ estado: 'todas' }).length, 1, 'no duplica la multa importada');
    // Idempotente para colaboradoras
    assert.equal(importarAnterior(S2.ctx, datos).colaboradoras, 0);
  } finally { await S2.cerrar(); }
});
