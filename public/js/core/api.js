/* Cliente HTTP de la API: JSON, errores legibles y manejo de sesión vencida. */
const alVencer = new Set();
/** Avisa cuando la sesión vence. El callback recibe la ruta (/app/… o /panel/…). */
export const onSesionVencida = (fn) => { alVencer.add(fn); };

export class ErrorApi extends Error {
  constructor(status, mensaje, datos = {}) { super(mensaje); this.status = status; Object.assign(this, datos); }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const PAUSAS = [700, 1800, 4000];

/**
 * Reintentos automáticos ante cortes breves (red del celular, servidor ocupado o reiniciándose):
 * - lecturas (GET): ante falta de red o 502/503/504
 * - cambios (POST/PUT/DELETE): solo si el servidor avisó que no llegó a procesarlos (503 + Retry-After)
 */
async function pedir(metodo, ruta, cuerpo) {
  const lectura = metodo === 'GET';
  for (let intento = 0; ; intento++) {
    const ultimo = intento >= PAUSAS.length;
    let r;
    try {
      r = await fetch('/api' + ruta, {
        method: metodo, credentials: 'same-origin',
        headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      });
    } catch {
      if (lectura && !ultimo) { await esperar(PAUSAS[intento]); continue; }
      throw new ErrorApi(0, 'Sin conexión a internet. Revisa tus datos o wifi.', { red: true });
    }
    const reintentable = lectura ? [502, 503, 504].includes(r.status) : r.status === 503 && r.headers.has('retry-after');
    if (reintentable && !ultimo) { await esperar(PAUSAS[intento]); continue; }
    const tipo = r.headers.get('content-type') || '';
    const datos = tipo.includes('json') ? await r.json().catch(() => ({})) : null;
    if (!r.ok) {
      if (r.status === 401 && datos?.codigo === 'SESION') alVencer.forEach((fn) => fn(ruta));
      const mensaje = datos?.error || (r.status >= 500 ? 'El servidor está ocupado. Inténtalo de nuevo en unos segundos.' : `Error ${r.status}`);
      throw new ErrorApi(r.status, mensaje, { codigo: datos?.codigo, detalles: datos?.detalles });
    }
    return datos;
  }
}

export const api = {
  get: (r) => pedir('GET', r),
  post: (r, b = {}) => pedir('POST', r, b),
  put: (r, b = {}) => pedir('PUT', r, b),
  del: (r) => pedir('DELETE', r, {}),
};
