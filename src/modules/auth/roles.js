/**
 * Roles del taller y a qué vista entra cada uno al iniciar sesión.
 * Es la única fuente de verdad de los roles: backend y pruebas la usan.
 */
const ROLES = Object.freeze({
  DUENO: 'dueno',
  MECANICO: 'mecanico',
  RECEPCIONISTA: 'recepcionista',
  ADMINISTRADOR: 'administrador',
});

const TODOS_LOS_ROLES = Object.freeze(Object.values(ROLES));

/** Vista a la que se redirige cada rol después del login. */
const VISTA_INICIAL = Object.freeze({
  [ROLES.DUENO]: 'inventario',
  [ROLES.ADMINISTRADOR]: 'inventario',
  [ROLES.MECANICO]: 'ordenes',
  [ROLES.RECEPCIONISTA]: 'ordenes',
});

const NOMBRE_ROL = Object.freeze({
  [ROLES.DUENO]: 'Dueño del taller',
  [ROLES.MECANICO]: 'Mecánico',
  [ROLES.RECEPCIONISTA]: 'Recepcionista',
  [ROLES.ADMINISTRADOR]: 'Administrador',
});

module.exports = { ROLES, TODOS_LOS_ROLES, VISTA_INICIAL, NOMBRE_ROL };
