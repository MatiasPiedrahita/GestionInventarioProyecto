const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ESQUEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

/**
 * Abre (o crea) la base de datos y aplica el esquema.
 *
 * Se usa el módulo SQLite que trae Node.js (node:sqlite, Node >= 22.13):
 * no requiere compilar nada ni instalar un motor aparte, así el proyecto
 * se levanta igual en Windows, macOS, Linux y en GitHub Actions.
 *
 * @param {string} ruta Ruta del archivo .db, o ':memory:' para pruebas.
 */
function crearConexion(ruta = ':memory:') {
  const enMemoria = ruta === ':memory:';
  if (!enMemoria) {
    fs.mkdirSync(path.dirname(ruta), { recursive: true });
  }
  const db = new DatabaseSync(ruta, { enableForeignKeyConstraints: true });
  if (!enMemoria) {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec(ESQUEMA);
  return db;
}

module.exports = { crearConexion };
