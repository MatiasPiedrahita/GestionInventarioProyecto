/**
 * Prepara el entorno de Python del modelo de predicción.
 * Uso: npm run prediccion:instalar            (solo lo necesario para ejecutar el modelo)
 *      npm run prediccion:instalar -- --dev   (además, pytest para correr sus pruebas)
 *
 * Crea un entorno virtual en .venv (no se sube al repositorio) e instala ahí
 * las librerías de prediccion/requirements.txt. Así el modelo no depende de
 * lo que cada quien tenga instalado en su Python, ni lo altera.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolverPython, CARPETA_DEL_MODELO, RAIZ } = require('../src/modules/prediccion/interprete');

const CARPETA_DEL_ENTORNO = path.join(RAIZ, '.venv');
const conPruebas = process.argv.includes('--dev');

function ejecutar(ejecutable, argumentos, descripcion, carpeta = RAIZ) {
  console.log(`> ${descripcion}`);
  const resultado = spawnSync(ejecutable, argumentos, { stdio: 'inherit', cwd: carpeta });
  if (resultado.error || resultado.status !== 0) {
    const motivo = resultado.error ? resultado.error.message : `código de salida ${resultado.status}`;
    console.error(`\nNo se pudo completar "${descripcion}" (${motivo}).`);
    console.error('Verifique que Python 3.11 o superior esté instalado: python --version');
    process.exit(1);
  }
}

if (!fs.existsSync(CARPETA_DEL_ENTORNO)) {
  // Para crear el entorno se usa el Python del sistema (o PYTHON_BIN); después, siempre el del entorno.
  const { ejecutable } = resolverPython({ existe: () => false });
  ejecutar(ejecutable, ['-m', 'venv', CARPETA_DEL_ENTORNO], 'Crear el entorno virtual en .venv');
}

const { ejecutable, origen } = resolverPython({ entorno: {} });
const requisitos = path.join(CARPETA_DEL_MODELO, conPruebas ? 'requirements-dev.txt' : 'requirements.txt');
ejecutar(ejecutable, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip'], 'Actualizar pip');
ejecutar(ejecutable, ['-m', 'pip', 'install', '--quiet', '-r', requisitos], `Instalar las librerías de ${path.relative(RAIZ, requisitos)}`);
ejecutar(ejecutable, ['-m', 'taller_prediccion', '--version'], 'Verificar el modelo', CARPETA_DEL_MODELO);

console.log(`\nListo. El modelo se ejecutará con: ${origen}`);
