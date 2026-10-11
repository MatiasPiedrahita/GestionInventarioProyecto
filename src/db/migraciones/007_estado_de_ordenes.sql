-- Migración 007 · Actualización del estado de órdenes (HU-07).

-- Cada cambio de estado queda registrado: quién, cuándo y por qué.
CREATE TABLE IF NOT EXISTS historial_estados_orden (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id         INTEGER NOT NULL REFERENCES ordenes (id),
  estado_anterior  TEXT    CHECK (estado_anterior IS NULL OR estado_anterior IN ('EN_PROCESO', 'FINALIZADA', 'CANCELADA')),
  estado_nuevo     TEXT    NOT NULL CHECK (estado_nuevo IN ('EN_PROCESO', 'FINALIZADA', 'CANCELADA')),
  usuario_id       INTEGER NOT NULL REFERENCES usuarios (id),
  motivo           TEXT,
  fecha            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_historial_estados_orden ON historial_estados_orden (orden_id, id);

-- Las órdenes que ya existían reciben su historial: la creación y, si ya
-- estaban cerradas, el cierre (con la fecha de su última actualización).
INSERT INTO historial_estados_orden (orden_id, estado_anterior, estado_nuevo, usuario_id, fecha)
  SELECT id, NULL, 'EN_PROCESO', creado_por, creado_en FROM ordenes ORDER BY id;

INSERT INTO historial_estados_orden (orden_id, estado_anterior, estado_nuevo, usuario_id, motivo, fecha)
  SELECT id, 'EN_PROCESO', estado, mecanico_id, 'Estado registrado antes de existir el historial', actualizado_en
    FROM ordenes WHERE estado <> 'EN_PROCESO' ORDER BY id;

-- Al cancelar una orden, sus repuestos pueden volver al estante.
ALTER TABLE detalle_repuestos ADD COLUMN devuelto INTEGER NOT NULL DEFAULT 0 CHECK (devuelto IN (0, 1));

-- Tipos de movimiento nuevos: DEVOLUCION (repuestos que vuelven al cancelar
-- una orden) y ENTRADA (mercancía que llega del proveedor). SQLite no permite
-- cambiar un CHECK, así que la tabla se reconstruye conservando el historial.
CREATE TABLE movimientos_inventario_nueva (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  repuesto_id      INTEGER NOT NULL REFERENCES repuestos (id),
  tipo             TEXT    NOT NULL CHECK (tipo IN ('ALTA', 'AJUSTE', 'BAJA', 'CARGA_CSV', 'USO_EN_ORDEN', 'DEVOLUCION', 'ENTRADA')),
  cantidad         INTEGER NOT NULL,
  stock_resultante INTEGER NOT NULL CHECK (stock_resultante >= 0),
  detalle          TEXT,
  orden_id         INTEGER REFERENCES ordenes (id),
  fecha            TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO movimientos_inventario_nueva (id, repuesto_id, tipo, cantidad, stock_resultante, detalle, orden_id, fecha)
  SELECT id, repuesto_id, tipo, cantidad, stock_resultante, detalle, orden_id, fecha FROM movimientos_inventario;

DROP TABLE movimientos_inventario;
ALTER TABLE movimientos_inventario_nueva RENAME TO movimientos_inventario;

CREATE INDEX IF NOT EXISTS idx_mov_repuesto ON movimientos_inventario (repuesto_id, fecha);
CREATE INDEX IF NOT EXISTS idx_mov_orden ON movimientos_inventario (orden_id);
