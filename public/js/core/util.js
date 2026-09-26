/* Utilidades comunes del navegador. */
export { DIAS, DIAS_C, ORDEN_SEMANA, aMin, aHora, diaDe, sumarDias, lunesDe, rango, fCorta, fLarga, hora12, esFecha } from '/shared/tiempo.js';
export { fmtDist, distancia, leerCoords } from '/shared/geo.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const nombreBonito = (n) => String(n || '').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
export const primerNombre = (n) => cap(String(n || '').toLowerCase().split(' ')[0]);
export const iniciales = (n) => nombreBonito(n).split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('');
export const soles = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const solesCorto = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;
export const pct = (n) => (n == null ? '—' : `${n}%`);
export const horasMin = (m) => (m == null ? '—' : `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')}`);
export const plural = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;

export const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
  json(k, d = null) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
};

export function waLink(tel, texto) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.length === 9) d = '51' + d;
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(texto)}` : `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

export function descargar(nombre, contenido, tipo = 'text/plain') {
  const url = contenido instanceof Blob ? URL.createObjectURL(contenido) : URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export const COLOR_RES = { 'a tiempo': '#1f9d6b', tarde: '#e0a100', falta: '#d93b4a', 'cubrió': '#3b6fd9', 'en curso': '#a88f9c' };
export const CLASE_RES = { 'a tiempo': 'ok', tarde: 'warn', falta: 'bad', 'cubrió': 'info', 'en curso': 'grey' };
export const CLASE_ESTADO = { 'EN EL LOCAL': 'ok', 'TERMINÓ': 'ok', 'AÚN NO LLEGA': 'warn', 'PROGRAMADO': 'grey', 'NO LLEGA': 'bad', 'FALTÓ': 'bad', 'FUERA DEL LOCAL': 'bad', 'SIN SEÑAL': 'bad' };
export const ETIQUETA_ESTADO = { 'EN EL LOCAL': 'En tienda', 'FUERA DEL LOCAL': 'Fuera de tienda' };
export const NOMBRE_ALERTA = {
  AUSENTE: 'No llegó', FALTA: 'Falta', TARDANZA: 'Tardanza', FUERA_DEL_LOCAL: 'Fuera de tienda', UBICACION_IMPRECISA: 'GPS impreciso',
  SIN_REPORTES: 'GPS sin reportar', SALIDA_ANTICIPADA: 'Salida anticipada', SIN_SALIDA: 'No marcó salida', GPS_SOSPECHOSO: 'GPS sospechoso', CUBRIO: 'Cubrió turno',
};
export const GRAVES = new Set(['AUSENTE', 'FALTA', 'FUERA_DEL_LOCAL', 'SIN_REPORTES', 'GPS_SOSPECHOSO']);
export const NOMBRE_MULTA = { tardanza: 'Tardanza', falta: 'Falta', salida_anticipada: 'Salida anticipada', manual: 'Otra' };
