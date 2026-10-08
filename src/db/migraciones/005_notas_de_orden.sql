-- Migración 005 · Notas de la reparación (HU Agregar notas o detalles).

ALTER TABLE ordenes ADD COLUMN notas TEXT;
ALTER TABLE ordenes ADD COLUMN notas_actualizadas_en TEXT;
ALTER TABLE ordenes ADD COLUMN notas_actualizadas_por INTEGER REFERENCES usuarios (id);
