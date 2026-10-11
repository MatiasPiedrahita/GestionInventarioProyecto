const { TODOS_LOS_ROLES } = require('../auth/roles');
const { normalizarEmail } = require('../auth/email');

/**
 * Validación de los datos editables de un usuario (función pura):
 * nombre, rol y correo. El nombre de usuario no se cambia: queda en la
 * auditoría y en el historial de las órdenes.
 */
const LIMITE_NOMBRE = 80;

function validarDatosDeUsuario(entrada) {
  const errores = [];
  const datos = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};

  const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : '';
  if (nombre === '') errores.push({ campo: 'nombre', mensaje: 'El nombre es obligatorio' });
  else if (nombre.length > LIMITE_NOMBRE) errores.push({ campo: 'nombre', mensaje: `El nombre admite máximo ${LIMITE_NOMBRE} caracteres` });

  if (!TODOS_LOS_ROLES.includes(datos.rol)) {
    errores.push({ campo: 'rol', mensaje: `El rol debe ser uno de: ${TODOS_LOS_ROLES.join(', ')}` });
  }

  const correo = normalizarEmail(datos.email);
  if (correo.error) errores.push({ campo: 'email', mensaje: correo.error });

  if (errores.length > 0) return { valido: false, errores, valor: null };
  return { valido: true, errores: [], valor: { nombre, rol: datos.rol, email: correo.valor } };
}

module.exports = { validarDatosDeUsuario, LIMITE_NOMBRE };
