/* Adaptador de la API de node:sqlite (DatabaseSync) sobre sql.js: para Netlify Functions y la demo web. */
let SQL = null;
export const setSQL = (s) => { SQL = s; };
const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export class DatabaseSync {
  constructor(origen) { this.d = origen instanceof Uint8Array ? new SQL.Database(origen) : new SQL.Database(); }
  exec(sql) { this.d.exec(sql); }
  prepare(sql) {
    const d = () => this.d;
    const all = (...a) => { const s = d().prepare(sql); try { s.bind(norm(a)); const out = []; while (s.step()) out.push(s.getAsObject()); return out; } finally { s.free(); } };
    return {
      all,
      get: (...a) => all(...a)[0],
      run: (...a) => {
        d().run(sql, norm(a));
        const changes = d().getRowsModified();
        const id = d().exec('SELECT last_insert_rowid()')[0]?.values[0][0] ?? 0;
        return { changes, lastInsertRowid: id };
      },
    };
  }
  cambiosTotales() { return this.d.exec('SELECT total_changes()')[0].values[0][0]; }
  exportar() { const b = this.d.export(); this.d.exec('PRAGMA foreign_keys = ON'); return b; }
  reemplazar(bytes) { try { this.d.close(); } catch {} this.d = new SQL.Database(bytes); this.d.exec('PRAGMA foreign_keys = ON'); }
  close() { this.d.close(); }
}
