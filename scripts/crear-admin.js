/* Crea un administrador o restablece su contraseña.
   Uso: npm run crear-admin -- <usuario> <contraseña> ["Nombre"] */
import { leerConfig } from '../src/config.js';
import { crearContexto } from '../src/services/index.js';
import { abrirDB } from '../src/db/abrir.js';

const [codigo, password, nombre = 'Administración'] = process.argv.slice(2);
if (!codigo || !password) { console.error('Uso: npm run crear-admin -- <usuario> <contraseña> ["Nombre"]'); process.exit(1); }
const cfg = { ...leerConfig(), admin: { codigo, password, nombre } };
const ctx = crearContexto(cfg, { db: abrirDB(cfg.dbPath) });
const u = ctx.s.usuarios.porCodigo(codigo);
if (u) {
  ctx.s.usuarios.cambiarSecreto(u.id, password);
  ctx.db.prepare("UPDATE usuarios SET rol = 'admin', activo = 1 WHERE id = ?").run(u.id);
  console.log(`✔ Contraseña de ${codigo} actualizada (rol administrador).`);
} else {
  ctx.s.usuarios.crear({ codigo, nombre, rol: 'admin', secreto: password });
  console.log(`✔ Administrador ${codigo} creado.`);
}
