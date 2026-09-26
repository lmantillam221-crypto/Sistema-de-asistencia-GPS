/* La API tal como corre en Netlify: sql.js + almacenamiento con ETag, dos instancias en paralelo. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { almacenMemoria } from '../src/nube/almacen.js';
import { leerEquipo } from '../src/lib/configuracion-inicial.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-netlify-'));
const empaquetar = async (n) => {
  const out = path.join(dir, `instancia${n}.mjs`);
  await build({ entryPoints: ['src/nube/funcion.js'], outfile: out, bundle: true, platform: 'node', format: 'esm', loader: { '.sql': 'text' }, logLevel: 'error',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
  return import(out);
};
let A, B;
const almacen = almacenMemoria();
const cliente = (inst) => {
  let cookie = '';
  const pedir = async (method, ruta, body) => {
    const r = await inst.atenderNetlify(new Request('https://nube.test/.netlify/functions/api' + ruta.replace(/^\/api/, ''), {
      method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    }), { almacen, env: {} });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const k = kv.split('=')[0]; cookie = cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')).concat(kv.endsWith('=') ? [] : [kv]).join('; '); }
    return { status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() };
  };
  return { get: (u) => pedir('GET', u), post: (u, b = {}) => pedir('POST', u, b), put: (u, b = {}) => pedir('PUT', u, b), del: (u) => pedir('DELETE', u, {}) };
};

before(async () => { A = await empaquetar(1); B = await empaquetar(2); });

test('equipo: lee nombres y celulares en distintos formatos', () => {
  const eq = leerEquipo('Analy Alcantara 998 814 382\nDiariksa Valdez  914 145 106\nFlor Cueva 917665137\nLuis Carmona, +51 917 950 979\n\n');
  assert.deepEqual(eq.map((x) => x.telefono), ['998814382', '914145106', '917665137', '917950979']);
  assert.equal(eq[1].nombre, 'Diariksa Valdez');
});

let equipo;
test('primer uso: asistente de configuración y accesos del equipo', async () => {
  const p = cliente(A);
  assert.equal((await p.get('/api/estado')).body.configurar, true);
  assert.equal((await p.get('/api/estado')).body.tiempoReal, 'sondeo');
  const r = await p.post('/api/panel/configurar', {
    empresa: 'Nube.chic', admin: { codigo: 'admin', nombre: 'Dueña', clave: 'clave-segura-1' },
    tienda: { nombre: 'Galería Arcángel', coords: '-7.1547444, -78.5166566', radio_m: 80 }, horario: { inicio: '16:00', fin: '19:00' },
    equipo: 'Analy Alcantara 998 814 382\nFlor Pari 946 745 424',
  });
  assert.equal(r.status, 201);
  equipo = r.body.equipo;
  assert.deepEqual(equipo.map((x) => x.codigo), ['V01', 'V02']);
  assert.match(equipo[0].pin, /^\d{4}$/);
  assert.equal((await p.get('/api/panel/yo')).status, 200, 'queda con sesión iniciada');
  assert.equal((await cliente(B).post('/api/panel/configurar', { admin: { codigo: 'otra', nombre: 'Otra', clave: '12345678' }, tienda: { nombre: 'T', coords: '-7.1, -78.5' } })).status, 409, 'no se puede repetir');
  assert.equal((await cliente(B).get('/api/estado')).body.configurar, false, 'la otra instancia ve los datos guardados');
});

test('otra instancia: la socia ingresa y ve sus datos', async () => {
  const s = cliente(B);
  assert.equal((await s.post('/api/app/login', { codigo: 'V01', clave: equipo[0].pin })).status, 200);
  const h = await s.get('/api/app/hoy');
  assert.equal(h.status, 200);
  assert.equal(h.body.usuario.nombre, 'Analy Alcantara');
  assert.equal(h.body.ajustes.ventana.desde, '21:00');
});

test('conflicto: dos instancias escriben a la vez y no se pierde nada', async () => {
  const pA = cliente(A), pB = cliente(A);
  await pA.post('/api/panel/login', { codigo: 'admin', clave: 'clave-segura-1' });
  const pB2 = cliente(B);
  await pB2.post('/api/panel/login', { codigo: 'admin', clave: 'clave-segura-1' });
  // Ambas instancias ya tienen la base cargada; crean personas "al mismo tiempo"
  const [r1, r2] = await Promise.all([
    pA.post('/api/panel/usuarios', { codigo: 'V10', nombre: 'Persona A', secreto: '1234' }),
    pB2.post('/api/panel/usuarios', { codigo: 'V11', nombre: 'Persona B', secreto: '5678' }),
  ]);
  assert.equal(r1.status, 201); assert.equal(r2.status, 201);
  const lista = (await pA.get('/api/panel/usuarios')).body.usuarios.map((u) => u.codigo);
  assert.ok(lista.includes('V10') && lista.includes('V11'), 'las dos personas quedaron guardadas');
  assert.ok(pB);
});
