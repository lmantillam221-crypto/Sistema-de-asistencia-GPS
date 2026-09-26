import { fila } from '../db/index.js';
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
    listar() {
      const ahora = reloj.ahora(), emp = ctx.s.empresa.obtener(), horas = emp.ajustes.recordatorioHoras;
      const out = [];
      for (const t of ctx.s.turnos.listar({ desde: ahora.fecha, hasta: sumarDias(ahora.fecha, 1), soloAsignados: true })) {
        const clave = `rec_${t.id}_${t.usuario_id}`;
        const enviarMin = aMin(t.inicio) - horas * 60;
        const envFecha = enviarMin < 0 ? sumarDias(t.fecha, -1) : t.fecha, envHora = aHora(enviarMin);
        const yaEmpezo = t.fecha < ahora.fecha || (t.fecha === ahora.fecha && ahora.minutos >= aMin(t.inicio));
        const toca = !yaEmpezo && (ahora.fecha > envFecha || (ahora.fecha === envFecha && ahora.minutos >= aMin(envHora)));
        const aviso = fila(db.prepare('SELECT * FROM avisos WHERE clave = ?').get(clave));
        const texto = `Hola ${primerNombre(t.usuario_nombre)} 👋 Te recordamos que ${t.fecha === ahora.fecha ? 'hoy' : 'mañana'} ${fLarga(t.fecha)} tienes turno en ${nombreBonito(t.tienda_nombre)} de ${hora12(t.inicio)} a ${hora12(t.fin)}. Al llegar, marca tu entrada en la app y deja la ubicación activa. ¡Gracias! — ${emp.nombre}`;
        out.push({ clave, turno: t, envFecha, envHora, estado: aviso ? 'enviado' : yaEmpezo ? 'tarde' : toca ? 'ahora' : 'programado', enviadoEn: aviso?.en ?? null, enlace: waLink(t.usuario_telefono, texto), texto });
      }
      return out;
    },
    marcar(clave, tipo, quien) {
      db.prepare('INSERT OR REPLACE INTO avisos (clave, tipo, en, por) VALUES (?, ?, ?, ?)').run(String(clave).slice(0, 120), tipo, reloj.ms(), quien?.id ?? null);
      ctx.bus.emit('cambio', { tipo: 'avisos' });
    },
  };
}
