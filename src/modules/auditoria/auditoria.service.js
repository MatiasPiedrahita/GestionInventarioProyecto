const LIMITE_DETALLE = 300;

/**
 * Registro de auditoría: deja constancia de las acciones sensibles (quién,
 * qué, sobre qué y cuándo). Los demás servicios lo reciben por parámetro.
 */
function crearServicioAuditoria(repositorio) {
  return {
    registrar({ usuarioId = null, accion, entidad = null, entidadId = null, detalle = null, ip = null }) {
      repositorio.insertar({
        usuarioId,
        accion,
        entidad,
        entidadId,
        detalle: typeof detalle === 'string' ? detalle.slice(0, LIMITE_DETALLE) : null,
        ip,
      });
    },
  };
}

/** Para construir un servicio sin auditoría (scripts y pruebas unitarias). */
const SIN_AUDITORIA = Object.freeze({ registrar() {} });

module.exports = { crearServicioAuditoria, SIN_AUDITORIA };
