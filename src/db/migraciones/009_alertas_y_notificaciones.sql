-- Migración 009 · Alertas de stock bajo y notificaciones (HU-08).

-- Una alerta sigue a un repuesto mientras necesite atención:
--   ACTIVA    nadie la ha atendido todavía.
--   ATENDIDA  alguien ya hizo el pedido; se espera la mercancía.
--   RESUELTA  el stock se recuperó (o el repuesto se dio de baja).
-- QUIEBRE_PROYECTADO lo genera el modelo de predicción: el stock todavía
-- está sobre el mínimo, pero no alcanza hasta que llegue un pedido.
CREATE TABLE IF NOT EXISTS alertas_stock (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  repuesto_id       INTEGER NOT NULL REFERENCES repuestos (id),
  tipo              TEXT    NOT NULL CHECK (tipo IN ('STOCK_BAJO', 'AGOTADO', 'QUIEBRE_PROYECTADO', 'FALTANTE_REPORTADO')),
  estado            TEXT    NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA', 'ATENDIDA', 'RESUELTA')),
  stock_al_generar  INTEGER NOT NULL,
  stock_minimo      INTEGER NOT NULL,
  detalle           TEXT,
  creada_por        INTEGER REFERENCES usuarios (id),
  creada_en         TEXT    NOT NULL DEFAULT (datetime('now')),
  atendida_por      INTEGER REFERENCES usuarios (id),
  atendida_en       TEXT,
  nota_de_atencion  TEXT,
  resuelta_en       TEXT
);

-- Un repuesto no puede tener dos alertas abiertas del mismo tipo: revisar
-- el inventario muchas veces nunca duplica avisos.
CREATE UNIQUE INDEX IF NOT EXISTS idx_alertas_abiertas ON alertas_stock (repuesto_id, tipo) WHERE estado <> 'RESUELTA';
CREATE INDEX IF NOT EXISTS idx_alertas_estado ON alertas_stock (estado, id);

-- Notificaciones dentro de la aplicación (la campana). Cada una es de un usuario.
CREATE TABLE IF NOT EXISTS notificaciones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios (id),
  tipo        TEXT    NOT NULL,
  titulo      TEXT    NOT NULL,
  mensaje     TEXT    NOT NULL,
  vista       TEXT,
  alerta_id   INTEGER REFERENCES alertas_stock (id),
  leida_en    TEXT,
  creada_en   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones (usuario_id, leida_en, id);

-- Bandeja de salida de correos. Sin servidor de correo configurado quedan
-- como SIMULADO (se pueden leer en Administración); con SMTP pasan de
-- PENDIENTE a ENVIADO o ERROR.
CREATE TABLE IF NOT EXISTS correos_salientes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id    INTEGER REFERENCES usuarios (id),
  destinatario  TEXT    NOT NULL,
  asunto        TEXT    NOT NULL,
  cuerpo        TEXT    NOT NULL,
  estado        TEXT    NOT NULL CHECK (estado IN ('SIMULADO', 'PENDIENTE', 'ENVIADO', 'ERROR')),
  error         TEXT,
  creado_en     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_correos_fecha ON correos_salientes (id);

-- Cada usuario decide si además quiere los avisos en su correo.
ALTER TABLE usuarios ADD COLUMN notificar_por_correo INTEGER NOT NULL DEFAULT 0 CHECK (notificar_por_correo IN (0, 1));
