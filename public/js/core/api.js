/* Cliente HTTP de la API: JSON, errores legibles y manejo de sesión vencida. */
const alVencer = new Set();
/** Avisa cuando la sesión vence. El callback recibe la ruta (/app/… o /panel/…). */
export const onSesionVencida = (fn) => { alVencer.add(fn); };

export class ErrorApi extends Error {
  constructor(status, mensaje, datos = {}) { super(mensaje); this.status = status; Object.assign(this, datos); }
}

async function pedir(metodo, ruta, cuerpo) {
  let r;
  try {
    r = await fetch('/api' + ruta, {
      method: metodo, credentials: 'same-origin',
      headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorApi(0, 'Sin conexión a internet. Revisa tus datos o wifi.', { red: true });
  }
  const tipo = r.headers.get('content-type') || '';
  const datos = tipo.includes('json') ? await r.json().catch(() => ({})) : null;
  if (!r.ok) {
    if (r.status === 401 && datos?.codigo === 'SESION') alVencer.forEach((fn) => fn(ruta));
    throw new ErrorApi(r.status, datos?.error || `Error ${r.status}`, { codigo: datos?.codigo, detalles: datos?.detalles });
  }
  return datos;
}

export const api = {
  get: (r) => pedir('GET', r),
  post: (r, b = {}) => pedir('POST', r, b),
  put: (r, b = {}) => pedir('PUT', r, b),
  del: (r) => pedir('DELETE', r, {}),
};
