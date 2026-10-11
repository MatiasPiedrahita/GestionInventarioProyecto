-- Migración 008 · Seguridad de las cuentas y registro de auditoría.

-- Correo del usuario (para las notificaciones del Sprint 3) y control de
-- intentos fallidos de inicio de sesión.
ALTER TABLE usuarios ADD COLUMN email TEXT;
ALTER TABLE usuarios ADD COLUMN intentos_fallidos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usuarios ADD COLUMN bloqueado_hasta TEXT;
-- Cuando un administrador asigna una contraseña temporal, el usuario debe
-- cambiarla antes de poder usar el sistema.
ALTER TABLE usuarios ADD COLUMN debe_cambiar_password INTEGER NOT NULL DEFAULT 0 CHECK (debe_cambiar_password IN (0, 1));
ALTER TABLE usuarios ADD COLUMN password_actualizada_en TEXT;

-- Auditoría: quién hizo qué y cuándo en las acciones sensibles. Nunca se
-- borra ni se edita. usuario_id es NULL cuando el intento de inicio de
-- sesión fue con un usuario que no existe.
CREATE TABLE IF NOT EXISTS auditoria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER REFERENCES usuarios (id),
  accion      TEXT    NOT NULL,
  entidad     TEXT,
  entidad_id  INTEGER,
  detalle     TEXT,
  ip          TEXT,
  fecha       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria (usuario_id, id);
CREATE INDEX IF NOT EXISTS idx_auditoria_accion  ON auditoria (accion, id);
