const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { crearConexion } = require('../../src/db/connection');

const CARPETA = path.join(__dirname, '..', '..', 'src', 'db', 'migraciones');
const ARCHIVOS = fs.readdirSync(CARPETA).filter((a) => /^\d{3}_.+\.sql$/.test(a)).sort();
const ULTIMA_VERSION = Number(ARCHIVOS[ARCHIVOS.length - 1].slice(0, 3));

const version = (db) => db.prepare('PRAGMA user_version').get().user_version;
const tablas = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);

/** Crea un archivo de base de datos como lo dejó una versión anterior del sistema. */
function crearBaseEnVersion(ruta, hasta, preparar = () => {}) {
  const db = new DatabaseSync(ruta, { enableForeignKeyConstraints: false });
  ARCHIVOS.filter((a) => Number(a.slice(0, 3)) <= hasta).forEach((a) => db.exec(fs.readFileSync(path.join(CARPETA, a), 'utf8')));
  db.exec(`PRAGMA user_version = ${hasta};`);
  preparar(db);
  db.close();
}

describe('Migraciones del esquema (integración con archivos reales)', () => {
  let carpeta;

  beforeEach(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-migraciones-'));
  });

  afterEach(() => {
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  test('una base nueva en archivo crea la carpeta, queda en la última versión y usa WAL', () => {
    const ruta = path.join(carpeta, 'sub', 'carpeta', 'taller.db');

    const db = crearConexion(ruta);

    expect(fs.existsSync(ruta)).toBe(true);
    expect(version(db)).toBe(ULTIMA_VERSION);
    expect(db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal');
    expect(db.prepare('PRAGMA foreign_keys').get().foreign_keys).toBe(1);
    db.close();
  });

  test('volver a abrir la base no repite migraciones ni pierde datos', () => {
    const ruta = path.join(carpeta, 'taller.db');
    const primera = crearConexion(ruta);
    primera.prepare("INSERT INTO repuestos (sku, nombre, costo, stock_actual) VALUES ('A-1', 'Tornillo', 500, 10)").run();
    primera.close();

    const segunda = crearConexion(ruta);

    expect(version(segunda)).toBe(ULTIMA_VERSION);
    expect(segunda.prepare('SELECT sku, stock_actual FROM repuestos').all()).toEqual([{ sku: 'A-1', stock_actual: 10 }]);
    segunda.close();
  });

  test('una base del primer incremento (versión 1) recibe solo lo nuevo y conserva inventario e historial', () => {
    const ruta = path.join(carpeta, 'antigua.db');
    crearBaseEnVersion(ruta, 1, (db) => {
      db.exec("INSERT INTO repuestos (sku, nombre, costo, stock_actual, stock_minimo) VALUES ('FIL-1', 'Filtro', 28500, 14, 5)");
      db.exec("INSERT INTO movimientos_inventario (repuesto_id, tipo, cantidad, stock_resultante, detalle) VALUES (1, 'ALTA', 14, 14, 'Registro inicial')");
    });

    const db = crearConexion(ruta);

    expect(version(db)).toBe(ULTIMA_VERSION);
    expect(tablas(db)).toEqual(expect.arrayContaining(['usuarios', 'sesiones', 'ordenes', 'detalle_repuestos']));
    expect(db.prepare('SELECT sku, stock_actual FROM repuestos').get()).toEqual({ sku: 'FIL-1', stock_actual: 14 });
    expect(db.prepare('SELECT tipo, cantidad, detalle, orden_id FROM movimientos_inventario').all()).toEqual([
      { tipo: 'ALTA', cantidad: 14, detalle: 'Registro inicial', orden_id: null },
    ]);
    db.close();
  });

  test('una base con órdenes de la versión 6 recibe el historial de estados y conserva los movimientos de sus órdenes', () => {
    const ruta = path.join(carpeta, 'sprint2.db');
    crearBaseEnVersion(ruta, 6, (db) => {
      db.exec(`
        INSERT INTO usuarios (usuario, nombre, rol, password_hash) VALUES ('andres', 'Andrés Gómez', 'mecanico', 'x');
        INSERT INTO clientes (documento, nombre, telefono) VALUES ('1037000101', 'Camila Ortiz', '3001112233');
        INSERT INTO vehiculos (placa, marca, modelo, cliente_id) VALUES ('ABC123', 'Chevrolet', 'Spark GT', 1);
        INSERT INTO ordenes (cliente_id, vehiculo_id, mecanico_id, creado_por, descripcion, estado, creado_en, actualizado_en)
          VALUES (1, 1, 1, 1, 'Cambio de aceite', 'FINALIZADA', '2026-09-01 14:00:00', '2026-09-02 10:30:00'),
                 (1, 1, 1, 1, 'Ruido al frenar', 'EN_PROCESO', '2026-09-05 09:00:00', '2026-09-05 09:00:00');
        INSERT INTO repuestos (sku, nombre, costo, stock_actual) VALUES ('FIL-1', 'Filtro', 28500, 8);
        INSERT INTO detalle_repuestos (orden_id, repuesto_id, cantidad, costo_unitario, registrado_por) VALUES (1, 1, 2, 28500, 1);
        INSERT INTO movimientos_inventario (repuesto_id, tipo, cantidad, stock_resultante, orden_id) VALUES (1, 'USO_EN_ORDEN', -2, 8, 1);
      `);
    });

    const db = crearConexion(ruta);

    expect(version(db)).toBe(ULTIMA_VERSION);
    expect(db.prepare('SELECT orden_id, estado_anterior, estado_nuevo, fecha FROM historial_estados_orden ORDER BY orden_id, id').all()).toEqual([
      { orden_id: 1, estado_anterior: null, estado_nuevo: 'EN_PROCESO', fecha: '2026-09-01 14:00:00' },
      { orden_id: 1, estado_anterior: 'EN_PROCESO', estado_nuevo: 'FINALIZADA', fecha: '2026-09-02 10:30:00' },
      { orden_id: 2, estado_anterior: null, estado_nuevo: 'EN_PROCESO', fecha: '2026-09-05 09:00:00' },
    ]);
    expect(db.prepare('SELECT tipo, cantidad, orden_id FROM movimientos_inventario').all()).toEqual([
      { tipo: 'USO_EN_ORDEN', cantidad: -2, orden_id: 1 },
    ]);
    expect(db.prepare('SELECT devuelto FROM detalle_repuestos').get().devuelto).toBe(0);
    // Los tipos nuevos ya se aceptan en el historial de movimientos.
    expect(() => db.prepare("INSERT INTO movimientos_inventario (repuesto_id, tipo, cantidad, stock_resultante) VALUES (1, 'DEVOLUCION', 2, 10)").run()).not.toThrow();
    db.close();
  });

  test('si una migración falla, se deshace completa y la versión no avanza', () => {
    const ruta = path.join(carpeta, 'rota.db');
    // La migración 004 crea esta tabla: si ya existe, falla a mitad de camino.
    crearBaseEnVersion(ruta, 3, (db) => db.exec('CREATE TABLE movimientos_inventario_nueva (id INTEGER)'));

    expect(() => crearConexion(ruta)).toThrow(/Falló la migración 004_repuestos_usados\.sql/);

    const db = new DatabaseSync(ruta);
    expect(version(db)).toBe(3);
    expect(tablas(db)).not.toContain('detalle_repuestos');
    db.close();
  });

  test('una migración que deja llaves foráneas inválidas se rechaza', () => {
    const ruta = path.join(carpeta, 'huerfanos.db');
    crearBaseEnVersion(ruta, 3, (db) => {
      db.exec("INSERT INTO movimientos_inventario (repuesto_id, tipo, cantidad, stock_resultante) VALUES (999, 'ALTA', 1, 1)");
    });

    expect(() => crearConexion(ruta)).toThrow(/llaves foráneas inválidas/);

    const db = new DatabaseSync(ruta);
    expect(version(db)).toBe(3);
    db.close();
  });
});
