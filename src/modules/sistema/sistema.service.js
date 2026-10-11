const { version } = require('../../../package.json');

/**
 * Estado del sistema para el panel de administración: versiones, tamaño de
 * los datos y lo que cada módulo quiera informar (correo, tareas, modelo).
 *
 * @param {object} repositorio Repositorio de sistema.
 * @param {{ ahora?: () => Date, iniciadoEn?: Date }} opciones
 */
function crearServicioSistema(repositorio, { ahora = () => new Date(), iniciadoEn = new Date() } = {}) {
  /** Otros módulos registran aquí una función que devuelve su estado. */
  const secciones = new Map();

  return {
    registrarSeccion(nombre, obtener) {
      secciones.set(nombre, obtener);
    },

    estado() {
      const momento = ahora();
      const estado = {
        version,
        versionDelEsquema: repositorio.versionDelEsquema(),
        node: process.version,
        iniciadoEn: iniciadoEn.toISOString(),
        minutosEncendido: Math.max(0, Math.floor((momento.getTime() - iniciadoEn.getTime()) / 60000)),
        datos: repositorio.conteos(momento.toISOString()),
      };
      secciones.forEach((obtener, nombre) => { estado[nombre] = obtener(); });
      return estado;
    },
  };
}

module.exports = { crearServicioSistema };
