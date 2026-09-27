import path from 'node:path';
import { marcaPorId } from './marcas.js';

const bool = (v, d = false) => (v == null || v === '' ? d : ['1', 'true', 'yes', 'si', 'sí'].includes(String(v).toLowerCase()));

export function leerConfig(env = process.env) {
  const produccion = (env.NODE_ENV || 'development') === 'production';
  return {
    puerto: Number(env.PORT || 3000),
    dbPath: env.DB_PATH || path.resolve('data', 'asistencia.db'),
    produccion,
    trustProxy: bool(env.TRUST_PROXY, false),
    sesionDias: Number(env.SESSION_DAYS || 30),
    demo: bool(env.DEMO_MODE, false),
    marca: marcaPorId(env.MARCA),
    admin: {
      codigo: env.ADMIN_CODIGO || 'admin',
      password: env.ADMIN_PASSWORD || '',
      nombre: env.ADMIN_NOMBRE || 'Administración',
    },
  };
}
