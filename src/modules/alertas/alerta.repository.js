const { NOMBRE_TIPO, NOMBRE_ESTADO_DE_ALERTA } = require('./alerta.reglas');

const SELECT_ALERTA = `
  SELECT a.*, r.sku, r.nombre, r.stock_actual, r.stock_minimo AS minimo_actual, r.proveedor, r.costo, r.activo,
         c.nombre AS creada_por_nombre, t.nombre AS atendida_por_nombre
    FROM alertas_stock a
    JOIN repuestos r ON r.id = a.repuesto_id
    LEFT JOIN usuarios c ON c.id = a.creada_por
    LEFT JOIN usuarios t ON t.id = a.atendida_por
`;

function aRepuesto(fila) {
  return {
    id: fila.id,
    sku: fila.sku,
    nombre: fila.nombre,
    stockActual: fila.stock_actual,
    stockMinimo: fila.stock_minimo,
    proveedor: fila.proveedor,
    activo: fila.activo === 1,
  };
}

function aAlerta(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    tipo: fila.tipo,
    tipoNombre: NOMBRE_TIPO[fila.tipo],
    estado: fila.estado,
    estadoNombre: NOMBRE_ESTADO_DE_ALERTA[fila.estado],
    detalle: fila.detalle,
    stockAlGenerar: fila.stock_al_generar,
    creadaEn: fila.creada_en,
    creadaPor: fila.creada_por_nombre,
    atendidaEn: fila.atendida_en,
    atendidaPor: fila.atendida_por_nombre,
    notaDeAtencion: fila.nota_de_atencion,
    resueltaEn: fila.resuelta_en,
    repuesto: {
      id: fila.repuesto_id,
      sku: fila.sku,
      nombre: fila.nombre,
      stockActual: fila.stock_actual,
      stockMinimo: fila.minimo_actual,
      proveedor: fila.proveedor,
      costo: fila.costo,
      activo: fila.activo === 1,
    },
  };
}

/** Acceso a datos de las alertas de stock. */
function crearRepositorioAlertas(db) {
  const sentencias = {
    repuestos: db.prepare('SELECT id, sku, nombre, stock_actual, stock_minimo, proveedor, activo FROM repuestos'),
    repuesto: db.prepare('SELECT id, sku, nombre, stock_actual, stock_minimo, proveedor, activo FROM repuestos WHERE id = ?'),
    abiertasDe: db.prepare("SELECT * FROM alertas_stock WHERE repuesto_id = ? AND estado <> 'RESUELTA'"),
    insertar: db.prepare(`
      INSERT INTO alertas_stock (repuesto_id, tipo, stock_al_generar, stock_minimo, detalle, creada_por)
      VALUES (@repuestoId, @tipo, @stockAlGenerar, @stockMinimo, @detalle, @creadaPor)
    `),
    cambiarTipo: db.prepare('UPDATE alertas_stock SET tipo = @tipo WHERE id = @id'),
    cambiarDetalle: db.prepare('UPDATE alertas_stock SET detalle = @detalle WHERE id = @id'),
    resolver: db.prepare("UPDATE alertas_stock SET estado = 'RESUELTA', resuelta_en = datetime('now') WHERE id = ? AND estado <> 'RESUELTA'"),
    atender: db.prepare(`
      UPDATE alertas_stock
         SET estado = 'ATENDIDA', atendida_por = @usuarioId, atendida_en = datetime('now'), nota_de_atencion = @nota
       WHERE id = @id AND estado = 'ACTIVA'
    `),
    porId: db.prepare(`${SELECT_ALERTA} WHERE a.id = ?`),
    // Primero lo más urgente: sin atender antes que atendidas, agotados antes que stock bajo.
    abiertas: db.prepare(`
      ${SELECT_ALERTA}
       WHERE a.estado <> 'RESUELTA'
       ORDER BY (a.estado = 'ATENDIDA'),
                CASE a.tipo WHEN 'AGOTADO' THEN 0 WHEN 'FALTANTE_REPORTADO' THEN 1 WHEN 'STOCK_BAJO' THEN 2 ELSE 3 END,
                a.id DESC
    `),
    resueltas: db.prepare(`${SELECT_ALERTA} WHERE a.estado = 'RESUELTA' ORDER BY a.resuelta_en DESC, a.id DESC LIMIT @limite OFFSET @desplazamiento`),
    contarResueltas: db.prepare("SELECT COUNT(*) AS n FROM alertas_stock WHERE estado = 'RESUELTA'"),
    conteo: db.prepare(`
      SELECT COALESCE(SUM(estado = 'ACTIVA'), 0)                         AS activas,
             COALESCE(SUM(estado = 'ATENDIDA'), 0)                       AS atendidas,
             COALESCE(SUM(estado <> 'RESUELTA' AND tipo = 'AGOTADO'), 0) AS agotados
        FROM alertas_stock
       WHERE estado <> 'RESUELTA'
    `),
  };

  return {
    listarRepuestos() {
      return sentencias.repuestos.all().map(aRepuesto);
    },
    buscarRepuesto(id) {
      const fila = sentencias.repuesto.get(id);
      return fila ? aRepuesto(fila) : null;
    },
    /** Alertas abiertas (activas o atendidas) de un repuesto, sin los datos del repuesto. */
    listarAbiertasDe(repuestoId) {
      return sentencias.abiertasDe.all(repuestoId).map((fila) => ({
        id: fila.id, tipo: fila.tipo, estado: fila.estado, stockAlGenerar: fila.stock_al_generar,
      }));
    },
    insertar({ repuestoId, tipo, stockAlGenerar, stockMinimo, detalle = null, creadaPor = null }) {
      return Number(sentencias.insertar.run({ repuestoId, tipo, stockAlGenerar, stockMinimo, detalle, creadaPor }).lastInsertRowid);
    },
    cambiarTipo(id, tipo) {
      sentencias.cambiarTipo.run({ id, tipo });
    },
    cambiarDetalle(id, detalle) {
      sentencias.cambiarDetalle.run({ id, detalle });
    },
    resolver(id) {
      return sentencias.resolver.run(id).changes > 0;
    },
    /** @returns {boolean} false si la alerta ya no estaba activa. */
    atender(id, usuarioId, nota) {
      return sentencias.atender.run({ id, usuarioId, nota }).changes > 0;
    },
    buscarPorId(id) {
      return aAlerta(sentencias.porId.get(id));
    },
    listarAbiertas() {
      return sentencias.abiertas.all().map(aAlerta);
    },
    listarResueltas({ pagina, tamano }) {
      return {
        total: sentencias.contarResueltas.get().n,
        datos: sentencias.resueltas.all({ limite: tamano, desplazamiento: (pagina - 1) * tamano }).map(aAlerta),
      };
    },
    contar() {
      return { ...sentencias.conteo.get() };
    },
    enTransaccion(fn) {
      db.exec('BEGIN');
      try {
        const resultado = fn();
        db.exec('COMMIT');
        return resultado;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

module.exports = { crearRepositorioAlertas };
