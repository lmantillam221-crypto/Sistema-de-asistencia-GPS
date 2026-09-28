/* Mide cuántas idas y vueltas a la base hace cada pantalla y cuánto tardaría con la base lejos
   (LAT ms por consulta, por defecto 130: función en EE. UU. y base en São Paulo). Uso: node test/latencia.mjs */
import { motorPostgres, fuentePglite } from '../src/db/motor.js';
import { migrar } from '../src/db/index.js';
import { crearContexto } from '../src/services/index.js';
import { crearApp } from '../src/app.js';
import { leerConfig } from '../src/config.js';
import { asegurarBaseDemo, generarEjemplo } from '../src/lib/demo.js';

const LAT = Number(process.env.LAT ?? 130);
const base = await fuentePglite();
let viajes = 0, medir = false;
const esperar = () => (medir ? (viajes++, new Promise((r) => setTimeout(r, LAT))) : Promise.resolve());
const fuente = {
  ...base,
  consultar: async (t, p, c) => { await esperar(); return base.consultar(t, p, c); },
  ejecutarVarias: async (t, c) => { await esperar(); return base.ejecutarVarias(t, c); },
  transaccion: async (fn) => { await esperar(); const r = await base.transaccion(fn); await esperar(); return r; },
};
const db = motorPostgres(fuente);
await migrar(db);
const cfg = { ...leerConfig({}), dbPath: ':memory:', demo: true, admin: { codigo: 'admin', password: 'admin12345', nombre: 'Admin' } };
const ctx = await crearContexto(cfg, { db });
await asegurarBaseDemo(ctx); await generarEjemplo(ctx);
const srv = await new Promise((ok) => { const s = crearApp(ctx).listen(0, () => ok(s)); });
const URL0 = `http://127.0.0.1:${srv.address().port}`;
const cliente = () => {
  let cookie = '';
  return async (metodo, ruta, cuerpo) => {
    const r = await fetch(URL0 + ruta, { method: metodo, headers: { 'content-type': 'application/json', cookie }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const k = kv.split('=')[0]; cookie = cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')).concat(kv.endsWith('=') ? [] : [kv]).join('; '); }
    return r.status;
  };
};
const app = cliente(), panel = cliente();
const filas = [];
const paso = async (c, nombre, m, ruta, cuerpo) => {
  if (m === 'GET') await c(m, ruta); // la primera vez genera días futuros (una sola vez en la vida del sistema)
  medir = true; viajes = 0; const t = performance.now();
  const st = await c(m, ruta, cuerpo);
  const ms = performance.now() - t; medir = false;
  filas.push({ pantalla: nombre, estado: st, consultas: viajes, ms: Math.round(ms) });
};
await paso(app, 'estado (abrir app)', 'GET', '/api/estado');
await paso(app, 'login socia', 'POST', '/api/app/login', { codigo: 'V01', clave: '1111' });
await paso(app, 'app · Hoy', 'GET', '/api/app/hoy');
await paso(app, 'app · Horario', 'GET', '/api/app/horario');
await paso(app, 'app · Multas', 'GET', '/api/app/multas');
await paso(app, 'app · Historial', 'GET', '/api/app/historial');
await paso(app, 'app · marcar entrada', 'POST', '/api/app/marcas', { tipo: 'entrada', lat: -7.1547444, lng: -78.5166566, precision: 10 });
await paso(panel, 'login panel', 'POST', '/api/panel/login', { codigo: 'admin', clave: 'admin12345' });
for (const r of ['yo', 'dia', 'en-vivo', 'semana', 'periodo', 'multas', 'usuarios', 'tiendas', 'coberturas']) await paso(panel, 'panel · ' + r, 'GET', '/api/panel/' + r);
console.table(filas);
console.log('Total consultas:', filas.reduce((s, f) => s + f.consultas, 0), '· tiempo total:', filas.reduce((s, f) => s + f.ms, 0), 'ms');
srv.close(); await base.cerrar();
