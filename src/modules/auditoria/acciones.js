/** Acciones que quedan en el registro de auditoría y su nombre para mostrar. */
const ACCIONES = Object.freeze({
  LOGIN_OK: 'LOGIN_OK',
  LOGIN_FALLIDO: 'LOGIN_FALLIDO',
  CUENTA_BLOQUEADA: 'CUENTA_BLOQUEADA',
  LOGOUT: 'LOGOUT',
  SESIONES_CERRADAS: 'SESIONES_CERRADAS',
  PASSWORD_CAMBIADA: 'PASSWORD_CAMBIADA',
  ORDEN_ESTADO: 'ORDEN_ESTADO',
  REPUESTO_BAJA: 'REPUESTO_BAJA',
  REPUESTO_AJUSTE: 'REPUESTO_AJUSTE',
  REPUESTO_IMPORTACION: 'REPUESTO_IMPORTACION',
});

const NOMBRE_ACCION = Object.freeze({
  LOGIN_OK: 'Inicio de sesión',
  LOGIN_FALLIDO: 'Intento fallido de inicio de sesión',
  CUENTA_BLOQUEADA: 'Cuenta bloqueada por intentos fallidos',
  LOGOUT: 'Cierre de sesión',
  SESIONES_CERRADAS: 'Cierre de todas las sesiones',
  PASSWORD_CAMBIADA: 'Cambio de contraseña',
  ORDEN_ESTADO: 'Cambio de estado de una orden',
  REPUESTO_BAJA: 'Repuesto dado de baja',
  REPUESTO_AJUSTE: 'Ajuste manual de stock',
  REPUESTO_IMPORTACION: 'Carga masiva de repuestos',
});

module.exports = { ACCIONES, NOMBRE_ACCION };
