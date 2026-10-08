const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const CARPETA_MIGRACIONES = path.join(__dirname, 'migraciones');

/**
 * Lee las migraciones en orden (001_..., 002_...). Cada archivo .sql es un
 * paso del esquema; el número de la última aplicada se guarda en
 * PRAGMA user_version, así una base existente solo recibe lo nuevo.
 */
function leerMigraciones() {
  return fs
    .readdirSync(CARPETA_MIGRACIONES)
    .filter((archivo) => /^\d{3}_.+\.sql$/.test(archivo))
    .sort()
    .map((archivo) => ({
      version: Number(archivo.slice(0, 3)),
      archivo,
      sql: fs.readFileSync(path.join(CARPETA_MIGRACIONES, archivo), 'utf8'),
    }));
}

function aplicarMigraciones(db) {
  const actual = db.prepare('PRAGMA user_version').get().user_version;
  const pendientes = leerMigraciones().filter((m) => m.version > actual);

  for (const migracion of pendientes) {
    // Algunas migraciones reconstruyen tablas: las llaves foráneas se
    // desactivan durante el paso y se verifican al final.
    db.exec('PRAGMA foreign_keys = OFF;');
    db.exec('BEGIN');
    try {
      db.exec(migracion.sql);
      const violaciones = db.prepare('PRAGMA foreign_key_check').all();
      if (violaciones.length > 0) {
        throw new Error(`La migración ${migracion.archivo} deja llaves foráneas inválidas`);
      }
      db.exec(`PRAGMA user_version = ${migracion.version};`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Falló la migración ${migracion.archivo}: ${error.message}`);
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  }
}

/**
 * Abre (o crea) la base de datos y la deja en la última versión del esquema.
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
  aplicarMigraciones(db);
  return db;
}

module.exports = { crearConexion };
