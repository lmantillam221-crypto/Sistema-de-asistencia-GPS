/* Función de Netlify: toda la API (/api/*) del sistema de asistencia. */
import { atenderNetlify } from '../../src/nube/funcion.js';
import { almacenNetlify } from '../../src/nube/almacen.js';

let almacen = null;
export default async (request, context) => {
  // Cada marca guarda sus datos en su propio almacén. __ncAlmacen: solo para pruebas locales.
  almacen ||= globalThis.__ncAlmacen || (await almacenNetlify(`${process.env.MARCA || (typeof __MARCA__ !== 'undefined' ? __MARCA__ : 'nube-chic')}-asistencia`)); // eslint-disable-line no-undef
  return atenderNetlify(request, { almacen, ip: context?.ip || '' });
};
