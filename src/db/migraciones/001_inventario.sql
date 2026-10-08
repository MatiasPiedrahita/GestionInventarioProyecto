-- Migración 001 · Inventario de repuestos (HU Gestión de inventario).
-- Las restricciones CHECK son una segunda línea de defensa: la validación
-- principal ocurre en la capa de lógica (repuesto.validator.js).

CREATE TABLE IF NOT EXISTS repuestos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sku             TEXT    NOT NULL UNIQUE,
  nombre          TEXT    NOT NULL,
  costo           REAL    NOT NULL CHECK (costo >= 0),
  stock_actual    INTEGER NOT NULL CHECK (stock_actual >= 0),
  stock_minimo    INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  proveedor       TEXT,
  ubicacion       TEXT,
  activo          INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en       TEXT    NOT NULL DEFAULT (datetime('now')),
  actualizado_en  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Historial de movimientos: es la materia prima del futuro módulo de
-- predicción de demanda, por eso nunca se borra (las bajas son lógicas).
CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  repuesto_id      INTEGER NOT NULL REFERENCES repuestos (id),
  tipo             TEXT    NOT NULL CHECK (tipo IN ('ALTA', 'AJUSTE', 'BAJA', 'CARGA_CSV')),
  cantidad         INTEGER NOT NULL,
  stock_resultante INTEGER NOT NULL CHECK (stock_resultante >= 0),
  detalle          TEXT,
  fecha            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mov_repuesto ON movimientos_inventario (repuesto_id, fecha);
