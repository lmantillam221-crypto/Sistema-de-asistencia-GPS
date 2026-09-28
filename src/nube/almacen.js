/* Versión anterior (hasta la 2.2): la base se guardaba como un archivo SQLite en Netlify Blobs.
   Ahora la base es PostgreSQL; este módulo solo se usa para LEER esos datos y migrarlos. */

const CLAVE = 'asistencia.db';

export async function almacenNetlify(nombre = 'nube-chic-asistencia') {
  const { getStore } = await import('@netlify/blobs');
  const store = getStore({ name: nombre, consistency: 'strong' });
  return {
    async etag() { const m = await store.getMetadata(CLAVE); return m?.etag ?? null; },
    async leer() {
      const r = await store.getWithMetadata(CLAVE, { type: 'arrayBuffer' });
      return r ? { bytes: new Uint8Array(r.data), etag: r.etag ?? null } : null;
    },
    async escribir(bytes, etagPrevio) {
      const datos = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const r = await store.set(CLAVE, datos, etagPrevio ? { onlyIfMatch: etagPrevio } : { onlyIfNew: true });
      return { ok: r.modified, etag: r.etag ?? null };
    },
  };
}

/** Almacén en memoria con la misma semántica (pruebas y desarrollo local). */
export function almacenMemoria() {
  let actual = null, n = 0;
  return {
    async etag() { return actual?.etag ?? null; },
    async leer() { return actual ? { bytes: actual.bytes.slice(), etag: actual.etag } : null; },
    async escribir(bytes, etagPrevio) {
      if ((actual?.etag ?? null) !== (etagPrevio ?? null)) return { ok: false, etag: null };
      actual = { bytes: bytes.slice(), etag: `e${++n}` };
      return { ok: true, etag: actual.etag };
    },
  };
}
