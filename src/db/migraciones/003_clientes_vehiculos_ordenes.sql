-- Migración 003 · Clientes, vehículos y órdenes de reparación (HU Crear orden).

CREATE TABLE IF NOT EXISTS clientes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  documento   TEXT    NOT NULL UNIQUE,
  nombre      TEXT    NOT NULL,
  telefono    TEXT    NOT NULL,
  email       TEXT,
  creado_en   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehiculos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  placa       TEXT    NOT NULL UNIQUE,
  marca       TEXT    NOT NULL,
  modelo      TEXT    NOT NULL,
  anio        INTEGER CHECK (anio IS NULL OR anio BETWEEN 1950 AND 2100),
  cliente_id  INTEGER NOT NULL REFERENCES clientes (id),
  creado_en   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ordenes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id      INTEGER NOT NULL REFERENCES clientes (id),
  vehiculo_id     INTEGER NOT NULL REFERENCES vehiculos (id),
  mecanico_id     INTEGER NOT NULL REFERENCES usuarios (id),
  creado_por      INTEGER NOT NULL REFERENCES usuarios (id),
  descripcion     TEXT    NOT NULL,
  estado          TEXT    NOT NULL DEFAULT 'EN_PROCESO'
                  CHECK (estado IN ('EN_PROCESO', 'FINALIZADA', 'CANCELADA')),
  creado_en       TEXT    NOT NULL DEFAULT (datetime('now')),
  actualizado_en  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente ON vehiculos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_vehiculo  ON ordenes (vehiculo_id);
