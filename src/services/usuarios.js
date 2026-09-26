import { fila, filas } from '../db/index.js';
import { hashSecreto, verificarSecreto, nuevoToken, hashToken } from '../lib/seguridad.js';
import { ErrorApp, conflicto, invalido, noEncontrado } from '../lib/errores.js';

const MAX_INTENTOS = 5, BLOQUEO_MS = 10 * 60000;

export const publico = (u) => u && ({
  id: u.id, codigo: u.codigo, nombre: u.nombre, telefono: u.telefono, rol: u.rol, tienda_id: u.tienda_id,
  activo: !!u.activo, dispositivoVinculado: !!u.dispositivo, debeCambiar: !!u.debe_cambiar, creado: u.creado,
});

export function validarSecretoPara(rol, secreto) {
  if (rol === 'colaborador') {
    if (!/^\d{4,8}$/.test(String(secreto || ''))) throw invalido('La clave (PIN) debe tener de 4 a 8 números.');
  } else if (String(secreto || '').length < 8) {
    throw invalido('La contraseña debe tener al menos 8 caracteres.');
  }
}

export function servicioUsuarios(ctx) {
  const { db, reloj } = ctx;
  const porId = (id) => fila(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id));
  const porCodigo = (c) => fila(db.prepare('SELECT * FROM usuarios WHERE codigo = ? COLLATE NOCASE').get(String(c).trim()));

  return {
    porId,
    porCodigo,
    listar({ rol = null, activos = false } = {}) {
      const cond = [], args = [];
      if (rol) { cond.push('rol = ?'); args.push(rol); }
      if (activos) cond.push('activo = 1');
      return filas(db.prepare(`SELECT * FROM usuarios ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY rol = 'colaborador' DESC, codigo`).all(...args)).map(publico);
    },
    colaboradores: () => filas(db.prepare("SELECT * FROM usuarios WHERE rol = 'colaborador' AND activo = 1 ORDER BY codigo").all()).map(publico),
    siguienteCodigo(prefijo = 'V') {
      const nums = filas(db.prepare('SELECT codigo FROM usuarios WHERE codigo LIKE ?').all(prefijo + '%')).map((r) => parseInt(r.codigo.slice(prefijo.length), 10) || 0);
      return prefijo + String(Math.max(0, ...nums) + 1).padStart(2, '0');
    },
    crear({ codigo, nombre, telefono = '', rol = 'colaborador', secreto, tienda_id = null, debe_cambiar = false }) {
      codigo = String(codigo || '').trim().toUpperCase();
      if (!/^[A-Z0-9._-]{2,20}$/i.test(codigo)) throw invalido('El usuario debe tener de 2 a 20 letras o números.');
      if (!String(nombre || '').trim()) throw invalido('Escribe el nombre.');
      validarSecretoPara(rol, secreto);
      if (porCodigo(codigo)) throw conflicto(`El usuario ${codigo} ya existe.`);
      const r = db.prepare('INSERT INTO usuarios (codigo, nombre, telefono, rol, secreto, tienda_id, debe_cambiar, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(codigo, String(nombre).trim(), String(telefono || '').replace(/\D/g, ''), rol, hashSecreto(secreto), tienda_id, debe_cambiar ? 1 : 0, reloj.ms());
      return publico(porId(Number(r.lastInsertRowid)));
    },
    actualizar(id, { nombre, telefono, rol, tienda_id, activo }) {
      const u = porId(id);
      if (!u) throw noEncontrado('Usuario');
      if (u.rol === 'admin' && (activo === false || (rol && rol !== 'admin'))) {
        const admins = db.prepare("SELECT COUNT(*) n FROM usuarios WHERE rol = 'admin' AND activo = 1").get().n;
        if (admins <= 1) throw invalido('Debe quedar al menos un administrador activo.');
      }
      db.prepare('UPDATE usuarios SET nombre = ?, telefono = ?, rol = ?, tienda_id = ?, activo = ? WHERE id = ?').run(
        nombre != null ? String(nombre).trim() || u.nombre : u.nombre,
        telefono != null ? String(telefono).replace(/\D/g, '') : u.telefono,
        rol || u.rol,
        tienda_id !== undefined ? tienda_id : u.tienda_id,
        activo != null ? (activo ? 1 : 0) : u.activo,
        id,
      );
      if (activo === false) this.cerrarSesionesDe(id);
      return publico(porId(id));
    },
    cambiarSecreto(id, secreto, { debeCambiar = false } = {}) {
      const u = porId(id);
      if (!u) throw noEncontrado('Usuario');
      validarSecretoPara(u.rol, secreto);
      db.prepare('UPDATE usuarios SET secreto = ?, intentos = 0, bloqueado_hasta = NULL, debe_cambiar = ? WHERE id = ?').run(hashSecreto(secreto), debeCambiar ? 1 : 0, id);
    },
    desvincularDispositivo(id) { db.prepare('UPDATE usuarios SET dispositivo = NULL WHERE id = ?').run(id); },
    vincularDispositivo(id, disp) { db.prepare('UPDATE usuarios SET dispositivo = ? WHERE id = ? AND dispositivo IS NULL').run(disp, id); },

    /** Inicia sesión. `panel` exige rol admin o supervisor. */
    login({ codigo, secreto, panel = false, ip = null, agente = null }) {
      const u = porCodigo(codigo || '');
      const ahora = Date.now(); // seguridad y sesiones usan siempre la hora real
      const fallo = () => new ErrorApp(401, panel ? 'Usuario o contraseña incorrectos.' : 'Usuario o clave incorrectos.');
      if (!u || !u.activo) { hashSecreto('x'); throw fallo(); } // tiempo constante aproximado
      if (u.bloqueado_hasta && u.bloqueado_hasta > ahora) {
        throw new ErrorApp(429, `Demasiados intentos. Vuelve a intentar en ${Math.ceil((u.bloqueado_hasta - ahora) / 60000)} min o pide al supervisor que restablezca tu clave.`);
      }
      if (!verificarSecreto(secreto, u.secreto)) {
        const n = u.intentos + 1;
        db.prepare('UPDATE usuarios SET intentos = ?, bloqueado_hasta = ? WHERE id = ?').run(n >= MAX_INTENTOS ? 0 : n, n >= MAX_INTENTOS ? ahora + BLOQUEO_MS : null, u.id);
        ctx.s.auditoria.registrar(u, 'login_fallido', 'usuario', u.id, { panel }, ip);
        throw fallo();
      }
      if (panel && !['admin', 'supervisor'].includes(u.rol)) throw new ErrorApp(403, 'Este usuario no tiene acceso al panel de control.');
      db.prepare('UPDATE usuarios SET intentos = 0, bloqueado_hasta = NULL WHERE id = ?').run(u.id);
      const token = nuevoToken();
      db.prepare('INSERT INTO sesiones (token_hash, usuario_id, creado, expira, visto, agente, ip) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(hashToken(token), u.id, ahora, ahora + ctx.cfg.sesionDias * 864e5, ahora, agente?.slice(0, 200) ?? null, ip);
      ctx.s.auditoria.registrar(u, panel ? 'login_panel' : 'login_app', 'usuario', u.id, null, ip);
      return { token, usuario: publico(u) };
    },
    sesion(token) {
      if (!token) return null;
      const h = hashToken(token), ahora = Date.now();
      const s = fila(db.prepare('SELECT s.*, u.activo FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?').get(h));
      if (!s || s.expira < ahora || !s.activo) return null;
      if (ahora - s.visto > 5 * 60000) db.prepare('UPDATE sesiones SET visto = ? WHERE token_hash = ?').run(ahora, h);
      return porId(s.usuario_id);
    },
    cerrarSesion(token) { db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(hashToken(token || '')); },
    cerrarSesionesDe(id) { db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(id); },
    purgarSesiones() { db.prepare('DELETE FROM sesiones WHERE expira < ?').run(Date.now()); },
  };
}
