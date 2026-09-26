import crypto from 'node:crypto';

const N = 16384, R = 8, P = 1, LARGO = 32;

/** Hash scrypt con sal: formato scrypt$N$r$p$sal$hash (base64url). */
export function hashSecreto(secreto) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(secreto), sal, LARGO, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64url')}$${h.toString('base64url')}`;
}

export function verificarSecreto(secreto, guardado) {
  try {
    const [alg, n, r, p, sal, hash] = String(guardado).split('$');
    if (alg !== 'scrypt') return false;
    const esperado = Buffer.from(hash, 'base64url');
    const h = crypto.scryptSync(String(secreto), Buffer.from(sal, 'base64url'), esperado.length, { N: +n, r: +r, p: +p });
    return crypto.timingSafeEqual(h, esperado);
  } catch {
    return false;
  }
}

export const nuevoToken = () => crypto.randomBytes(32).toString('base64url');
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('base64url');
export const pinAleatorio = () => String(crypto.randomInt(1000, 10000));
