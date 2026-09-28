/* Función programada de Netlify (ver netlify.toml): multas automáticas y mantenimiento cada 10 minutos. */
import { tareasNetlify } from '../../src/nube/funcion.js';
import { almacenNetlify } from '../../src/nube/almacen.js';

const marca = () => process.env.MARCA || (typeof __MARCA__ !== 'undefined' ? __MARCA__ : 'nube-chic'); // eslint-disable-line no-undef
const almacenAnterior = async () => (await almacenNetlify(`${marca()}-asistencia`)).leer();

export default async () => {
  const r = await tareasNetlify({ almacenAnterior });
  console.log('Tareas programadas:', JSON.stringify(r));
  return new Response('ok');
};
