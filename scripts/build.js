/**
 * Paso de "compilación" del pipeline. JavaScript no se compila, pero sí se
 * puede verificar que todos los archivos tengan sintaxis válida y que la
 * aplicación se pueda construir (todas sus dependencias resuelven).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..');
const CARPETAS = ['src', 'public', 'scripts'];

function archivosJs(carpeta) {
  return fs.readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) return archivosJs(ruta);
    return entrada.name.endsWith('.js') ? [ruta] : [];
  });
}

const archivos = CARPETAS.map((c) => path.join(RAIZ, c))
  .filter((carpeta) => fs.existsSync(carpeta))
  .flatMap(archivosJs);
for (const archivo of archivos) {
  execFileSync(process.execPath, ['--check', archivo], { stdio: 'inherit' });
}

const { crearApp } = require('../src/app');
crearApp();

console.log(`Build OK: ${archivos.length} archivos verificados y la aplicación se construye sin errores.`);
