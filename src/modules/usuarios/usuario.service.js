const crypto = require('node:crypto');
const { validarDatosDeUsuario } = require('./usuario.validator');
const { ROLES, NOMBRE_ROL } = require('../auth/roles');
const { ACCIONES } = require('../auditoria/acciones');
const { SIN_AUDITORIA } = require('../auditoria/auditoria.service');
const { ErrorDeValidacion, NoEncontrado, SinPermiso, Conflicto } = require('../../shared/errors');

/** Roles que un administrador puede crear y gestionar. Dueños y administradores son asunto del dueño. */
const ROLES_OPERATIVOS = Object.freeze([ROLES.MECANICO, ROLES.RECEPCIONISTA]);

/** Contraseña temporal legible: sin caracteres que se confundan al dictarla (0/O, 1/l/I). */
function generarPasswordTemporal() {
  const alfabeto = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(12), (byte) => alfabeto[byte % alfabeto.length]).join('');
}

/**
 * Administración de usuarios (panel de administración).
 *
 * Quién gestiona a quién:
 *  - El dueño gestiona a cualquiera.
 *  - El administrador gestiona mecánicos y recepcionistas; no toca cuentas
 *    de dueño ni de otros administradores, ni puede crear esos roles.
 *  - Nadie se desactiva, se cambia el rol ni se restablece la contraseña a
 *    sí mismo desde aquí (para lo propio está "Mi cuenta").
 *
 * @param {object} repositorio Repositorio de usuarios.
 * @param {{ auth: object, ordenesEnProcesoDe?: (id: number) => number, auditoria?: object,
 *           ahora?: () => Date, generarPassword?: () => string }} dependencias
 */
