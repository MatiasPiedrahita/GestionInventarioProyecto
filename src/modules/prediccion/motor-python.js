const { spawn } = require('node:child_process');
const { resolverPython, CARPETA_DEL_MODELO } = require('./interprete');

const TIEMPO_LIMITE_MS = 5 * 60 * 1000;
const SALIDA_MAXIMA = 64 * 1024 * 1024;
const AYUDA = 'Prepare el entorno con: npm run prediccion:instalar';

/** Error del modelo con un mensaje pensado para mostrarlo en Administración. */
class ErrorDelModelo extends Error {
  constructor(mensaje, { codigo = 'ERROR_DEL_MODELO', detalle = null } = {}) {
    super(mensaje);
    this.name = 'ErrorDelModelo';
    this.codigo = codigo;
    this.detalle = detalle;
  }
}

/** Traduce los fallos típicos de Python a un mensaje que diga qué hacer. */
function explicar(codigoDeSalida, stdout, stderr) {
  try {
    const { error } = JSON.parse(stdout);
    if (error && error.mensaje) return new ErrorDelModelo(`El modelo rechazó los datos: ${error.mensaje}`, { codigo: error.codigo, detalle: stderr });
  } catch { /* la salida no era JSON: se interpreta stderr */ }

  if (/No module named '?taller_prediccion/.test(stderr)) {
    return new ErrorDelModelo(`No se encontró el paquete del modelo en ${CARPETA_DEL_MODELO}.`, { codigo: 'MODELO_NO_ENCONTRADO', detalle: stderr });
  }
  if (/ModuleNotFoundError|No module named/.test(stderr)) {
    const libreria = (stderr.match(/No module named '?([\w.]+)/) || [])[1];
    return new ErrorDelModelo(`Al Python que ejecuta el modelo le falta la librería ${libreria || 'requerida'}. ${AYUDA}`, {
      codigo: 'LIBRERIAS_FALTANTES', detalle: stderr,
    });
  }
  return new ErrorDelModelo(`El modelo terminó con un error (código ${codigoDeSalida}).`, { detalle: stderr.slice(-2000) });
}

/**
 * Ejecuta el modelo de predicción (paquete de Python) como un proceso aparte.
 *
 * Se le entrega un JSON por la entrada estándar y devuelve otro por la
 * salida estándar. No se usa intérprete de comandos (spawn sin shell): los
 * datos nunca se convierten en parte de una orden del sistema.
 *
 * @param {{ interprete?: { ejecutable: string, origen: string }, carpeta?: string, tiempoLimiteMs?: number }} opciones
 */
function crearMotorPython({ interprete = resolverPython(), carpeta = CARPETA_DEL_MODELO, tiempoLimiteMs = TIEMPO_LIMITE_MS } = {}) {
  function ejecutar(argumentos, entrada = null) {
    return new Promise((resolver, rechazar) => {
      let proceso;
      try {
        proceso = spawn(interprete.ejecutable, argumentos, { cwd: carpeta, windowsHide: true, shell: false });
      } catch (error) {
        rechazar(new ErrorDelModelo(`No se pudo iniciar Python (${interprete.origen}): ${error.message}. ${AYUDA}`, { codigo: 'PYTHON_NO_ENCONTRADO' }));
        return;
      }

      const stdout = [];
      const stderr = [];
      let recibido = 0;
      let terminado = false;
      let limite = null;
      const terminar = (accion) => {
        if (terminado) return;
        terminado = true;
        clearTimeout(limite);
        accion();
      };

      limite = setTimeout(() => {
        proceso.kill();
        terminar(() => rechazar(new ErrorDelModelo(
          `El modelo tardó más de ${Math.round(tiempoLimiteMs / 60000) || 1} minuto(s) y se detuvo.`, { codigo: 'TIEMPO_AGOTADO' },
        )));
      }, tiempoLimiteMs);

      proceso.stdout.on('data', (trozo) => {
        recibido += trozo.length;
        if (recibido > SALIDA_MAXIMA) {
          proceso.kill();
          terminar(() => rechazar(new ErrorDelModelo('El modelo devolvió más datos de los esperados.', { codigo: 'SALIDA_EXCESIVA' })));
          return;
        }
        stdout.push(trozo);
      });
      proceso.stderr.on('data', (trozo) => stderr.push(trozo));

      proceso.on('error', (error) => terminar(() => rechazar(new ErrorDelModelo(
        error.code === 'ENOENT'
          ? `No se encontró Python (${interprete.origen}: ${interprete.ejecutable}). ${AYUDA}`
          : `No se pudo ejecutar Python: ${error.message}`,
        { codigo: 'PYTHON_NO_ENCONTRADO' },
      ))));

      proceso.on('close', (codigo) => terminar(() => {
        const salida = Buffer.concat(stdout).toString('utf8');
        const errores = Buffer.concat(stderr).toString('utf8');
        if (codigo === 0) resolver(salida);
        else rechazar(explicar(codigo, salida, errores));
      }));

      // Si Python no arranca, escribirle falla: ese error ya lo informa el evento "error" del proceso.
      proceso.stdin.on('error', () => {});
      proceso.stdin.end(entrada === null ? '' : entrada);
    });
  }

  return {
    descripcion: `Python: ${interprete.origen}`,
    interprete,

    /** @param {object} entrada Datos según el contrato (prediccion/README.md). @returns {Promise<object>} El resultado del modelo. */
    async predecir(entrada) {
      const salida = await ejecutar(['-m', 'taller_prediccion'], JSON.stringify(entrada));
      try {
        return JSON.parse(salida);
      } catch {
        throw new ErrorDelModelo('El modelo respondió algo que no es JSON.', { codigo: 'RESPUESTA_INVALIDA', detalle: salida.slice(0, 500) });
      }
    },

    /** Comprueba que el modelo se puede ejecutar. @returns {Promise<{ disponible: boolean, version?: string, motivo?: string }>} */
    async comprobar() {
      try {
        const salida = await ejecutar(['-m', 'taller_prediccion', '--version']);
        return { disponible: true, version: salida.trim() };
      } catch (error) {
        return { disponible: false, motivo: error.message };
      }
    },
  };
}

module.exports = { crearMotorPython, ErrorDelModelo, explicar };
