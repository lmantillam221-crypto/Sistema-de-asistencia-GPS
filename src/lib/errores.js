export class ErrorApp extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    Object.assign(this, extra);
  }
}
export const noEncontrado = (q = 'Registro') => new ErrorApp(404, `${q} no encontrado.`);
export const prohibido = (m = 'No tienes permiso para esto.') => new ErrorApp(403, m);
export const invalido = (m, detalles) => new ErrorApp(400, m, { detalles });
export const conflicto = (m) => new ErrorApp(409, m);

/** Valida con zod y lanza 400 con mensajes legibles. */
export function validar(esquema, datos) {
  const r = esquema.safeParse(datos);
  if (r.success) return r.data;
  const detalles = r.error.issues.map((i) => `${i.path.join('.') || 'dato'}: ${i.message}`);
  throw invalido(detalles[0] || 'Datos inválidos.', detalles);
}
