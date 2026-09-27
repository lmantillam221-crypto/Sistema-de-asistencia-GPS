/* Configuración inicial del negocio (primer ingreso al panel): administradora, tienda, turnos y equipo. */
import { transaccion } from '../db/index.js';
import { invalido, conflicto } from './errores.js';
import { pinAleatorio } from './seguridad.js';
import { leerCoords } from '../domain/geo.js';

export const hayAdmin = (ctx) => ctx.db.prepare("SELECT COUNT(*) n FROM usuarios WHERE rol = 'admin'").get().n > 0;

/** Convierte líneas "Nombre Apellido 998 814 382" o "Nombre, 998814382" en personas. */
export function leerEquipo(texto) {
  const out = [];
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const l = linea.trim();
    if (!l) continue;
    const m = l.match(/^(.*?)[\s,;:–-]*((?:\+?51[\s-]*)?9(?:[\s-]*\d){8})\s*$/);
    const nombre = (m ? m[1] : l).replace(/[,;:–-]+$/, '').trim();
    let tel = m ? m[2].replace(/\D/g, '') : '';
    if (tel.length === 11 && tel.startsWith('51')) tel = tel.slice(2);
    if (nombre) out.push({ nombre, telefono: tel });
  }
  return out;
}

export function configurarNegocio(ctx, { empresa, rubro, admin, tienda, horario, equipo }) {
  if (hayAdmin(ctx)) throw conflicto('El sistema ya fue configurado. Ingresa con tu usuario.');
  const c = leerCoords(tienda?.coords);
  if (!c) throw invalido('Escribe las coordenadas de la tienda (ej.: -7.1547, -78.5166).');
  const personas = leerEquipo(equipo);
  const creadas = [];
  transaccion(ctx.db, () => {
    ctx.s.empresa.actualizar({ nombre: empresa?.trim() || ctx.cfg.marca?.nombre || 'Mi negocio', rubro: rubro?.trim() || ctx.cfg.marca?.rubro || 'Moda y accesorios' });
    const u = ctx.s.usuarios.crear({ codigo: admin.codigo, nombre: admin.nombre, rol: 'admin', secreto: admin.clave });
    const t = ctx.s.tiendas.crear({ codigo: 'L1', nombre: tienda.nombre, direccion: tienda.direccion || '', lat: c.lat, lng: c.lng, radio_m: Number(tienda.radio_m) || 80 });
    const h = horario || { inicio: '16:00', fin: '19:00' };
    ctx.s.tiendas.guardarPlantillas(t.id, [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, inicio: h.inicio, fin: h.fin, cupos: 1 })));
    personas.forEach((p, i) => {
      const codigo = 'V' + String(i + 1).padStart(2, '0');
      const pin = pinAleatorio();
      ctx.s.usuarios.crear({ codigo, nombre: p.nombre, telefono: p.telefono, secreto: pin, tienda_id: t.id });
      creadas.push({ codigo, nombre: p.nombre, telefono: p.telefono, pin });
    });
    ctx.s.auditoria.registrar(u, 'configuracion_inicial', 'empresa', 1, { tienda: t.nombre, equipo: creadas.length });
    ctx.admin = u;
  });
  return { admin: ctx.s.usuarios.porCodigo(admin.codigo), equipo: creadas };
}
