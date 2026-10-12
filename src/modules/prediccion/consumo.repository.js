// Lunes de la semana de una fecha: el domingo siguiente (o el mismo día) menos seis días.
const LUNES_DE = (columna) => `date(${columna}, 'weekday 0', '-6 days')`;

/**
 * Extracción de datos para el modelo de predicción (la "tubería de datos").
 *
 * El consumo de un repuesto es lo que se registró en las órdenes y NO se
 * devolvió. Se toma del detalle de las órdenes, que equivale a los
 * movimientos USO_EN_ORDEN menos las DEVOLUCION, con una ventaja: una
 * devolución descuenta la semana en que se usó el repuesto, no la semana
 * en que se canceló la orden.
 */
function crearRepositorioConsumo(db) {
  const sentencias = {
    repuestos: db.prepare(`
      SELECT id, sku, nombre, costo, stock_actual, stock_minimo, proveedor, dias_reposicion
        FROM repuestos
       WHERE activo = 1
       ORDER BY id
    `),
    consumoSemanal: db.prepare(`
      SELECT d.repuesto_id, ${LUNES_DE('d.creado_en')} AS semana, SUM(d.cantidad) AS unidades
        FROM detalle_repuestos d
       WHERE d.devuelto = 0 AND d.creado_en >= ?
       GROUP BY d.repuesto_id, semana
       ORDER BY d.repuesto_id, semana
    `),
    consumoDeUno: db.prepare(`
      SELECT ${LUNES_DE('d.creado_en')} AS semana, SUM(d.cantidad) AS unidades
        FROM detalle_repuestos d
       WHERE d.devuelto = 0 AND d.repuesto_id = @repuestoId AND d.creado_en >= @desde
       GROUP BY semana
       ORDER BY semana
    `),
    // Cuándo entró cada repuesto al catálogo: su primer movimiento.
    primerMovimiento: db.prepare('SELECT repuesto_id, MIN(date(fecha)) AS fecha FROM movimientos_inventario GROUP BY repuesto_id'),
  };

  return {
    listarRepuestos() {
      return sentencias.repuestos.all().map((fila) => ({
        id: fila.id,
        sku: fila.sku,
        nombre: fila.nombre,
        costo: fila.costo,
        stockActual: fila.stock_actual,
        stockMinimo: fila.stock_minimo,
        proveedor: fila.proveedor,
        diasReposicion: fila.dias_reposicion,
      }));
    },
    /** @returns {Map<number, {semana: string, unidades: number}[]>} Consumo por repuesto, solo semanas con consumo. */
    consumoSemanalDesde(desde) {
      const porRepuesto = new Map();
      sentencias.consumoSemanal.all(desde).forEach(({ repuesto_id: id, semana, unidades }) => {
        if (!porRepuesto.has(id)) porRepuesto.set(id, []);
        porRepuesto.get(id).push({ semana, unidades });
      });
      return porRepuesto;
    },
    consumoSemanalDe(repuestoId, desde) {
      return sentencias.consumoDeUno.all({ repuestoId, desde }).map((fila) => ({ ...fila }));
    },
    /** @returns {Map<number, string>} Fecha (AAAA-MM-DD) del primer movimiento de cada repuesto. */
    primerMovimientoPorRepuesto() {
      return new Map(sentencias.primerMovimiento.all().map((fila) => [fila.repuesto_id, fila.fecha]));
    },
  };
}

module.exports = { crearRepositorioConsumo };
