-- Migración 002 · Usuarios con rol y sesiones (HU Iniciar sesión).

CREATE TABLE IF NOT EXISTS usuarios (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  nombre         TEXT    NOT NULL,
  rol            TEXT    NOT NULL CHECK (rol IN ('dueno', 'mecanico', 'recepcionista', 'administrador')),
  password_hash  TEXT    NOT NULL,
  activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Solo se guarda el hash SHA-256 del token: si alguien copiara la base de
-- datos, no podría usar las sesiones abiertas.
CREATE TABLE IF NOT EXISTS sesiones (
  token_hash  TEXT    PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios (id),
  expira_en   TEXT    NOT NULL,
  creado_en   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones (usuario_id);
