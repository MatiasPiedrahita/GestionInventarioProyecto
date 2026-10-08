-- Migración 004 · Repuestos usados en una orden (HU Registrar repuestos usados).

CREATE TABLE IF NOT EXISTS detalle_repuestos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id        INTEGER NOT NULL REFERENCES ordenes (id),
  repuesto_id     INTEGER NOT NULL REFERENCES repuestos (id),
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario  REAL    NOT NULL CHECK (costo_unitario >= 0),
  registrado_por  INTEGER NOT NULL REFERENCES usuarios (id),
  creado_en       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_detalle_orden ON detalle_repuestos (orden_id);

-- El historial de movimientos necesita un tipo nuevo (USO_EN_ORDEN) y saber
-- de qué orden salió cada repuesto. SQLite no permite cambiar un CHECK, así
-- que la tabla se reconstruye copiando todo el historial existente.
CREATE TABLE movimientos_inventario_nueva (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  repuesto_id      INTEGER NOT NULL REFERENCES repuestos (id),
  tipo             TEXT    NOT NULL CHECK (tipo IN ('ALTA', 'AJUSTE', 'BAJA', 'CARGA_CSV', 'USO_EN_ORDEN')),
  cantidad         INTEGER NOT NULL,
  stock_resultante INTEGER NOT NULL CHECK (stock_resultante >= 0),
  detalle          TEXT,
  orden_id         INTEGER REFERENCES ordenes (id),
  fecha            TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO movimientos_inventario_nueva (id, repuesto_id, tipo, cantidad, stock_resultante, detalle, fecha)
  SELECT id, repuesto_id, tipo, cantidad, stock_resultante, detalle, fecha FROM movimientos_inventario;

DROP TABLE movimientos_inventario;
ALTER TABLE movimientos_inventario_nueva RENAME TO movimientos_inventario;

CREATE INDEX IF NOT EXISTS idx_mov_repuesto ON movimientos_inventario (repuesto_id, fecha);
CREATE INDEX IF NOT EXISTS idx_mov_orden ON movimientos_inventario (orden_id);
