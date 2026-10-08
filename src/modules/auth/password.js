const crypto = require('node:crypto');

/**
 * Hash de contraseñas con scrypt (incluido en Node, diseñado para ser lento
 * y resistir ataques de fuerza bruta). Formato guardado:
 *   scrypt$<sal en hex>$<hash en hex>
 */
const LONGITUD_HASH = 64;

function hashearPassword(password) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, sal, LONGITUD_HASH);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function verificarPassword(password, guardado) {
  if (typeof password !== 'string' || typeof guardado !== 'string') return false;
  const [algoritmo, salHex, hashHex] = guardado.split('$');
  if (algoritmo !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = crypto.scryptSync(password, Buffer.from(salHex, 'hex'), esperado.length);
  // Comparación en tiempo constante: no filtra cuántos caracteres coinciden.
  return crypto.timingSafeEqual(esperado, calculado);
}

module.exports = { hashearPassword, verificarPassword };
