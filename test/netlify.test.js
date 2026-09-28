/* La API tal como corre en Netlify: función empaquetada + PostgreSQL real (PGlite en memoria).
   Dos instancias de la función comparten la misma base, como en producción. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { fuentePglite } from '../src/db/motor.js';
import { abrirSqlite } from '../src/db/abrir.js';
import { migrar } from '../src/db/index.js';
import { crearContexto } from '../src/services/index.js';
import { leerConfig } from '../src/config.js';
import { leerEquipo } from '../src/lib/configuracion-inicial.js';
import { asegurarBaseDemo, generarEjemplo } from '../src/lib/demo.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-netlify-'));
const empaquetar = async (n) => {
  const out = path.join(dir, `instancia${n}.mjs`);
  await build({ entryPoints: ['src/nube/funcion.js'], outfile: out, bundle: true, platform: 'node', format: 'esm', loader: { '.sql': 'text' }, logLevel: 'error',
    external: ['@electric-sql/pglite'], banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
  return import(out);
};
let A, B, fuente;
const cliente = (inst, opciones = {}) => {
  let cookie = '';
  const pedir = async (method, ruta, body) => {
    const r = await inst.atenderNetlify(new Request('https://nube.test/.netlify/functions/api' + ruta.replace(/^\/api/, ''), {
      method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    }), { fuente: opciones.fuente || fuente, env: {}, almacenAnterior: opciones.almacenAnterior });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const k = kv.split('=')[0]; cookie = cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')).concat(kv.endsWith('=') ? [] : [kv]).join('; '); }
    return { status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() };
  };
  return { get: (u) => pedir('GET', u), post: (u, b = {}) => pedir('POST', u, b), put: (u, b = {}) => pedir('PUT', u, b), del: (u) => pedir('DELETE', u, {}) };
};

before(async () => { fuente = await fuentePglite(); A = await empaquetar(1); B = await empaquetar(2); });
after(() => fuente.cerrar());

test('equipo: lee nombres y celulares en distintos formatos', () => {
  const eq = leerEquipo('Ana Torres 999 111 222\nCarla Díaz  988 333 444\nRosa Chávez 977555666\nDiego Rojas, +51 966 777 888\n\n');
  assert.deepEqual(eq.map((x) => x.telefono), ['999111222', '988333444', '977555666', '966777888']);
  assert.equal(eq[1].nombre, 'Carla Díaz');
});

test('sin base de datos configurada responde un mensaje claro', async () => {
  const r = await A.atenderNetlify(new Request('https://nube.test/.netlify/functions/api/estado'), { env: {} });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).codigo, 'SIN_BASE');
});

let equipo;
test('primer uso en PostgreSQL: asistente de configuración y accesos del equipo', async () => {
  const p = cliente(A);
  const e = await p.get('/api/estado');
  assert.equal(e.status, 200);
  assert.equal(e.body.configurar, true);
  assert.equal(e.body.tiempoReal, 'sondeo');
  const r = await p.post('/api/panel/configurar', {
    empresa: 'Nube.chic', admin: { codigo: 'admin', nombre: 'Dueña', clave: 'clave-segura-1' },
    tienda: { nombre: 'Galería Arcángel', coords: '-7.1547444, -78.5166566', radio_m: 80 }, horario: { inicio: '16:00', fin: '19:00' },
    equipo: 'Ana Torres 999 111 222\nCarla Díaz 988 333 444',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  equipo = r.body.equipo;
  assert.deepEqual(equipo.map((x) => x.codigo), ['V01', 'V02']);
  assert.equal((await p.get('/api/panel/yo')).status, 200, 'queda con sesión iniciada');
  assert.equal((await cliente(B).post('/api/panel/configurar', { admin: { codigo: 'otra', nombre: 'Otra', clave: '12345678' }, tienda: { nombre: 'T', coords: '-7.1, -78.5' } })).status, 409, 'no se puede repetir');
  assert.equal((await cliente(B).get('/api/estado')).body.configurar, false, 'la otra instancia ve los datos');
});

test('otra instancia: la socia ingresa, ve su día y el panel ve el dashboard', async () => {
  const s = cliente(B);
  assert.equal((await s.post('/api/app/login', { codigo: 'v01', clave: equipo[0].pin })).status, 200);
  const h = await s.get('/api/app/hoy');
  assert.equal(h.status, 200, JSON.stringify(h.body));
  assert.equal(h.body.usuario.nombre, 'Ana Torres');
  const p = cliente(A);
  await p.post('/api/panel/login', { codigo: 'admin', clave: 'clave-segura-1' });
  for (const ruta of ['/api/panel/dia', '/api/panel/semana', '/api/panel/periodo', '/api/panel/planilla', '/api/panel/multas', '/api/panel/usuarios', '/api/panel/auditoria', '/api/panel/en-vivo', '/api/panel/respaldo']) {
    const r = await p.get(ruta);
    assert.equal(r.status, 200, `${ruta}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
});

test('concurrencia: 120 peticiones simultáneas desde dos instancias sin errores ni duplicados', async () => {
  const p = cliente(A);
  await p.post('/api/panel/login', { codigo: 'admin', clave: 'clave-segura-1' });
  const crear = Array.from({ length: 40 }, (_, i) => (i % 2 ? cliente(B) : cliente(A)));
  for (const c of crear) await c.post('/api/panel/login', { codigo: 'admin', clave: 'clave-segura-1' });
  const res = await Promise.all([
    ...crear.map((c, i) => c.post('/api/panel/usuarios', { codigo: `C${String(i).padStart(3, '0')}`, nombre: `Persona ${i}`, secreto: String(1000 + i) })),
    ...crear.map((c) => c.post('/api/panel/usuarios', { codigo: 'DUP', nombre: 'Duplicada', secreto: '1234' })),
    ...crear.map((c) => c.get('/api/panel/dia')),
  ]);
  const estados = res.map((r) => r.status);
  assert.ok(!estados.some((s) => s >= 500), `sin errores 5xx: ${estados.filter((s) => s >= 500)}`);
  assert.equal(estados.slice(0, 40).filter((s) => s === 201).length, 40);
  assert.equal(estados.slice(40, 80).filter((s) => s === 201).length, 1, 'el código duplicado se crea una sola vez');
  const lista = (await p.get('/api/panel/usuarios')).body.usuarios;
  assert.equal(lista.filter((u) => u.codigo === 'DUP').length, 1);
});

test('migración automática desde Netlify Blobs (versión anterior) a PostgreSQL', async () => {
  // Base anterior: SQLite con tienda, equipo y 3 semanas de datos
  const archivo = path.join(dir, 'anterior.db');
  const viejo = abrirSqlite(archivo);
  await migrar(viejo);
  const ctxViejo = await crearContexto({ ...leerConfig({}), demo: true, admin: { codigo: 'admin', password: 'clave-vieja-1', nombre: 'A' } }, { db: viejo });
  await asegurarBaseDemo(ctxViejo);
  await generarEjemplo(ctxViejo);
  const cuentas = {};
  for (const t of ['usuarios', 'turnos', 'marcas', 'multas']) cuentas[t] = (await viejo.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).n;
  viejo.close();
  const bytes = new Uint8Array(fs.readFileSync(archivo));

  const pgNuevo = await fuentePglite();
  const C = await empaquetar(3);
  const c = cliente(C, { fuente: pgNuevo, almacenAnterior: async () => ({ bytes }) });
  const e = await c.get('/api/estado');
  assert.equal(e.body.configurar, false, 'ya no pide configurar: se trajo la cuenta anterior');
  assert.equal((await c.post('/api/panel/login', { codigo: 'admin', clave: 'clave-vieja-1' })).status, 200, 'la contraseña anterior sigue funcionando');
  for (const t of ['usuarios', 'turnos', 'marcas', 'multas']) {
    const n = (await pgNuevo.consultar(`SELECT COUNT(*) AS n FROM ${t}`, [])).rows[0].n;
    assert.equal(n, cuentas[t], `${t} migrados`);
  }
  // Los ids nuevos continúan después de los migrados
  assert.equal((await c.post('/api/panel/usuarios', { codigo: 'NUEVA', nombre: 'Nueva', secreto: '4321' })).status, 201);
  await pgNuevo.cerrar();
});
