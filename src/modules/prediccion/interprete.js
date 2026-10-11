const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..', '..');

/** Carpeta del paquete de Python (taller_prediccion): desde ahí se ejecuta el modelo. */
const CARPETA_DEL_MODELO = path.join(RAIZ, 'prediccion');

/**
 * Decide con qué Python se ejecuta el modelo, en este orden:
 *
 *  1. La variable PYTHON_BIN del .env, si alguien quiere uno en particular.
 *  2. El entorno virtual del proyecto (.venv), que crea "npm run prediccion:instalar"
 *     y tiene las librerías del modelo. Es lo normal.
 *  3. El Python del sistema, como último recurso.
 *
 * Las dependencias se reciben por parámetro para poder probar las tres
 * situaciones sin tocar el disco.
 *
 * @returns {{ ejecutable: string, origen: string }}
 */
function resolverPython({ entorno = process.env, raiz = RAIZ, existe = fs.existsSync, plataforma = process.platform } = {}) {
  if (entorno.PYTHON_BIN) return { ejecutable: entorno.PYTHON_BIN, origen: 'variable PYTHON_BIN' };

  const delEntornoVirtual = plataforma === 'win32'
    ? path.join(raiz, '.venv', 'Scripts', 'python.exe')
    : path.join(raiz, '.venv', 'bin', 'python');
  if (existe(delEntornoVirtual)) return { ejecutable: delEntornoVirtual, origen: 'entorno virtual del proyecto (.venv)' };

  return { ejecutable: plataforma === 'win32' ? 'python' : 'python3', origen: 'Python del sistema' };
}

module.exports = { resolverPython, CARPETA_DEL_MODELO, RAIZ };
