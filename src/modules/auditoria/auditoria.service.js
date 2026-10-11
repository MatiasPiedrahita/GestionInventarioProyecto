const { validarFiltrosDeAuditoria } = require('./auditoria.filtros.validator');
const { ACCIONES, NOMBRE_ACCION } = require('./acciones');
const { ErrorDeValidacion } = require('../../shared/errors');

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

    /** Consulta paginada para el panel de administración. */
    listar(query) {
      const resultado = validarFiltrosDeAuditoria(query);
      if (!resultado.valido) throw new ErrorDeValidacion(resultado.errores, 'Los filtros de la auditoría no son válidos');
      const filtros = resultado.valor;
      const { datos, total } = repositorio.buscar(filtros);
      return {
        datos: datos.map((registro) => ({ ...registro, accionNombre: NOMBRE_ACCION[registro.accion] || registro.accion })),
        pagina: filtros.pagina,
        tamano: filtros.tamano,
        total,
        totalPaginas: Math.max(1, Math.ceil(total / filtros.tamano)),
      };
    },

    /** Catálogo de acciones para armar el filtro en la interfaz. */
    acciones() {
      return Object.values(ACCIONES).map((accion) => ({ accion, nombre: NOMBRE_ACCION[accion] }));
    },
  };
}

/** Para construir un servicio sin auditoría (scripts y pruebas unitarias). */
const SIN_AUDITORIA = Object.freeze({ registrar() {} });

module.exports = { crearServicioAuditoria, SIN_AUDITORIA };
