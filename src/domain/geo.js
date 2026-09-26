/* Geocerca y controles anti-fraude de ubicación. */

export function distancia(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function desplazar(lat, lng, metros, angulo = Math.random() * Math.PI * 2) {
  return {
    lat: lat + (metros * Math.cos(angulo)) / 111320,
    lng: lng + (metros * Math.sin(angulo)) / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
}

export function leerCoords(t) {
  const m = String(t || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

/** Velocidad máxima razonable entre dos reportes (m/s). 50 m/s = 180 km/h. */
const VEL_MAX = 50;

/**
 * Clasifica una posición respecto a la tienda y detecta señales de GPS falso.
 * @returns {{estado:'dentro'|'fuera'|'imprecisa', distancia:number, observaciones:string[]}}
 */
export function clasificarPosicion({ pos, tienda, precisionMaxima = 100, anterior = null, dispositivo = null, dispositivoHabitual = null, capturado = null, recibido = null }) {
  const d = distancia(pos.lat, pos.lng, tienda.lat, tienda.lng);
  // Se descuenta el margen de error del GPS (hasta la mitad del radio) para no castigar señales normales.
  const margen = Math.min(pos.precision || 0, tienda.radio_m / 2);
  let estado = d - margen <= tienda.radio_m ? 'dentro' : 'fuera';
  if ((pos.precision ?? 9999) > precisionMaxima) estado = 'imprecisa';
  const obs = [];
  if (anterior && anterior.lat != null) {
    const seg = Math.max(1, ((capturado ?? recibido) - (anterior.capturado ?? anterior.ts)) / 1000);
    const salto = distancia(pos.lat, pos.lng, anterior.lat, anterior.lng);
    if (salto > 300 && salto / seg > VEL_MAX) obs.push(`salto de ${fmtDist(salto)} en ${Math.round(seg)} s (posible GPS falso)`);
  }
  if (pos.precision === 0) obs.push('precisión de 0 m (posible GPS falso)');
  if (dispositivo && dispositivoHabitual && dispositivo !== dispositivoHabitual) obs.push('marcó desde un celular distinto al habitual');
  if (capturado && recibido && recibido - capturado > 10 * 60000) obs.push(`enviado con ${Math.round((recibido - capturado) / 60000)} min de retraso (sin internet)`);
  return { estado, distancia: Math.round(d), observaciones: obs };
}
