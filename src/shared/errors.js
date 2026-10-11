/**
 * Errores de dominio. Cada uno sabe con qué código HTTP debe responder,
 * así los servicios no dependen de Express.
 */
class ErrorDeDominio extends Error {
  constructor(mensaje, { status = 500, codigo = 'ERROR_INTERNO', detalles } = {}) {
    super(mensaje);
    this.name = this.constructor.name;
    this.status = status;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

class ErrorDeValidacion extends ErrorDeDominio {
  constructor(detalles, mensaje = 'Los datos enviados no son válidos') {
    super(mensaje, { status: 400, codigo: 'VALIDACION', detalles });
  }
}

class NoAutenticado extends ErrorDeDominio {
  constructor(mensaje = 'Debes iniciar sesión') {
    super(mensaje, { status: 401, codigo: 'NO_AUTENTICADO' });
  }
}

class SinPermiso extends ErrorDeDominio {
  constructor(mensaje = 'Tu rol no tiene permiso para esta acción') {
    super(mensaje, { status: 403, codigo: 'SIN_PERMISO' });
  }
}

class NoEncontrado extends ErrorDeDominio {
  constructor(mensaje) {
    super(mensaje, { status: 404, codigo: 'NO_ENCONTRADO' });
  }
}

class Conflicto extends ErrorDeDominio {
  constructor(mensaje, detalles) {
    super(mensaje, { status: 409, codigo: 'CONFLICTO', detalles });
  }
}

/** El usuario entró con una contraseña temporal: debe cambiarla antes de seguir. */
class CambioDePasswordRequerido extends ErrorDeDominio {
  constructor(mensaje = 'Debes cambiar tu contraseña temporal antes de continuar') {
    super(mensaje, { status: 403, codigo: 'CAMBIO_DE_PASSWORD_REQUERIDO' });
  }
}

class DemasiadosIntentos extends ErrorDeDominio {
  /** @param {number} segundos Cuánto falta para poder reintentar (va en la cabecera Retry-After). */
  constructor(segundos) {
    const minutos = Math.max(1, Math.ceil(segundos / 60));
    super(`Demasiados intentos fallidos. Intenta de nuevo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`, {
      status: 429,
      codigo: 'DEMASIADOS_INTENTOS',
    });
    this.reintentarEnSegundos = segundos;
  }
}

module.exports = {
  ErrorDeDominio,
  ErrorDeValidacion,
  NoAutenticado,
  SinPermiso,
  NoEncontrado,
  Conflicto,
  CambioDePasswordRequerido,
  DemasiadosIntentos,
};
