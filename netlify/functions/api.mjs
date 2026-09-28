/* Función de Netlify: toda la API (/api/*) del sistema de asistencia, con PostgreSQL (Netlify DB / Neon). */
import { atenderNetlify } from '../../src/nube/funcion.js';
import { almacenNetlify } from '../../src/nube/almacen.js';

const marca = () => process.env.MARCA || (typeof __MARCA__ !== 'undefined' ? __MARCA__ : 'nube-chic'); // eslint-disable-line no-undef
// Datos de la versión anterior (Netlify Blobs): se migran solos a PostgreSQL la primera vez.
const almacenAnterior = async () => (await almacenNetlify(`${marca()}-asistencia`)).leer();

export default (request, context) => atenderNetlify(request, { ip: context?.ip || '', almacenAnterior });
