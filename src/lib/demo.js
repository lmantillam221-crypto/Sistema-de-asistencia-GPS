/* Datos de demostración: tienda, equipo y 3 semanas de asistencia, ventas y multas. */
import { transaccion } from '../db/index.js';
import { aMin, aHora, lunesDe, sumarDias, diaDe } from '../domain/tiempo.js';
import { desplazar, distancia } from '../domain/geo.js';

const EQUIPO_DEMO = [
  ['V01', 'Ana Torres', '1111'], ['V02', 'Lucía Ramos', '2222'], ['V03', 'María Quispe', '3333'], ['V04', 'Rosa Chávez', '4444'],
  ['V05', 'Carla Díaz', '5555'], ['V06', 'Paola Vega', '6666'], ['V07', 'Diego Rojas', '7777'], ['V08', 'Fiorela Cruz', '8888'],
];

export async function asegurarBaseDemo(ctx) {
  let tiendas = await ctx.s.tiendas.listar();
  if (!tiendas.length) {
    const m = ctx.cfg.marca?.tienda || {};
    const [lat, lng] = String(m.coords || '-7.1547444, -78.5166566').split(',').map(Number);
    const t = await ctx.s.tiendas.crear({ codigo: 'L1', nombre: m.nombre || 'Tienda principal', direccion: '', lat, lng, radio_m: m.radio_m || 80 });
    await ctx.s.tiendas.guardarPlantillas(t.id, [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, inicio: '16:00', fin: '19:00', cupos: 1 })));
    tiendas = [t];
  }
  if (!(await ctx.s.usuarios.colaboradores()).length) {
    for (const [codigo, nombre, pin] of EQUIPO_DEMO) await ctx.s.usuarios.crear({ codigo, nombre, secreto: pin, telefono: '9' + pin + pin.slice(0, 4), tienda_id: tiendas[0].id });
  }
  if (!(await ctx.s.usuarios.porCodigo('supervisor'))) await ctx.s.usuarios.crear({ codigo: 'supervisor', nombre: 'Supervisión', rol: 'supervisor', secreto: 'supervisor2026' });
}

export async function generarEjemplo(ctx, { semanas = 3, azar = Math.random } = {}) {
  asegurarBaseDemo(ctx);
  const { db } = ctx;
  const aj = ctx.s.empresa.ajustes();
  const ahora = ctx.reloj.ahora();
  const inicio = sumarDias(lunesDe(ahora.fecha), -7 * semanas);
  const fin = sumarDias(lunesDe(ahora.fecha), 6);
  const equipo = await ctx.s.usuarios.colaboradores();
  let n = 0;
  await transaccion(db, async () => {
    const turnos = await ctx.s.turnos.listar({ desde: inicio, hasta: fin });
    const porSemana = new Map();
    for (const t of turnos) { const l = lunesDe(t.fecha); if (!porSemana.has(l)) porSemana.set(l, []); porSemana.get(l).push(t); }
    let rot = 0;
    for (const [, lista] of [...porSemana].sort()) {
      const orden = equipo.slice().sort(() => azar() - 0.5);
      let i = 0;
      for (const t of lista) {
        if (t.usuario_id) continue;
        const u = orden[(i++ + rot) % orden.length];
        if (await ctx.s.turnos.cruce(u.id, t)) continue;
        await db.prepare("UPDATE turnos SET usuario_id = ?, asignado_por = 'supervisor', asignado_en = ?, ejemplo = 1 WHERE id = ?").run(u.id, ctx.reloj.ms(), t.id);
        if (t.fecha >= ahora.fecha) continue;
        const tienda = await ctx.s.tiendas.obtener(t.tienda_id);
        const r = azar();
        if (r < 0.1) continue; // falta
        const tarde = r < 0.28 ? aj.toleranciaMin + 3 + Math.floor(azar() * 40) : Math.floor(azar() * Math.min(aj.toleranciaMin, 20)) - 10;
        const e0 = aMin(t.inicio) + tarde, fS = aMin(t.fin) + Math.floor(azar() * 16) - 8;
        const mk = async (tipo, min, fuera = false) => {
          const pos = desplazar(tienda.lat, tienda.lng, fuera ? tienda.radio_m + 250 : 4 + azar() * 20, azar() * Math.PI * 2);
          const d = distancia(pos.lat, pos.lng, tienda.lat, tienda.lng);
          await db.prepare(`INSERT INTO marcas (usuario_id, turno_id, tienda_id, tipo, fecha, hora, ts, lat, lng, precision_m, distancia_m, estado, observaciones, simulado, ejemplo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, 1)`).run(u.id, t.id, tienda.id, tipo, t.fecha, aHora(min) + ':00', ctx.reloj.ms(),
            +pos.lat.toFixed(6), +pos.lng.toFixed(6), 6 + Math.floor(azar() * 20), Math.round(d), d <= tienda.radio_m ? 'dentro' : 'fuera');
          n++;
        };
        await mk('entrada', e0);
        for (let m = e0 + aj.intervaloControlMin; m < fS; m += aj.intervaloControlMin) { const q = azar(); if (q < 0.05) continue; await mk('control', m + Math.floor(azar() * 3), q < 0.12); }
        await mk('salida', Math.max(fS, e0 + 30));
        const finde = [0, 6].includes(diaDe(t.fecha));
        const ventas = Math.floor(azar() * 7) + (finde ? 4 : 1);
        const prendas = ventas + Math.floor(azar() * ventas);
        const monto = Math.round(prendas * (35 + azar() * 45));
        const ef = Math.round(monto * (0.3 + azar() * 0.3)), dig = Math.round((monto - ef) * (0.5 + azar() * 0.4));
        await db.prepare(`INSERT INTO reportes_turno (turno_id, usuario_id, apertura, cierre, ventas, prendas, efectivo, digital, tarjeta, nota, actualizado)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?) ON CONFLICT (turno_id, usuario_id) DO NOTHING`).run(t.id, u.id, JSON.stringify(aj.checklistApertura), JSON.stringify(azar() < 0.85 ? aj.checklistCierre : aj.checklistCierre.slice(0, 2)),
          ventas, prendas, ef, dig, monto - ef - dig, ctx.reloj.ms());
      }
      rot++;
    }
  });
  await ctx.s.multas.sincronizar();
  await db.prepare('UPDATE multas SET ejemplo = 1 WHERE turno_id IN (SELECT id FROM turnos WHERE ejemplo = 1)').run();
  ctx.bus.emit('cambio', { tipo: 'todo' });
  return n;
}

export async function borrarEjemplo(ctx) {
  const { db } = ctx;
  await transaccion(db, async () => {
    await db.prepare('DELETE FROM marcas WHERE ejemplo = 1').run();
    await db.prepare('DELETE FROM multas WHERE ejemplo = 1').run();
    const ids = filas(db.prepare('SELECT id FROM turnos WHERE ejemplo = 1').all()).map((r) => r.id);
    for (const id of ids) {
      await db.prepare('DELETE FROM reportes_turno WHERE turno_id = ?').run(id);
      if (!(await db.prepare('SELECT 1 AS x FROM marcas WHERE turno_id = ?').get(id))) await db.prepare('UPDATE turnos SET usuario_id = NULL, asignado_por = NULL, asignado_en = NULL, ejemplo = 0 WHERE id = ?').run(id);
    }
  });
  ctx.bus.emit('cambio', { tipo: 'todo' });
}
