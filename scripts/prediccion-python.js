/**
 * Ejecuta Python dentro de la carpeta del modelo, con el mismo intérprete que usa la aplicación.
 * Uso: npm run test:python                      (corre las pruebas del modelo con pytest)
 *      node scripts/prediccion-python.js -m taller_prediccion --version
 */
const { spawnSync } = require('node:child_process');
const { resolverPython, CARPETA_DEL_MODELO } = require('../src/modules/prediccion/interprete');

const { ejecutable, origen } = resolverPython();
const resultado = spawnSync(ejecutable, process.argv.slice(2), { stdio: 'inherit', cwd: CARPETA_DEL_MODELO });

if (resultado.error) {
  console.error(`No se pudo ejecutar Python (${origen}): ${resultado.error.message}`);
  console.error('Prepare el entorno con: npm run prediccion:instalar -- --dev');
  process.exit(1);
}
process.exit(resultado.status ?? 1);
