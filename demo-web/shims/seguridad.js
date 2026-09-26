/* Versión de demostración de lib/seguridad.js (SHA-256 síncrono en JS puro).
   El sistema real usa scrypt de Node; esto solo corre dentro del navegador de quien prueba. */
function sha256(texto) {
  const b = new TextEncoder().encode(texto), K = [], H = [1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225];
  for (let n = 2, c = 0; c < 64; n++) { let p = true; for (let i = 2; i * i <= n; i++) if (n % i === 0) { p = false; break; } if (p) K[c++] = (Math.cbrt(n) % 1) * 4294967296 | 0; }
  const l = b.length, m = new Uint8Array(((l + 9 + 63) >> 6) << 6); m.set(b); m[l] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(m.length - 4, l * 8);
  const w = new Int32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(o + i * 4);
    for (let i = 16; i < 64; i++) { const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
    let [a, bb, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
const azar = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => x.toString(16).padStart(2, '0')).join('');
export function hashSecreto(s) { const sal = azar(16); return `demo$${sal}$${sha256(sal + String(s))}`; }
export function verificarSecreto(s, g) { const [, sal, h] = String(g).split('$'); return !!h && sha256(sal + String(s)) === h; }
export const nuevoToken = () => azar(32);
export const hashToken = (t) => sha256(String(t));
export const pinAleatorio = () => String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
