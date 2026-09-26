export const join = (...p) => p.filter(Boolean).join('/').replace(/\/+/g, '/');
export const dirname = (p) => String(p).split('/').slice(0, -1).join('/') || '/';
export const resolve = (...p) => join(...p);
export const basename = (p) => String(p).split('/').pop();
export default { join, dirname, resolve, basename };