function crearServicioUsuarios(repositorio, {
  auth,
  ordenesEnProcesoDe = () => 0,
  auditoria = SIN_AUDITORIA,
  ahora = () => new Date(),
  generarPassword = generarPasswordTemporal,
}) {
  const puedeAsignar = (actor, rol) => actor.rol === ROLES.DUENO || ROLES_OPERATIVOS.includes(rol);
  const puedeGestionar = (actor, objetivo) => actor.rol === ROLES.DUENO || ROLES_OPERATIVOS.includes(objetivo.rol);

  function exigirExistente(id) {
    const usuario = repositorio.buscarPorId(id);
    if (!usuario) throw new NoEncontrado(`No existe el usuario con id ${id}`);
    return usuario;
  }

  function exigirGestionable(actor, objetivo) {
    if (!puedeGestionar(actor, objetivo)) {
      throw new SinPermiso(`Solo el dueño puede modificar la cuenta de un ${NOMBRE_ROL[objetivo.rol].toLowerCase()}`);
    }
  }

  function exigirRolAsignable(actor, rol) {
    if (!puedeAsignar(actor, rol)) {
      throw new SinPermiso(`Solo el dueño puede asignar el rol ${NOMBRE_ROL[rol].toLowerCase()}`);
    }
  }

  /** Un mecánico con trabajo abierto no puede quedar sin acceso: primero se reasignan sus órdenes. */
  function exigirSinOrdenesAbiertas(objetivo, accion) {
    if (objetivo.rol !== ROLES.MECANICO) return;
    const abiertas = ordenesEnProcesoDe(objetivo.id);
    if (abiertas > 0) {
      throw new Conflicto(
        `${objetivo.nombre} tiene ${abiertas} ${abiertas === 1 ? 'orden' : 'órdenes'} en proceso. Reasígnalas o ciérralas antes de ${accion}`,
      );
    }
  }

  function exigirOtroDuenoActivo(objetivo, accion) {
    if (objetivo.rol === ROLES.DUENO && objetivo.activo && repositorio.contarActivosPorRol(ROLES.DUENO) <= 1) {
      throw new Conflicto(`No se puede ${accion}: es el único dueño activo y el taller se quedaría sin quien lo administre`);
    }
  }

  function presentar(usuario, actor) {
    return {
      ...usuario,
      nombreRol: NOMBRE_ROL[usuario.rol],
      esYo: usuario.id === actor.id,
      gestionable: usuario.id !== actor.id && puedeGestionar(actor, usuario),
    };
  }

  const registrar = (actor, accion, objetivo, detalle = null) => auditoria.registrar({
    usuarioId: actor.id,
    accion,
    entidad: 'usuario',
    entidadId: objetivo.id,
    detalle: detalle ? `${objetivo.usuario}: ${detalle}` : objetivo.usuario,
  });

  return {
    listar(actor) {
      return repositorio.listarConEstado(ahora().toISOString()).map((usuario) => presentar(usuario, actor));
    },

    /** Roles que el actor puede asignar al crear o editar. */
    rolesAsignables(actor) {
      const roles = actor.rol === ROLES.DUENO ? Object.values(ROLES) : ROLES_OPERATIVOS;
      return roles.map((rol) => ({ rol, nombre: NOMBRE_ROL[rol] }));
    },

    /**
     * Crea el usuario con una contraseña temporal generada por el sistema.
     * Se devuelve una sola vez; el usuario debe cambiarla al entrar.
     */
    crear(entrada, actor) {
      const datos = entrada && typeof entrada === 'object' ? entrada : {};
      if (Object.values(ROLES).includes(datos.rol)) exigirRolAsignable(actor, datos.rol);

      const passwordTemporal = generarPassword();
      const creado = auth.crearUsuario({
        usuario: datos.usuario,
        nombre: datos.nombre,
        rol: datos.rol,
        email: datos.email,
        password: passwordTemporal,
        debeCambiarPassword: true,
      });
      registrar(actor, ACCIONES.USUARIO_CREADO, creado, `rol ${NOMBRE_ROL[creado.rol]}`);
      return { usuario: presentar(creado, actor), passwordTemporal };
    },

    editar(id, entrada, actor) {
      const objetivo = exigirExistente(id);
      exigirGestionable(actor, objetivo);
      const resultado = validarDatosDeUsuario(entrada);
      if (!resultado.valido) throw new ErrorDeValidacion(resultado.errores);
      const { nombre, rol, email } = resultado.valor;

      if (rol !== objetivo.rol) {
        if (objetivo.id === actor.id) throw new Conflicto('No puedes cambiar tu propio rol');
        exigirRolAsignable(actor, rol);
        exigirSinOrdenesAbiertas(objetivo, 'cambiarle el rol');
        exigirOtroDuenoActivo(objetivo, 'cambiarle el rol');
      }

      repositorio.actualizarDatos(id, { nombre, rol, email });
      // Con el rol cambian los permisos: las sesiones abiertas se cierran para que vuelva a entrar.
      if (rol !== objetivo.rol) repositorio.borrarSesionesDe(id);
      const cambios = [
        nombre !== objetivo.nombre ? 'nombre' : null,
        rol !== objetivo.rol ? `rol de ${NOMBRE_ROL[objetivo.rol]} a ${NOMBRE_ROL[rol]}` : null,
        email !== objetivo.email ? 'correo' : null,
      ].filter(Boolean);
      registrar(actor, ACCIONES.USUARIO_EDITADO, objetivo, cambios.join(', ') || 'sin cambios');
      return presentar(repositorio.buscarPorId(id), actor);
    },

    /** Activa o desactiva la cuenta. Desactivar cierra sus sesiones de inmediato. */
    cambiarActivo(id, entrada, actor) {
      const activo = entrada && typeof entrada === 'object' ? entrada.activo : undefined;
      if (typeof activo !== 'boolean') {
        throw new ErrorDeValidacion([{ campo: 'activo', mensaje: 'Indica si la cuenta queda activa (true) o inactiva (false)' }]);
      }
      const objetivo = exigirExistente(id);
      if (objetivo.id === actor.id) throw new Conflicto('No puedes desactivar tu propia cuenta');
      exigirGestionable(actor, objetivo);
      if (objetivo.activo === activo) return presentar(objetivo, actor);

      if (!activo) {
        exigirSinOrdenesAbiertas(objetivo, 'desactivarlo');
        exigirOtroDuenoActivo(objetivo, 'desactivar esta cuenta');
      }
      repositorio.cambiarActivo(id, activo);
      if (!activo) repositorio.borrarSesionesDe(id);
      registrar(actor, activo ? ACCIONES.USUARIO_ACTIVADO : ACCIONES.USUARIO_DESACTIVADO, objetivo);
      return presentar(repositorio.buscarPorId(id), actor);
    },

    /** Asigna una contraseña temporal nueva, cierra las sesiones y quita el bloqueo por intentos. */
    restablecerPassword(id, actor) {
      const objetivo = exigirExistente(id);
      if (objetivo.id === actor.id) throw new Conflicto('Para cambiar tu propia contraseña usa "Mi cuenta"');
      exigirGestionable(actor, objetivo);

      const passwordTemporal = generarPassword();
      auth.asignarPasswordTemporal(objetivo, passwordTemporal);
      registrar(actor, ACCIONES.PASSWORD_RESTABLECIDA, objetivo);
      return { usuario: presentar(repositorio.buscarPorId(id), actor), passwordTemporal };
    },

    cerrarSesiones(id, actor) {
      const objetivo = exigirExistente(id);
      if (objetivo.id !== actor.id) exigirGestionable(actor, objetivo);
      const cerradas = repositorio.borrarSesionesDe(id);
      registrar(actor, ACCIONES.SESIONES_CERRADAS, objetivo, `${cerradas} sesión(es) cerrada(s) desde administración`);
      return { cerradas };
    },

    desbloquear(id, actor) {
      const objetivo = exigirExistente(id);
      exigirGestionable(actor, objetivo);
      auth.desbloquear(objetivo);
      registrar(actor, ACCIONES.USUARIO_DESBLOQUEADO, objetivo);
      return presentar(repositorio.buscarPorId(id), actor);
    },
  };
}

module.exports = { crearServicioUsuarios, generarPasswordTemporal, ROLES_OPERATIVOS };
