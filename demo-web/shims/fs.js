import sql001 from '../../src/db/migrations/001_inicial.sql';
const MIG = { '001_inicial.sql': sql001 };
export const readdirSync = () => Object.keys(MIG);
export const readFileSync = (p) => MIG[String(p).split('/').pop()] ?? '';
export const mkdirSync = () => {};
export const rm = (p, o, cb) => cb?.();
export const rmSync = () => {};
export default { readdirSync, readFileSync, mkdirSync, rm, rmSync };
