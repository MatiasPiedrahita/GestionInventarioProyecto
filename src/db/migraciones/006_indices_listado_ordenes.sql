-- Migración 006 · Índices para el listado de órdenes (HU Ver listado de órdenes).
-- La placa ya tiene índice propio por ser UNIQUE (filtro por placa exacta).

CREATE INDEX IF NOT EXISTS idx_ordenes_estado        ON ordenes (estado, id);
CREATE INDEX IF NOT EXISTS idx_ordenes_mecanico      ON ordenes (mecanico_id, id);
CREATE INDEX IF NOT EXISTS idx_ordenes_cliente       ON ordenes (cliente_id);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre       ON clientes (nombre COLLATE NOCASE);
