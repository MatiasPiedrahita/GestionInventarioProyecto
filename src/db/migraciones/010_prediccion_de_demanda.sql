-- Migración 010 · Predicción de demanda (HU-09).

-- Cuántos días tarda en llegar un pedido de cada repuesto. El modelo lo usa
-- para saber si lo que hay alcanza hasta la próxima reposición.
ALTER TABLE repuestos ADD COLUMN dias_reposicion INTEGER NOT NULL DEFAULT 7 CHECK (dias_reposicion BETWEEN 1 AND 180);

-- Cada vez que corre el modelo queda una ejecución: quién la lanzó, con qué
-- parámetros, cuánto tardó, con qué versión del modelo y si terminó bien.
CREATE TABLE IF NOT EXISTS ejecuciones_prediccion (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  estado             TEXT    NOT NULL DEFAULT 'EN_CURSO' CHECK (estado IN ('EN_CURSO', 'COMPLETADA', 'FALLIDA')),
  origen             TEXT    NOT NULL CHECK (origen IN ('MANUAL', 'PROGRAMADA')),
  iniciada_por       INTEGER REFERENCES usuarios (id),
  iniciada_en        TEXT    NOT NULL DEFAULT (datetime('now')),
  finalizada_en      TEXT,
  fecha_de_corte     TEXT    NOT NULL,
  horizonte_semanas  INTEGER NOT NULL,
  nivel_de_servicio  REAL    NOT NULL,
  repuestos          INTEGER NOT NULL DEFAULT 0,
  duracion_ms        INTEGER,
  motor              TEXT,   -- JSON: versión del paquete, de Python y de las librerías
  resumen            TEXT,   -- JSON: totales del catálogo que devuelve el modelo
  error              TEXT
);

CREATE INDEX IF NOT EXISTS idx_ejecuciones_estado ON ejecuciones_prediccion (estado, id);

-- El resultado del modelo para cada repuesto en una ejecución.
CREATE TABLE IF NOT EXISTS predicciones_demanda (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  ejecucion_id              INTEGER NOT NULL REFERENCES ejecuciones_prediccion (id),
  repuesto_id               INTEGER NOT NULL REFERENCES repuestos (id),
  patron                    TEXT    NOT NULL,
  patron_descripcion        TEXT,
  adi                       REAL,
  cv2                       REAL,
  modelo                    TEXT    NOT NULL,
  modelo_nombre             TEXT,
  rmsse                     REAL,
  wape                      REAL,
  sesgo                     REAL,
  mejora_sobre_ingenuo      REAL,
  semanas_de_prueba         INTEGER NOT NULL DEFAULT 0,
  comparados                TEXT,   -- JSON: el resultado de cada modelo candidato
  semanas_de_historia       INTEGER NOT NULL DEFAULT 0,
  semanas_sin_consumo       INTEGER,
  consumo_ultimo_anio       REAL    NOT NULL DEFAULT 0,
  valor_consumo_anual       REAL    NOT NULL DEFAULT 0,
  clase_abc                 TEXT,
  tendencia                 TEXT,
  variacion_trimestral      REAL,
  error_semanal             REAL    NOT NULL DEFAULT 0,
  demanda_total             REAL    NOT NULL DEFAULT 0,
  demanda_diaria            REAL    NOT NULL DEFAULT 0,
  demanda_en_reposicion     REAL    NOT NULL DEFAULT 0,
  stock_de_seguridad        INTEGER NOT NULL DEFAULT 0,
  punto_de_reorden          INTEGER NOT NULL DEFAULT 0,
  cantidad_sugerida         INTEGER NOT NULL DEFAULT 0,
  debe_pedir                INTEGER NOT NULL DEFAULT 0 CHECK (debe_pedir IN (0, 1)),
  dias_de_cobertura         REAL,
  fecha_de_quiebre          TEXT,
  quiebre_antes_de_reponer  INTEGER NOT NULL DEFAULT 0 CHECK (quiebre_antes_de_reponer IN (0, 1)),
  stock_al_calcular         INTEGER NOT NULL,
  dias_reposicion           INTEGER NOT NULL,
  aviso                     TEXT,
  UNIQUE (ejecucion_id, repuesto_id)
);

CREATE INDEX IF NOT EXISTS idx_predicciones_repuesto ON predicciones_demanda (repuesto_id, ejecucion_id);

-- El pronóstico semana a semana, con su intervalo.
CREATE TABLE IF NOT EXISTS predicciones_puntos (
  prediccion_id  INTEGER NOT NULL REFERENCES predicciones_demanda (id),
  semana         TEXT    NOT NULL,
  unidades       REAL    NOT NULL,
  inferior       REAL    NOT NULL,
  superior       REAL    NOT NULL,
  PRIMARY KEY (prediccion_id, semana)
);
