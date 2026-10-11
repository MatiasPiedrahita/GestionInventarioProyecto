const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITE_EMAIL = 120;

/**
 * Valida y normaliza un correo opcional (función pura).
 * Vacío o ausente es válido: el correo solo hace falta para las notificaciones.
 * @returns {{ valor: string|null, error: string|null }}
 */
function normalizarEmail(email) {
  if (email === undefined || email === null || (typeof email === 'string' && email.trim() === '')) return { valor: null, error: null };
  if (typeof email !== 'string' || email.trim().length > LIMITE_EMAIL || !PATRON_EMAIL.test(email.trim())) {
    return { valor: null, error: 'El correo no es válido' };
  }
  return { valor: email.trim().toLowerCase(), error: null };
}

module.exports = { normalizarEmail, LIMITE_EMAIL };
