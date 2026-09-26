/* Función de Netlify: toda la API (/api/*) del sistema de asistencia. */
import { atenderNetlify } from '../../src/nube/funcion.js';
import { almacenNetlify } from '../../src/nube/almacen.js';

let almacen = null;
export default async (request, context) => {
  almacen ||= globalThis.__ncAlmacen || (await almacenNetlify()); // __ncAlmacen: solo para pruebas locales
  return atenderNetlify(request, { almacen, ip: context?.ip || '' });
};
