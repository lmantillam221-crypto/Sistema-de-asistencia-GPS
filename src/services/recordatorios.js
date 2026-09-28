import { aMin, aHora, sumarDias, fLarga, hora12 } from '../domain/tiempo.js';
import { nombreBonito } from './turnos.js';

const primerNombre = (n) => nombreBonito(String(n || '').split(' ')[0]);

export function waLink(tel, texto) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.length === 9) d = '51' + d;
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

/* Recordatorios de turno por WhatsApp (enlace wa.me con el mensaje listo; no requiere API de pago). */
export function servicioRecordatorios(ctx) {
  const { db, reloj } = ctx;
  return {
    async listar() {
      const ahora = reloj.ahora(), emp = ctx.s.empresa.obtener(), horas = emp.ajustes.recordatorioHoras;
      const turnos = await ctx.s.turnos.listar({ desde: ahora.fecha, hasta: sumarDias(ahora.fecha, 1), soloAsignados: true });
      const claves = turnos.map((t) => `rec_${t.id}_${t.usuario_id}`);
      const enviados = new Map(claves.length ? (await db.prepare(`SELECT clave, en FROM avisos WHERE clave IN (${claves.map(() => '?').join(',')})`).all(...claves)).map((a) => [a.clave, a.en]) : []);
      return turnos.map((t) => {
        const clave = `rec_${t.id}_${t.usuario_id}`;
        const enviarMin = aMin(t.inicio) - horas * 60;
        const envFecha = enviarMin < 0 ? sumarDias(t.fecha, -1) : t.fecha, envHora = aHora(enviarMin);
        const yaEmpezo = t.fecha < ahora.fecha || (t.fecha === ahora.fecha && ahora.minutos >= aMin(t.inicio));
        const toca = !yaEmpezo && (ahora.fecha > envFecha || (ahora.fecha === envFecha && ahora.minutos >= aMin(envHora)));
        const texto = `Hola ${primerNombre(t.usuario_nombre)} 👋 Te recordamos que ${t.fecha === ahora.fecha ? 'hoy' : 'mañana'} ${fLarga(t.fecha)} tienes turno en ${nombreBonito(t.tienda_nombre)} de ${hora12(t.inicio)} a ${hora12(t.fin)}. Al llegar, marca tu entrada en la app y deja la ubicación activa. ¡Gracias! — ${emp.nombre}`;
        return { clave, turno: t, envFecha, envHora, estado: enviados.has(clave) ? 'enviado' : yaEmpezo ? 'tarde' : toca ? 'ahora' : 'programado', enviadoEn: enviados.get(clave) ?? null, enlace: waLink(t.usuario_telefono, texto), texto };
      });
    },
    async marcar(clave, tipo, quien) {
      await db.prepare('INSERT INTO avisos (clave, tipo, en, por) VALUES (?, ?, ?, ?) ON CONFLICT (clave) DO UPDATE SET tipo = excluded.tipo, en = excluded.en, por = excluded.por')
        .run(String(clave).slice(0, 120), tipo, reloj.ms(), quien?.id ?? null);
      ctx.bus.emit('cambio', { tipo: 'avisos' });
    },
  };
}
