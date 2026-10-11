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

const LONGITUD_MINIMA = 8;
// El máximo evita que alguien envíe textos enormes para ocupar el servidor calculando hashes.
const LONGITUD_MAXIMA = 128;

/**
 * Política de contraseñas (función pura).
 * @returns {string|null} El motivo del rechazo, o null si la contraseña sirve.
 */
function problemaDePassword(password, { usuario = '' } = {}) {
  if (typeof password !== 'string' || password.length < LONGITUD_MINIMA) {
    return `La contraseña debe tener al menos ${LONGITUD_MINIMA} caracteres`;
  }
  if (password.length > LONGITUD_MAXIMA) return `La contraseña admite máximo ${LONGITUD_MAXIMA} caracteres`;
  if (password.trim() === '') return 'La contraseña no puede ser solo espacios';
  if (usuario && password.toLowerCase() === String(usuario).toLowerCase()) {
    return 'La contraseña no puede ser igual al nombre de usuario';
  }
  if (new Set(password).size === 1) return 'La contraseña no puede repetir un solo carácter';
  return null;
}

module.exports = { hashearPassword, verificarPassword, problemaDePassword, LONGITUD_MINIMA, LONGITUD_MAXIMA };
