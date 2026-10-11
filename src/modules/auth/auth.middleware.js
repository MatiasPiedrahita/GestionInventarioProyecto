const { NoAutenticado, SinPermiso, CambioDePasswordRequerido } = require('../../shared/errors');

function leerToken(req) {
  const cabecera = req.get('authorization') || '';
  const [tipo, token] = cabecera.split(' ');
  return tipo === 'Bearer' && token ? token : null;
}

/** Exige una sesión válida y deja el usuario en req.usuario. */
function crearAutenticacion(servicioAuth) {
  return function autenticar(req, res, next) {
    const token = leerToken(req);
    const usuario = servicioAuth.usuarioDesdeToken(token);
    if (!usuario) return next(new NoAutenticado(token ? 'Tu sesión expiró. Inicia sesión de nuevo' : undefined));
    req.usuario = usuario;
    req.token = token;
    return next();
  };
}

/** Permite el paso solo a los roles indicados (se usa después de autenticar). */
function autorizar(...roles) {
  return function verificarRol(req, res, next) {
    if (!req.usuario || !roles.includes(req.usuario.rol)) return next(new SinPermiso());
    return next();
  };
}

/**
 * Con una contraseña temporal solo se puede entrar a cambiarla: el resto de
 * la API queda cerrado hasta que el usuario ponga la suya.
 */
function exigirPasswordPropia(req, res, next) {
  if (req.usuario && req.usuario.debeCambiarPassword) return next(new CambioDePasswordRequerido());
  return next();
}

module.exports = { crearAutenticacion, autorizar, exigirPasswordPropia, leerToken };
