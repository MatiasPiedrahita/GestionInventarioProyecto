const crypto = require('node:crypto');
const { hashearPassword, verificarPassword } = require('./password');
const { TODOS_LOS_ROLES, VISTA_INICIAL } = require('./roles');
const { ErrorDeValidacion, NoAutenticado, Conflicto } = require('../../shared/errors');

const PATRON_USUARIO = /^[a-z0-9._-]{3,30}$/i;
const LONGITUD_MINIMA_PASSWORD = 8;

// Hash de relleno: se verifica contra él cuando el usuario no existe, para
// que la respuesta tarde lo mismo y no revele qué usuarios existen.
const HASH_DE_RELLENO = hashearPassword('relleno-para-tiempo-constante');

function hashDeToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Autenticación por sesión: el login entrega un token aleatorio que el
 * cliente envía en "Authorization: Bearer <token>". La sesión vive en la
 * base de datos, así cerrar sesión la invalida de inmediato.
 *
 * @param {object} repositorio Repositorio de usuarios.
 * @param {{ horasDeSesion?: number, ahora?: () => Date }} opciones
 */
function crearServicioAuth(repositorio, { horasDeSesion = 8, ahora = () => new Date() } = {}) {
  return {
    crearUsuario({ usuario, nombre, rol, password }) {
      const errores = [];
      if (typeof usuario !== 'string' || !PATRON_USUARIO.test(usuario.trim())) {
        errores.push({ campo: 'usuario', mensaje: 'El usuario debe tener de 3 a 30 letras, números, punto, guion o guion bajo' });
      }
      if (typeof nombre !== 'string' || nombre.trim() === '') {
        errores.push({ campo: 'nombre', mensaje: 'El nombre es obligatorio' });
      }
      if (!TODOS_LOS_ROLES.includes(rol)) {
        errores.push({ campo: 'rol', mensaje: `El rol debe ser uno de: ${TODOS_LOS_ROLES.join(', ')}` });
      }
      if (typeof password !== 'string' || password.length < LONGITUD_MINIMA_PASSWORD) {
        errores.push({ campo: 'password', mensaje: `La contraseña debe tener al menos ${LONGITUD_MINIMA_PASSWORD} caracteres` });
      }
      if (errores.length > 0) throw new ErrorDeValidacion(errores);

      const limpio = usuario.trim().toLowerCase();
      if (repositorio.buscarPorUsuario(limpio)) {
        throw new Conflicto(`El usuario ${limpio} ya existe`);
      }
      const id = repositorio.insertar({
        usuario: limpio,
        nombre: nombre.trim(),
        rol,
        passwordHash: hashearPassword(password),
      });
      return repositorio.buscarPorId(id);
    },

    iniciarSesion(usuario, password) {
      if (typeof usuario !== 'string' || usuario.trim() === '' || typeof password !== 'string' || password === '') {
        throw new ErrorDeValidacion([{ campo: '_', mensaje: 'Escribe tu usuario y tu contraseña' }]);
      }
      const encontrado = repositorio.buscarConCredenciales(usuario.trim());
      const valido = verificarPassword(password, encontrado ? encontrado.passwordHash : HASH_DE_RELLENO);
      if (!encontrado || !valido || !encontrado.activo) {
        throw new NoAutenticado('Usuario o contraseña incorrectos');
      }

      const momento = ahora();
      repositorio.borrarSesionesVencidas(momento.toISOString());
      const token = crypto.randomBytes(32).toString('base64url');
      const expiraEn = new Date(momento.getTime() + horasDeSesion * 3600 * 1000).toISOString();
      repositorio.crearSesion(hashDeToken(token), encontrado.id, expiraEn);

      const { passwordHash, ...publico } = encontrado;
      return { token, expiraEn, usuario: publico, vistaInicial: VISTA_INICIAL[publico.rol] };
    },

    usuarioDesdeToken(token) {
      if (typeof token !== 'string' || token === '') return null;
      return repositorio.usuarioDeSesion(hashDeToken(token), ahora().toISOString());
    },

    cerrarSesion(token) {
      if (typeof token === 'string' && token !== '') repositorio.borrarSesion(hashDeToken(token));
    },

    listarMecanicos() {
      return repositorio.listarPorRol('mecanico');
    },
  };
}

module.exports = { crearServicioAuth };
