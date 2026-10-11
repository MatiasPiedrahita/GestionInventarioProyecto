const { ROLES } = require('../auth/roles');

/** Estados de una orden de trabajo y su nombre para mostrar. */
const ESTADOS = Object.freeze({
  EN_PROCESO: 'EN_PROCESO',
  FINALIZADA: 'FINALIZADA',
  CANCELADA: 'CANCELADA',
});

const NOMBRE_ESTADO = Object.freeze({
  EN_PROCESO: 'En proceso',
  FINALIZADA: 'Finalizada',
  CANCELADA: 'Cancelada',
});

/**
 * A qué estados se puede pasar desde cada uno. Una orden en proceso se
 * finaliza o se cancela; una orden cerrada solo puede reabrirse.
 */
const TRANSICIONES = Object.freeze({
  [ESTADOS.EN_PROCESO]: [ESTADOS.FINALIZADA, ESTADOS.CANCELADA],
  [ESTADOS.FINALIZADA]: [ESTADOS.EN_PROCESO],
  [ESTADOS.CANCELADA]: [ESTADOS.EN_PROCESO],
});

/** Reabrir una orden cerrada es una decisión de quien administra el taller. */
const ROLES_QUE_REABREN = Object.freeze([ROLES.DUENO, ROLES.ADMINISTRADOR]);

const esReapertura = (actual, nuevo) => actual !== ESTADOS.EN_PROCESO && nuevo === ESTADOS.EN_PROCESO;

/**
 * Decide si un rol puede llevar una orden de un estado a otro (función pura).
 * @returns {{ permitida: boolean, razon: null | 'MISMO_ESTADO' | 'TRANSICION_INVALIDA' | 'ROL_SIN_PERMISO' }}
 */
function evaluarTransicion(actual, nuevo, rol) {
  if (actual === nuevo) return { permitida: false, razon: 'MISMO_ESTADO' };
  if (!(TRANSICIONES[actual] || []).includes(nuevo)) return { permitida: false, razon: 'TRANSICION_INVALIDA' };
  if (esReapertura(actual, nuevo) && !ROLES_QUE_REABREN.includes(rol)) return { permitida: false, razon: 'ROL_SIN_PERMISO' };
  return { permitida: true, razon: null };
}

module.exports = { ESTADOS, NOMBRE_ESTADO, TRANSICIONES, ROLES_QUE_REABREN, evaluarTransicion, esReapertura };
