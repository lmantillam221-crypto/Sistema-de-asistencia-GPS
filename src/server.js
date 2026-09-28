import { leerConfig } from './config.js';
import { crearContexto } from './services/index.js';
import { abrirDB } from './db/abrir.js';
import { crearApp } from './app.js';
import { iniciarTareas } from './jobs.js';
import { asegurarBaseDemo } from './lib/demo.js';

const cfg = leerConfig();
const ctx = await crearContexto(cfg, { db: await abrirDB(cfg.dbPath) });
if (cfg.demo) await asegurarBaseDemo(ctx);
const app = crearApp(ctx);
const detener = iniciarTareas(ctx);

const hayAdmin = !!(await ctx.db.prepare("SELECT 1 AS x FROM usuarios WHERE rol = 'admin'").get());
const servidor = app.listen(cfg.puerto, () => {
  const emp = ctx.s.empresa.obtener();
  console.log(`✔ ${emp.nombre} · Asistencia v3 en http://localhost:${cfg.puerto} (base de datos: ${ctx.db.tipo === 'postgres' ? 'PostgreSQL' : 'SQLite'})`);
  console.log(`  App del equipo: /   ·   Panel de control: /panel${cfg.demo ? '   ·   MODO DEMOSTRACIÓN' : ''}`);
  if (ctx.adminInicial) console.log(`  Administrador inicial → usuario: ${ctx.adminInicial.codigo} (contraseña de ADMIN_PASSWORD)`);
  else if (!hayAdmin) console.log('  Primer uso: abre /panel para crear la cuenta de administración.');
});

function apagar(senal) {
  console.log(`\n${senal}: cerrando…`);
  detener();
  servidor.close(async () => { try { await ctx.db.close(); } catch {} process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));
