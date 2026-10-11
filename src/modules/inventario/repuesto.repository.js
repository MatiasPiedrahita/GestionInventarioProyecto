/**
 * Capa de acceso a datos. Es la única que conoce SQL; si más adelante se
 * migra a PostgreSQL, solo cambia este archivo y db/connection.js.
 */

function aDominio(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    sku: fila.sku,
    nombre: fila.nombre,
    costo: fila.costo,
    stockActual: fila.stock_actual,
    stockMinimo: fila.stock_minimo,
    diasReposicion: fila.dias_reposicion,
    proveedor: fila.proveedor,
    ubicacion: fila.ubicacion,
    activo: fila.activo === 1,
    bajoStock: fila.stock_actual <= fila.stock_minimo,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

function crearRepositorioRepuestos(db) {
  const sentencias = {
    insertar: db.prepare(`
      INSERT INTO repuestos (sku, nombre, costo, stock_actual, stock_minimo, dias_reposicion, proveedor, ubicacion)
      VALUES (@sku, @nombre, @costo, @stockActual, @stockMinimo, @diasReposicion, @proveedor, @ubicacion)
    `),
    actualizar: db.prepare(`
      UPDATE repuestos
         SET sku = @sku, nombre = @nombre, costo = @costo, stock_actual = @stockActual,
             stock_minimo = @stockMinimo, dias_reposicion = @diasReposicion, proveedor = @proveedor, ubicacion = @ubicacion,
             actualizado_en = datetime('now')
       WHERE id = @id AND activo = 1
    `),
    cambiarMinimo: db.prepare(`
      UPDATE repuestos SET stock_minimo = @minimo, actualizado_en = datetime('now') WHERE id = @id AND activo = 1
    `),
    darDeBaja: db.prepare(`
      UPDATE repuestos SET activo = 0, actualizado_en = datetime('now') WHERE id = ? AND activo = 1
    `),
    porId: db.prepare('SELECT * FROM repuestos WHERE id = ? AND activo = 1'),
    porSku: db.prepare('SELECT * FROM repuestos WHERE sku = ?'),
    listar: db.prepare(`
      SELECT * FROM repuestos
       WHERE activo = 1
         AND (@busqueda IS NULL OR sku LIKE @busqueda OR nombre LIKE @busqueda OR proveedor LIKE @busqueda)
         AND (@soloBajoStock = 0 OR stock_actual <= stock_minimo)
       ORDER BY nombre COLLATE NOCASE
    `),
    insertarMovimiento: db.prepare(`
      INSERT INTO movimientos_inventario (repuesto_id, tipo, cantidad, stock_resultante, detalle, orden_id)
      VALUES (@repuestoId, @tipo, @cantidad, @stockResultante, @detalle, @ordenId)
    `),
    descontar: db.prepare(`
      UPDATE repuestos
         SET stock_actual = stock_actual - @cantidad, actualizado_en = datetime('now')
       WHERE id = @id AND activo = 1 AND stock_actual >= @cantidad
    `),
    // Sin filtrar por "activo": si el repuesto se dio de baja, la pieza igual vuelve al estante.
    sumar: db.prepare(`
      UPDATE repuestos
         SET stock_actual = stock_actual + @cantidad, actualizado_en = datetime('now')
       WHERE id = @id
      RETURNING stock_actual
    `),
    movimientosDe: db.prepare(`
      SELECT id, tipo, cantidad, stock_resultante AS "stockResultante", detalle, orden_id AS "ordenId", fecha
        FROM movimientos_inventario
       WHERE repuesto_id = ?
       ORDER BY id DESC
    `),
  };

  const conDefaults = (datos) => ({
    proveedor: null,
    ubicacion: null,
    diasReposicion: 7,
    ...datos,
  });

  return {
    insertar(datos) {
      const { lastInsertRowid } = sentencias.insertar.run(conDefaults(datos));
      return Number(lastInsertRowid);
    },
    actualizar(id, datos) {
      return sentencias.actualizar.run({ ...conDefaults(datos), id }).changes > 0;
    },
    cambiarMinimo(id, minimo) {
      return sentencias.cambiarMinimo.run({ id, minimo }).changes > 0;
    },
    darDeBaja(id) {
      return sentencias.darDeBaja.run(id).changes > 0;
    },
    buscarPorId(id) {
      return aDominio(sentencias.porId.get(id));
    },
    buscarPorSku(sku) {
      return aDominio(sentencias.porSku.get(sku));
    },
    listar({ busqueda = null, soloBajoStock = false } = {}) {
      return sentencias.listar
        .all({ busqueda: busqueda ? `%${busqueda}%` : null, soloBajoStock: soloBajoStock ? 1 : 0 })
        .map(aDominio);
    },
    registrarMovimiento(movimiento) {
      sentencias.insertarMovimiento.run({ detalle: null, ordenId: null, ...movimiento });
    },
    /**
     * Resta unidades solo si alcanza el stock (la condición va en el mismo
     * UPDATE, así dos registros simultáneos no pueden dejarlo negativo).
     * @returns {boolean} false si no había stock suficiente.
     */
    descontarStock(id, cantidad) {
      return sentencias.descontar.run({ id, cantidad }).changes > 0;
    },
    /**
     * Suma unidades al stock (devoluciones y entradas de mercancía).
     * @returns {number|null} El stock resultante, o null si el repuesto no existe.
     */
    sumarStock(id, cantidad) {
      const fila = sentencias.sumar.get({ id, cantidad });
      return fila ? fila.stock_actual : null;
    },
    listarMovimientos(repuestoId) {
      return sentencias.movimientosDe.all(repuestoId).map((fila) => ({ ...fila }));
    },
    /** Ejecuta fn dentro de una transacción: si algo falla, no se guarda nada. */
    enTransaccion(fn) {
      db.exec('BEGIN');
      try {
        const resultado = fn();
        db.exec('COMMIT');
        return resultado;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

module.exports = { crearRepositorioRepuestos };
