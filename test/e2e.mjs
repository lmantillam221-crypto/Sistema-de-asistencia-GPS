/* Prueba de punta a punta en un navegador real (Chromium):
   colaboradora marca entrada con GPS + checklist → reporte automático → salida con cuadre de caja,
   y el panel recorre todas sus secciones sin errores.
   Uso: npm run e2e   (requiere `npx playwright install chromium` la primera vez) */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';

const PUERTO = 3917, B = `http://127.0.0.1:${PUERTO}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-e2e-'));
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.js'], {
  env: { ...process.env, PORT: String(PUERTO), DB_PATH: path.join(dir, 'e2e.db'), DEMO_MODE: '1', ADMIN_PASSWORD: 'admin12345', NODE_ENV: 'development' }, stdio: 'inherit',
});
const errores = [];
const vigilar = (page) => {
  page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/') && r.status() !== 401) errores.push(`HTTP ${r.status()} ${r.url()}`); });
};
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/salud')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  const browser = await chromium.launch();
  const adm = (await browser.newContext()).request;
  await adm.post(B + '/api/panel/login', { data: { codigo: 'admin', clave: 'admin12345' } });
  await adm.post(B + '/api/panel/demo/ejemplo', { data: {} });
  const hoy = (await (await adm.get(B + '/api/estado')).json()).ahora.fecha;
  const dia = await (await adm.get(`${B}/api/panel/dia?fecha=${hoy}`)).json();
  const turno = dia.items.find((i) => i.turno.usuario_id)?.turno;
  assert.ok(turno, 'hay un turno asignado hoy');
  const reloj = (hora) => adm.post(B + '/api/panel/demo/reloj', { data: { fecha: hoy, hora } });
  const h = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const ini = Number(turno.inicio.slice(0, 2)) * 60 + Number(turno.inicio.slice(3));
  await reloj(h(ini - 5));

  // --- App de la colaboradora ---
  const tienda = dia.tiendas.find((t) => t.id === turno.tienda_id);
  const cel = await browser.newContext({ ...devices['Pixel 7'], geolocation: { latitude: tienda.lat + 0.0001, longitude: tienda.lng, accuracy: 12 }, permissions: ['geolocation'] });
  const page = await cel.newPage(); vigilar(page);
  await page.goto(B + '/');
  await page.fill('#lCodigo', turno.usuario_codigo);
  await page.fill('#lPin', turno.usuario_codigo.replace(/\D/g, '').slice(-1).repeat(4));
  await page.check('#lAcepto');
  await page.click('button[type=submit]');
  await page.click('[data-accion=entrada]');
  await page.check('#ap0');
  await page.click('.hoja [data-ok]');
  await page.waitForSelector('[data-accion=salida]');
  await reloj(h(ini + 31));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(2000);
  await reloj(h(ini + 181));
  await page.reload();
  await page.click('[data-accion=salida]');
  await page.fill('#qVentas', '4'); await page.fill('#qEf', '100'); await page.fill('#qDig', '80');
  await page.click('.hoja [data-ok]');
  await page.waitForSelector('.msg.ok');
  const d2 = await (await adm.get(`${B}/api/panel/dia?fecha=${hoy}`)).json();
  const ev = d2.items.find((i) => i.turno.id === turno.id).asignado;
  assert.equal(ev.ev.estado, 'TERMINÓ');
  assert.ok(ev.ev.reportes >= 1, 'llegó al menos un reporte automático');
  assert.equal(ev.reporte.ventas, 4);
  await adm.post(B + '/api/panel/demo/reloj', { data: {} });

  // --- Panel ---
  const pc = await (await browser.newContext({ viewport: { width: 1366, height: 860 } })).newPage(); vigilar(pc);
  await pc.goto(B + '/panel');
  await pc.fill('#pUsuario', 'admin'); await pc.fill('#pClave', 'admin12345');
  await pc.click('#fLogin button[type=submit]');
  await pc.waitForSelector('aside.lateral');
  for (const s of ['dashboard', 'horarios', 'multas', 'equipo', 'reportes', 'tiendas', 'ajustes', 'auditoria', 'hoy']) {
    await pc.click(`[data-ir=${s}]`);
    await pc.waitForFunction(() => !document.querySelector('#contenido .cargando'));
  }
  await browser.close();
  assert.deepEqual(errores, []);
  console.log('✔ E2E correcto: entrada, reporte GPS, salida con cuadre y panel completo.');
} finally {
  srv.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
