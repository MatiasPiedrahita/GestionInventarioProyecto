const crypto = require('node:crypto');
const { hashearPassword, verificarPassword, problemaDePassword, LONGITUD_MAXIMA } = require('./password');
const { TODOS_LOS_ROLES, VISTA_INICIAL } = require('./roles');
const { normalizarEmail } = require('./email');
const { crearLimitador } = require('../../shared/limitador');
const { ACCIONES } = require('../auditoria/acciones');
const { SIN_AUDITORIA } = require('../auditoria/auditoria.service');
const { ErrorDeValidacion, NoAutenticado, Conflicto, DemasiadosIntentos } = require('../../shared/errors');

const PATRON_USUARIO = /^[a-z0-9._-]{3,30}$/i;

// Fuerza bruta: 5 fallos seguidos con el mismo usuario lo bloquean 15 minutos,
// exista o no (así el bloqueo no revela qué usuarios existen). El límite por
// IP es más alto porque varios computadores del taller pueden compartirla.
const MAXIMO_FALLOS_POR_USUARIO = 5;
const MAXIMO_FALLOS_POR_IP = 30;
const MINUTOS_DE_BLOQUEO = 15;

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
 * @param {{ horasDeSesion?: number, ahora?: () => Date, auditoria?: object }} opciones
 */
