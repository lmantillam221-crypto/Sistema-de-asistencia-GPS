export const readdirSync = () => [];
export const readFileSync = () => '';
export const existsSync = () => false;
export const mkdirSync = () => {};
export const rm = (p, o, cb) => cb?.();
export const rmSync = () => {};
export default { readdirSync, readFileSync, existsSync, mkdirSync, rm, rmSync };
