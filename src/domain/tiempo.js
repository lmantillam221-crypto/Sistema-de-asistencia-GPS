/* Utilidades de fecha y hora en la zona horaria del negocio.
   Fechas como 'YYYY-MM-DD' y horas como 'HH:MM' para evitar ambigüedades de zona horaria. */

export const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const DIAS_C = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0];

const formatos = new Map();
function formato(tz) {
  if (!formatos.has(tz)) {
    formatos.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  return formatos.get(tz);
}

/** Descompone un instante (ms) en fecha y hora locales del negocio. */
export function partes(ms, tz = 'America/Lima') {
  const p = Object.fromEntries(formato(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    hora: `${p.hour}:${p.minute}`,
    horaSeg: `${p.hour}:${p.minute}:${p.second}`,
    minutos: +p.hour * 60 + +p.minute,
    ms,
  };
}

/** Instante (ms) que corresponde a una fecha y hora locales en la zona dada. */
export function instante(fecha, hora, tz = 'America/Lima') {
  const [h, m] = hora.split(':').map(Number);
  const guess = Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10), h, m);
  // Ajuste por el desfase de la zona (dos pasadas por cambios de horario).
  let t = guess;
  for (let i = 0; i < 2; i++) {
    const p = partes(t, tz);
    const visto = Date.UTC(+p.fecha.slice(0, 4), +p.fecha.slice(5, 7) - 1, +p.fecha.slice(8, 10), Math.floor(p.minutos / 60), p.minutos % 60);
    t += guess - visto;
  }
  return t;
}

export const aMin = (h) => { const [a, b] = String(h).split(':').map(Number); return a * 60 + (b || 0); };
export const aHora = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export const diaDe = (f) => new Date(f + 'T12:00:00Z').getUTCDay();
export function sumarDias(f, n) { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const lunesDe = (f) => sumarDias(f, -((diaDe(f) + 6) % 7));
export function* rango(desde, hasta, max = 1000) { for (let f = desde, i = 0; f <= hasta && i < max; f = sumarDias(f, 1), i++) yield f; }
export const diasEntre = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
export const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && !Number.isNaN(Date.parse(f + 'T12:00:00Z')) && new Date(f + 'T12:00:00Z').toISOString().slice(0, 10) === f;
export const esHora = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
export const fCorta = (f) => `${DIAS_C[diaDe(f)]} ${f.slice(8)}/${f.slice(5, 7)}`;
export const fLarga = (f) => `${DIAS[diaDe(f)]} ${Number(f.slice(8))}/${f.slice(5, 7)}`;
export function hora12(h) {
  const m = aMin(h), hh = Math.floor(m / 60), mm = m % 60;
  return `${((hh + 11) % 12) + 1}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${hh < 12 ? 'a. m.' : 'p. m.'}`;
}

/**
 * Reloj del sistema. En producción usa la hora real del servidor (la del celular no cuenta,
 * así nadie puede adelantar o atrasar su teléfono para marcar). En modo demostración
 * se puede fijar una hora simulada.
 */
export function crearReloj({ tz = 'America/Lima', ahora = () => Date.now() } = {}) {
  let simulado = null; // { base: ms simulado, real: ms real cuando se fijó }
  const reloj = {
    tz,
    ms() { return simulado ? simulado.base + (ahora() - simulado.real) : ahora(); },
    ahora() { return partes(reloj.ms(), reloj.tz); },
    simular(fecha, hora) { simulado = fecha ? { base: instante(fecha, hora, reloj.tz), real: ahora() } : null; },
    get simulado() { return !!simulado; },
  };
  return reloj;
}
