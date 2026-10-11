/**
 * Acceso a datos exclusivo del script de historial de demostración
 * (scripts/seed-historial.js). La aplicación no lo usa.
 *
 * El historial sintético se crea con los mismos servicios de la aplicación
 * (así respeta todas las reglas: stock, movimientos, estados) y aquí solo se
 * corrige la fecha de lo creado, para que parezca que ocurrió hace meses.
 */
function crearRepositorioHistorialDemo(db) {
  const sentencias = {
    ordenesAnterioresA: db.prepare('SELECT COUNT(*) AS n FROM ordenes WHERE creado_en < ?'),
    ultimoMovimiento: db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM movimientos_inventario'),
    fecharOrden: db.prepare('UPDATE ordenes SET creado_en = @creada, actualizado_en = @cerrada WHERE id = @id'),
    fecharDetalles: db.prepare('UPDATE detalle_repuestos SET creado_en = @creada WHERE orden_id = @id'),
    fecharUsos: db.prepare("UPDATE movimientos_inventario SET fecha = @creada WHERE orden_id = @id AND tipo = 'USO_EN_ORDEN'"),
    fecharDevoluciones: db.prepare("UPDATE movimientos_inventario SET fecha = @cerrada WHERE orden_id = @id AND tipo = 'DEVOLUCION'"),
    fecharCreacion: db.prepare('UPDATE historial_estados_orden SET fecha = @creada WHERE orden_id = @id AND estado_anterior IS NULL'),
    fecharCierre: db.prepare('UPDATE historial_estados_orden SET fecha = @cerrada WHERE orden_id = @id AND estado_anterior IS NOT NULL'),
    fecharEntradas: db.prepare('UPDATE movimientos_inventario SET fecha = @fecha WHERE id > @desdeId AND orden_id IS NULL'),
    fecharAltas: db.prepare("UPDATE movimientos_inventario SET fecha = @fecha WHERE tipo IN ('ALTA', 'CARGA_CSV') AND fecha > @fecha"),
    fecharRepuestos: db.prepare('UPDATE repuestos SET creado_en = @fecha WHERE creado_en > @fecha'),
    fecharClientes: db.prepare('UPDATE clientes SET creado_en = @fecha WHERE id = @id AND creado_en > @fecha'),
  };

  return {
    contarOrdenesAnterioresA(fecha) {
      return sentencias.ordenesAnterioresA.get(fecha).n;
    },
    ultimoMovimientoId() {
      return sentencias.ultimoMovimiento.get().id;
    },
    /** Pone en el pasado una orden completa: la orden, sus repuestos, sus movimientos y su historial de estados. */
    fecharOrden({ id, clienteId, creada, cerrada }) {
      sentencias.fecharOrden.run({ id, creada, cerrada });
      sentencias.fecharDetalles.run({ id, creada });
      sentencias.fecharUsos.run({ id, creada });
      sentencias.fecharDevoluciones.run({ id, cerrada });
      sentencias.fecharCreacion.run({ id, creada });
      sentencias.fecharCierre.run({ id, cerrada });
      sentencias.fecharClientes.run({ id: clienteId, fecha: creada });
    },
    /** Las entradas de mercancía creadas después de cierto movimiento pasan a tener esa fecha. */
    fecharEntradasDesde(desdeId, fecha) {
      sentencias.fecharEntradas.run({ desdeId, fecha });
    },
    /** El catálogo "existía" desde el comienzo del historial. */
    fecharCatalogo(fecha) {
      sentencias.fecharAltas.run({ fecha });
      sentencias.fecharRepuestos.run({ fecha });
    },
  };
}

module.exports = { crearRepositorioHistorialDemo };
