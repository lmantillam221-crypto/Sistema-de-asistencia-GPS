/* AsyncLocalStorage para la demo en el navegador.
   En la demo (sql.js) todo el trabajo de una petición ocurre en microtareas seguidas y las
   operaciones sobre la base se atienden de a una (db.exclusivo), así que basta con un contexto
   "actual" que se restaura cuando termina la operación. */
export class AsyncLocalStorage {
  constructor() { this.actual = undefined; }
  getStore() { return this.actual; }
  run(store, fn, ...a) {
    const previo = this.actual;
    this.actual = store;
    let r;
    try { r = fn(...a); } catch (e) { this.actual = previo; throw e; }
    if (r && typeof r.then === 'function') return Promise.resolve(r).finally(() => { this.actual = previo; });
    this.actual = previo;
    return r;
  }
}
export default { AsyncLocalStorage };
