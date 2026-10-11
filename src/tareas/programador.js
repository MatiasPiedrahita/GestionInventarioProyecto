/**
 * Tareas programadas del servidor (el contenedor "Tarea Programada" del
 * diagrama C4). Ejecuta funciones cada cierto tiempo y recuerda cuándo
 * corrió cada una y con qué resultado, para mostrarlo en Administración.
 *
 * Un fallo en una tarea se registra y no detiene el servidor ni las demás.
 *
 * @param {{ ahora?: () => Date, temporizador?: { setInterval: Function, clearInterval: Function } }} opciones
 */
function crearProgramador({ ahora = () => new Date(), temporizador = { setInterval, clearInterval } } = {}) {
  const tareas = new Map();

  async function ejecutar(nombre) {
    const tarea = tareas.get(nombre);
    if (!tarea || tarea.enCurso) return;
    tarea.enCurso = true;
    try {
      tarea.ultimoResultado = (await tarea.funcion()) ?? null;
      tarea.ultimoError = null;
    } catch (error) {
      tarea.ultimoError = String(error && error.message ? error.message : error);
      if (process.env.NODE_ENV !== 'test') console.error(`La tarea programada "${nombre}" falló:`, error);
    } finally {
      tarea.ultimaEjecucion = ahora().toISOString();
      tarea.ejecuciones += 1;
      tarea.enCurso = false;
    }
  }

  return {
    /**
     * @param {string} nombre
     * @param {number} cadaMinutos
     * @param {() => any} funcion
     * @param {{ alIniciar?: boolean }} opciones alIniciar la ejecuta una vez de inmediato.
     */
    programar(nombre, cadaMinutos, funcion, { alIniciar = false } = {}) {
      if (tareas.has(nombre)) throw new Error(`Ya existe una tarea programada llamada "${nombre}"`);
      const intervalo = temporizador.setInterval(() => ejecutar(nombre), cadaMinutos * 60 * 1000);
      // El temporizador no debe impedir que el proceso termine al cerrar el servidor.
      if (intervalo && typeof intervalo.unref === 'function') intervalo.unref();
      tareas.set(nombre, { funcion, cadaMinutos, intervalo, enCurso: false, ejecuciones: 0, ultimaEjecucion: null, ultimoResultado: null, ultimoError: null });
      return alIniciar ? ejecutar(nombre) : Promise.resolve();
    },

    ejecutarAhora: ejecutar,

    estado() {
      return [...tareas].map(([nombre, t]) => ({
        nombre,
        cadaMinutos: t.cadaMinutos,
        ejecuciones: t.ejecuciones,
        ultimaEjecucion: t.ultimaEjecucion,
        ultimoResultado: t.ultimoResultado,
        ultimoError: t.ultimoError,
      }));
    },

    detener() {
      tareas.forEach((tarea) => temporizador.clearInterval(tarea.intervalo));
      tareas.clear();
    },
  };
}

module.exports = { crearProgramador };
