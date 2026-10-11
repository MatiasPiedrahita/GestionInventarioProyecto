/**
 * Consultas agregadas del panel del dueño. Solo lectura.
 *
 * "cierres" es la fecha en que cada orden quedó finalizada: su último paso a
 * FINALIZADA en el historial (una orden reabierta y vuelta a cerrar cuenta
 * una sola vez, con la fecha del cierre definitivo).
 */
const CIERRES = `
  WITH cierres AS (
    SELECT o.id AS orden_id, o.mecanico_id, o.creado_en, MAX(h.fecha) AS cerrada_en
      FROM ordenes o
      JOIN historial_estados_orden h ON h.orden_id = o.id AND h.estado_nuevo = 'FINALIZADA'
     WHERE o.estado = 'FINALIZADA'
     GROUP BY o.id
  )
`;

// Lunes de la semana de una fecha: el domingo siguiente (o el mismo día) menos seis días.
const LUNES_DE = (columna) => `date(${columna}, 'weekday 0', '-6 days')`;

function crearRepositorioPanel(db) {
  const sentencias = {
    inventario: db.prepare(`
      SELECT COUNT(*)                                        AS repuestos,
             COALESCE(SUM(costo * stock_actual), 0)          AS valor,
             COALESCE(SUM(stock_actual), 0)                  AS unidades,
             COALESCE(SUM(stock_actual <= stock_minimo), 0)  AS bajoMinimo,
             COALESCE(SUM(stock_actual = 0), 0)              AS agotados
        FROM repuestos
       WHERE activo = 1
    `),
    ordenesPorEstado: db.prepare('SELECT estado, COUNT(*) AS cantidad FROM ordenes GROUP BY estado'),
    finalizadasDesde: db.prepare(`${CIERRES} SELECT COUNT(*) AS cantidad FROM cierres WHERE cerrada_en >= ?`),
    creadasPorSemana: db.prepare(`
      SELECT ${LUNES_DE('creado_en')} AS semana, COUNT(*) AS cantidad
        FROM ordenes
       WHERE creado_en >= ?
       GROUP BY semana
    `),
    finalizadasPorSemana: db.prepare(`
      ${CIERRES}
      SELECT ${LUNES_DE('cerrada_en')} AS semana, COUNT(*) AS cantidad
        FROM cierres
       WHERE cerrada_en >= ?
       GROUP BY semana
    `),
    gastoPorMes: db.prepare(`
      SELECT strftime('%Y-%m', creado_en) AS mes, SUM(cantidad * costo_unitario) AS valor, SUM(cantidad) AS unidades
        FROM detalle_repuestos
       WHERE devuelto = 0 AND creado_en >= ?
       GROUP BY mes
    `),
    masUsados: db.prepare(`
      SELECT r.id, r.sku, r.nombre, SUM(d.cantidad) AS unidades, SUM(d.cantidad * d.costo_unitario) AS valor
        FROM detalle_repuestos d
        JOIN repuestos r ON r.id = d.repuesto_id
       WHERE d.devuelto = 0 AND d.creado_en >= @desde
       GROUP BY r.id
       ORDER BY unidades DESC, r.nombre COLLATE NOCASE
       LIMIT @limite
    `),
    porMecanico: db.prepare(`
      ${CIERRES}
      SELECT u.id, u.nombre, u.activo,
             (SELECT COUNT(*) FROM ordenes o WHERE o.mecanico_id = u.id AND o.estado = 'EN_PROCESO') AS enProceso,
             (SELECT COUNT(*) FROM cierres c WHERE c.mecanico_id = u.id AND c.cerrada_en >= @desde) AS finalizadas,
             (SELECT AVG((julianday(c.cerrada_en) - julianday(c.creado_en)) * 24)
                FROM cierres c WHERE c.mecanico_id = u.id AND c.cerrada_en >= @desde) AS horasPromedio
        FROM usuarios u
       WHERE u.rol = 'mecanico'
         AND (u.activo = 1 OR EXISTS (SELECT 1 FROM ordenes o WHERE o.mecanico_id = u.id AND o.estado = 'EN_PROCESO'))
       ORDER BY u.nombre COLLATE NOCASE
    `),
  };

  const filas = (sentencia, ...parametros) => sentencia.all(...parametros).map((fila) => ({ ...fila }));

  return {
    inventario: () => ({ ...sentencias.inventario.get() }),
    ordenesPorEstado: () => filas(sentencias.ordenesPorEstado),
    contarFinalizadasDesde: (desde) => sentencias.finalizadasDesde.get(desde).cantidad,
    creadasPorSemana: (desde) => filas(sentencias.creadasPorSemana, desde),
    finalizadasPorSemana: (desde) => filas(sentencias.finalizadasPorSemana, desde),
    gastoPorMes: (desde) => filas(sentencias.gastoPorMes, desde),
    masUsados: (desde, limite) => filas(sentencias.masUsados, { desde, limite }),
    porMecanico: (desde) => filas(sentencias.porMecanico, { desde }).map((fila) => ({ ...fila, activo: fila.activo === 1 })),
  };
}

module.exports = { crearRepositorioPanel };