function crearServicioAuth(repositorio, { horasDeSesion = 8, ahora = () => new Date(), auditoria = SIN_AUDITORIA } = {}) {
  const ventanaMs = MINUTOS_DE_BLOQUEO * 60 * 1000;
  const fallosPorUsuario = crearLimitador({ maximo: MAXIMO_FALLOS_POR_USUARIO, ventanaMs, ahora });
  const fallosPorIp = crearLimitador({ maximo: MAXIMO_FALLOS_POR_IP, ventanaMs, ahora });

  /** Segundos que faltan para que la cuenta o la IP puedan volver a intentar. */
  function segundosDeEspera(nombre, encontrado, ip, momento) {
    const porBaseDeDatos = encontrado && encontrado.bloqueadoHasta
      ? Math.ceil((Date.parse(encontrado.bloqueadoHasta) - momento.getTime()) / 1000)
      : 0;
    return Math.max(fallosPorUsuario.segundosDeBloqueo(nombre), ip ? fallosPorIp.segundosDeBloqueo(ip) : 0, porBaseDeDatos, 0);
  }

  function registrarFallo(nombre, encontrado, ip, momento) {
    const fallos = fallosPorUsuario.registrarFallo(nombre);
    if (ip) fallosPorIp.registrarFallo(ip);
    const seBloquea = fallos >= MAXIMO_FALLOS_POR_USUARIO;
    if (encontrado) {
      const hasta = seBloquea ? new Date(momento.getTime() + ventanaMs).toISOString() : null;
      repositorio.registrarFalloDeLogin(encontrado.id, fallos, hasta);
    }
    // El texto escrito como usuario no se guarda: a veces la gente escribe ahí su contraseña.
    auditoria.registrar({
      usuarioId: encontrado ? encontrado.id : null,
      accion: seBloquea ? ACCIONES.CUENTA_BLOQUEADA : ACCIONES.LOGIN_FALLIDO,
      detalle: encontrado ? `Intento ${fallos} de ${MAXIMO_FALLOS_POR_USUARIO}` : 'Usuario inexistente',
      ip,
    });
  }

  return {
    crearUsuario({ usuario, nombre, rol, password, email, debeCambiarPassword = false }) {
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
      const problema = problemaDePassword(password, { usuario: typeof usuario === 'string' ? usuario.trim() : '' });
      if (problema) errores.push({ campo: 'password', mensaje: problema });
      const correo = normalizarEmail(email);
      if (correo.error) errores.push({ campo: 'email', mensaje: correo.error });
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
        email: correo.valor,
        debeCambiarPassword: debeCambiarPassword === true,
      });
      return repositorio.buscarPorId(id);
    },

    iniciarSesion(usuario, password, { ip = null } = {}) {
      if (typeof usuario !== 'string' || usuario.trim() === '' || typeof password !== 'string' || password === '') {
        throw new ErrorDeValidacion([{ campo: '_', mensaje: 'Escribe tu usuario y tu contraseña' }]);
      }
      const nombre = usuario.trim().toLowerCase().slice(0, 60);
      const momento = ahora();
      const encontrado = repositorio.buscarConCredenciales(nombre);

      const espera = segundosDeEspera(nombre, encontrado, ip, momento);
      if (espera > 0) throw new DemasiadosIntentos(espera);

      const valido = password.length <= LONGITUD_MAXIMA
        && verificarPassword(password, encontrado ? encontrado.passwordHash : HASH_DE_RELLENO);
      if (!encontrado || !valido || !encontrado.activo) {
        registrarFallo(nombre, encontrado, ip, momento);
        throw new NoAutenticado('Usuario o contraseña incorrectos');
      }

      fallosPorUsuario.limpiar(nombre);
      repositorio.reiniciarFallosDeLogin(encontrado.id);
      repositorio.borrarSesionesVencidas(momento.toISOString());
      const token = crypto.randomBytes(32).toString('base64url');
      const expiraEn = new Date(momento.getTime() + horasDeSesion * 3600 * 1000).toISOString();
      repositorio.crearSesion(hashDeToken(token), encontrado.id, expiraEn);
      auditoria.registrar({ usuarioId: encontrado.id, accion: ACCIONES.LOGIN_OK, ip });

      const { passwordHash, bloqueadoHasta, ...publico } = encontrado;
      return { token, expiraEn, usuario: publico, vistaInicial: VISTA_INICIAL[publico.rol] };
    },

    usuarioDesdeToken(token) {
      if (typeof token !== 'string' || token === '') return null;
      return repositorio.usuarioDeSesion(hashDeToken(token), ahora().toISOString());
    },

    cerrarSesion(token) {
      if (typeof token === 'string' && token !== '') repositorio.borrarSesion(hashDeToken(token));
    },

    /** Cierra la sesión del usuario en todos los dispositivos, incluido el actual. */
    cerrarTodasLasSesiones(usuario) {
      const cerradas = repositorio.borrarSesionesDe(usuario.id);
      auditoria.registrar({ usuarioId: usuario.id, accion: ACCIONES.SESIONES_CERRADAS, detalle: `${cerradas} sesión(es)` });
      return cerradas;
    },

    /**
     * El usuario cambia su propia contraseña. Exige la actual (por si alguien
     * encontró la sesión abierta) y cierra sus sesiones en otros dispositivos.
     */
    cambiarPassword(usuario, entrada, tokenActual) {
      const { actual, nueva } = entrada && typeof entrada === 'object' ? entrada : {};
      const errores = [];
      if (typeof actual !== 'string' || actual === '') errores.push({ campo: 'actual', mensaje: 'Escribe tu contraseña actual' });
      const problema = problemaDePassword(nueva, { usuario: usuario.usuario });
      if (problema) errores.push({ campo: 'nueva', mensaje: problema });
      else if (nueva === actual) errores.push({ campo: 'nueva', mensaje: 'La contraseña nueva debe ser distinta de la actual' });
      if (errores.length > 0) throw new ErrorDeValidacion(errores);

      // Con la sesión abierta también se limita adivinar la contraseña actual.
      const clave = `cambio:${usuario.id}`;
      const espera = fallosPorUsuario.segundosDeBloqueo(clave);
      if (espera > 0) throw new DemasiadosIntentos(espera);

      const conHash = repositorio.buscarConCredenciales(usuario.usuario);
      if (actual.length > LONGITUD_MAXIMA || !verificarPassword(actual, conHash.passwordHash)) {
        fallosPorUsuario.registrarFallo(clave);
        throw new ErrorDeValidacion([{ campo: 'actual', mensaje: 'La contraseña actual no es correcta' }]);
      }

      fallosPorUsuario.limpiar(clave);
      repositorio.actualizarPassword(usuario.id, hashearPassword(nueva), { debeCambiarPassword: false });
      const cerradas = repositorio.borrarOtrasSesiones(usuario.id, hashDeToken(tokenActual));
      auditoria.registrar({
        usuarioId: usuario.id,
        accion: ACCIONES.PASSWORD_CAMBIADA,
        detalle: `Cambio propio; ${cerradas} sesión(es) cerrada(s) en otros dispositivos`,
      });
      return repositorio.buscarPorId(usuario.id);
    },

    /**
     * Un administrador asigna una contraseña temporal: el usuario queda
     * obligado a cambiarla, se cierran sus sesiones y se quita el bloqueo.
     */
    asignarPasswordTemporal(usuario, password) {
      repositorio.actualizarPassword(usuario.id, hashearPassword(password), { debeCambiarPassword: true });
      repositorio.borrarSesionesDe(usuario.id);
      fallosPorUsuario.limpiar(usuario.usuario);
    },

    /** Quita el bloqueo por intentos fallidos (lo usa la administración de usuarios). */
    desbloquear(usuario) {
      fallosPorUsuario.limpiar(usuario.usuario);
      repositorio.reiniciarFallosDeLogin(usuario.id);
    },

    listarMecanicos() {
      return repositorio.listarPorRol('mecanico');
    },
  };
}

module.exports = { crearServicioAuth };
