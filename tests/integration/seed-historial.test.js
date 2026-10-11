const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const RAIZ = path.join(__dirname, '..', '..');

/** Ejecuta un script del proyecto contra una base temporal, como lo haría "npm run ...". */
function ejecutar(script, rutaDb) {
  return execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(RAIZ, 'scripts', script)], {
    cwd: RAIZ,
    env: { ...process.env, DB_PATH: rutaDb, DEMO_PASSWORD: 'clave-solo-para-pruebas' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('Historial de demostración (npm run seed:historial)', () => {
  let carpeta;
  let rutaDb;
  let db;

  beforeAll(() => {
    carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-historial-'));
    rutaDb = path.join(carpeta, 'demo.db');
    ejecutar('seed.js', rutaDb);
    ejecutar('seed-historial.js', rutaDb);
    db = new DatabaseSync(rutaDb);
  }, 120000);

  afterAll(() => {
    db.close();
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  const uno = (sql, ...parametros) => db.prepare(sql).get(...parametros);

  test('genera dos años y medio de órdenes, casi todas finalizadas y unas pocas canceladas', () => {
    const { ordenes, semanas, primera } = uno(`
      SELECT COUNT(*) AS ordenes, COUNT(DISTINCT date(creado_en, 'weekday 0', '-6 days')) AS semanas, MIN(date(creado_en)) AS primera
        FROM ordenes`);
    const porEstado = Object.fromEntries(db.prepare('SELECT estado, COUNT(*) AS n FROM ordenes GROUP BY estado').all().map((f) => [f.estado, f.n]));

    expect(ordenes).toBeGreaterThan(600);
    expect(semanas).toBeGreaterThanOrEqual(132);
    expect((Date.now() - Date.parse(primera)) / (7 * 24 * 3600 * 1000)).toBeGreaterThan(130);
    expect(porEstado.FINALIZADA).toBeGreaterThan(0.9 * ordenes);
    expect(porEstado.CANCELADA).toBeGreaterThan(0);
  });

  test('agrega repuestos con patrones distintos y todos tienen consumo en el historial', () => {
    const consumidos = db.prepare(`
      SELECT r.sku, SUM(-m.cantidad) AS unidades, COUNT(DISTINCT date(m.fecha, 'weekday 0', '-6 days')) AS semanas
        FROM movimientos_inventario m JOIN repuestos r ON r.id = m.repuesto_id
       WHERE m.tipo = 'USO_EN_ORDEN'
       GROUP BY r.sku`).all();
    const porSku = Object.fromEntries(consumidos.map((c) => [c.sku, c]));

    expect(consumidos).toHaveLength(12);
    // Alta rotación: sale casi todas las semanas. Baja rotación: una de cada cinco, más o menos.
    expect(porSku['FIL-ACE-001'].semanas).toBeGreaterThan(120);
    expect(porSku['COR-DIS-006'].semanas).toBeLessThan(50);
    expect(porSku['BUJ-NGK-004'].unidades % 4).toBe(0);
  });

  test('el repuesto descontinuado deja de consumirse en la segunda mitad del historial', () => {
    const { ultima } = uno(`
      SELECT MAX(m.fecha) AS ultima FROM movimientos_inventario m JOIN repuestos r ON r.id = m.repuesto_id
       WHERE r.sku = 'REF-VER-012' AND m.tipo = 'USO_EN_ORDEN'`);

    expect((Date.now() - Date.parse(`${ultima.replace(' ', 'T')}Z`)) / (7 * 24 * 3600 * 1000)).toBeGreaterThan(40);
  });

  test('todo el historial queda en el pasado y es coherente: fechas, stock y movimientos', () => {
    const ahora = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const futuras = uno('SELECT COUNT(*) AS n FROM movimientos_inventario WHERE fecha > ?', ahora).n
      + uno('SELECT COUNT(*) AS n FROM historial_estados_orden WHERE fecha > ?', ahora).n;
    const cierresAntesDeCrear = uno(`
      SELECT COUNT(*) AS n FROM historial_estados_orden h JOIN ordenes o ON o.id = h.orden_id
       WHERE h.estado_anterior IS NOT NULL AND h.fecha < o.creado_en`).n;
    // El stock actual de cada repuesto es exactamente lo que dicen sus movimientos.
    const descuadrados = db.prepare(`
      SELECT r.sku FROM repuestos r
       WHERE r.stock_actual <> (SELECT stock_resultante FROM movimientos_inventario m WHERE m.repuesto_id = r.id ORDER BY m.id DESC LIMIT 1)`).all();

    expect(futuras).toBe(0);
    expect(cierresAntesDeCrear).toBe(0);
    expect(descuadrados).toEqual([]);
    expect(uno('SELECT MIN(stock_actual) AS minimo FROM repuestos').minimo).toBeGreaterThanOrEqual(0);
  });

  test('las devoluciones de las órdenes canceladas quedan registradas, para que el modelo las reste del consumo', () => {
    const { devoluciones } = uno("SELECT COUNT(*) AS devoluciones FROM movimientos_inventario WHERE tipo = 'DEVOLUCION'");
    const { sinDevolver } = uno(`
      SELECT COUNT(*) AS sinDevolver FROM detalle_repuestos d JOIN ordenes o ON o.id = d.orden_id
       WHERE o.estado = 'CANCELADA' AND d.devuelto = 0`);

    expect(devoluciones).toBeGreaterThan(0);
    expect(sinDevolver).toBe(0);
  });

  test('termina con algunos repuestos en su mínimo, para que haya alertas que mostrar', () => {
    const { bajos } = uno('SELECT COUNT(*) AS bajos FROM repuestos WHERE activo = 1 AND stock_actual <= stock_minimo');

    expect(bajos).toBeGreaterThanOrEqual(3);
  });

  test('es idempotente: ejecutarlo otra vez no duplica nada', () => {
    const antes = uno('SELECT COUNT(*) AS n FROM ordenes').n;

    const salida = ejecutar('seed-historial.js', rutaDb);

    expect(salida).toMatch(/Ya existe historial/);
    expect(uno('SELECT COUNT(*) AS n FROM ordenes').n).toBe(antes);
  });

  test('sin los usuarios de ejemplo se detiene con un mensaje claro en lugar de fallar a medias', () => {
    const vacia = path.join(carpeta, 'vacia.db');

    let fallo = null;
    try {
      ejecutar('seed-historial.js', vacia);
    } catch (error) {
      fallo = error;
    }

    expect(fallo.status).toBe(1);
    expect(fallo.stderr).toMatch(/Faltan los usuarios de ejemplo\. Ejecute primero: npm run seed/);
  });
});
