export class EventEmitter {
  constructor() { this.l = new Map(); }
  setMaxListeners() {}
  on(t, f) { if (!this.l.has(t)) this.l.set(t, new Set()); this.l.get(t).add(f); return this; }
  off(t, f) { this.l.get(t)?.delete(f); return this; }
  emit(t, ...a) { for (const f of [...(this.l.get(t) || [])]) { try { f(...a); } catch (e) { console.error(e); } } return true; }
}
export default { EventEmitter };
