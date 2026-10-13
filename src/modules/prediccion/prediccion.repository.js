const EJECUCIONES_QUE_SE_CONSERVAN = 12;

const leerJson = (texto) => {
  if (!texto) return null;
  try { return JSON.parse(texto); } catch { return null; }
};

function aEjecucion(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    estado: fila.estado,
    origen: fila.origen,
    iniciadaPor: fila.iniciada_por_nombre || null,
    iniciadaEn: fila.iniciada_en,
    finalizadaEn: fila.finalizada_en,
    fechaDeCorte: fila.fecha_de_corte,
    horizonteSemanas: fila.horizonte_semanas,
    nivelDeServicio: fila.nivel_de_servicio,
    repuestos: fila.repuestos,
    duracionMs: fila.duracion_ms,
    motor: leerJson(fila.motor),
    resumen: leerJson(fila.resumen),
    error: fila.error,
  };
}

function aPrediccion(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    ejecucionId: fila.ejecucion_id,
    repuesto: {
      id: fila.repuesto_id,
      sku: fila.sku,
      nombre: fila.nombre,
      proveedor: fila.proveedor,
      costo: fila.costo,
      stockActual: fila.stock_actual,
      stockMinimo: fila.stock_minimo,
      diasReposicion: fila.dias_reposicion_actual,
      activo: fila.activo === 1,
    },
    patron: fila.patron,
    patronDescripcion: fila.patron_descripcion,
    adi: fila.adi,
    cv2: fila.cv2,
    modelo: fila.modelo,
    modeloNombre: fila.modelo_nombre,
    metricas: {
      rmsse: fila.rmsse,
      wape: fila.wape,
      sesgo: fila.sesgo,
      mejoraSobreIngenuo: fila.mejora_sobre_ingenuo,
      semanasDePrueba: fila.semanas_de_prueba,
    },
    comparados: leerJson(fila.comparados) || [],
    historia: {
      semanas: fila.semanas_de_historia,
      semanasSinConsumo: fila.semanas_sin_consumo,
      consumoUltimoAnio: fila.consumo_ultimo_anio,
    },
    valorConsumoAnual: fila.valor_consumo_anual,
    claseAbc: fila.clase_abc,
    tendencia: fila.tendencia,
    variacionTrimestral: fila.variacion_trimestral,
    errorSemanal: fila.error_semanal,
    demandaTotal: fila.demanda_total,
    demandaDiaria: fila.demanda_diaria,
    demandaEnReposicion: fila.demanda_en_reposicion,
    stockDeSeguridad: fila.stock_de_seguridad,
    puntoDeReorden: fila.punto_de_reorden,
    cantidadSugerida: fila.cantidad_sugerida,
    debePedir: fila.debe_pedir === 1,
    diasDeCobertura: fila.dias_de_cobertura,
    fechaDeQuiebre: fila.fecha_de_quiebre,
    quiebreAntesDeReponer: fila.quiebre_antes_de_reponer === 1,
    stockAlCalcular: fila.stock_al_calcular,
    diasReposicion: fila.dias_reposicion,
    aviso: fila.aviso,
  };
}

const SELECT_EJECUCION = `
  SELECT e.*, u.nombre AS iniciada_por_nombre
    FROM ejecuciones_prediccion e
    LEFT JOIN usuarios u ON u.id = e.iniciada_por
`;

const SELECT_PREDICCION = `
  SELECT p.*, r.sku, r.nombre, r.proveedor, r.costo, r.stock_actual, r.stock_minimo, r.activo,
         r.dias_reposicion AS dias_reposicion_actual
    FROM predicciones_demanda p
    JOIN repuestos r ON r.id = p.repuesto_id
`;

/** Acceso a datos de las ejecuciones del modelo y de sus resultados. */
function crearRepositorioPrediccion(db) {
  const sentencias = {
    crearEjecucion: db.prepare(`
      INSERT INTO ejecuciones_prediccion (origen, iniciada_por, fecha_de_corte, horizonte_semanas, nivel_de_servicio, repuestos)
      VALUES (@origen, @iniciadaPor, @fechaDeCorte, @horizonteSemanas, @nivelDeServicio, @repuestos)
    `),
    completar: db.prepare(`
      UPDATE ejecuciones_prediccion
         SET estado = 'COMPLETADA', finalizada_en = datetime('now'), duracion_ms = @duracionMs, motor = @motor, resumen = @resumen
       WHERE id = @id AND estado = 'EN_CURSO'
    `),
    fallar: db.prepare(`
      UPDATE ejecuciones_prediccion
         SET estado = 'FALLIDA', finalizada_en = datetime('now'), duracion_ms = @duracionMs, error = @error
       WHERE id = @id AND estado = 'EN_CURSO'
    `),
    // Una ejecución que quedó "en curso" porque el servidor se apagó a mitad no debe bloquear las siguientes.
    abandonar: db.prepare(`
      UPDATE ejecuciones_prediccion
         SET estado = 'FALLIDA', finalizada_en = datetime('now'), error = 'La ejecución se interrumpió antes de terminar'
       WHERE estado = 'EN_CURSO' AND iniciada_en < ?
    `),
    porId: db.prepare(`${SELECT_EJECUCION} WHERE e.id = ?`),
    enCurso: db.prepare(`${SELECT_EJECUCION} WHERE e.estado = 'EN_CURSO' ORDER BY e.id DESC LIMIT 1`),
    ultima: db.prepare(`${SELECT_EJECUCION} ORDER BY e.id DESC LIMIT 1`),
    ultimaCompletada: db.prepare(`${SELECT_EJECUCION} WHERE e.estado = 'COMPLETADA' ORDER BY e.id DESC LIMIT 1`),
    recientes: db.prepare(`${SELECT_EJECUCION} ORDER BY e.id DESC LIMIT ?`),
    insertarPrediccion: db.prepare(`
      INSERT INTO predicciones_demanda (
        ejecucion_id, repuesto_id, patron, patron_descripcion, adi, cv2, modelo, modelo_nombre, rmsse, wape, sesgo,
        mejora_sobre_ingenuo, semanas_de_prueba, comparados, semanas_de_historia, semanas_sin_consumo, consumo_ultimo_anio,
        valor_consumo_anual, clase_abc, tendencia, variacion_trimestral, error_semanal, demanda_total, demanda_diaria,
        demanda_en_reposicion, stock_de_seguridad, punto_de_reorden, cantidad_sugerida, debe_pedir, dias_de_cobertura,
        fecha_de_quiebre, quiebre_antes_de_reponer, stock_al_calcular, dias_reposicion, aviso
      ) VALUES (
        @ejecucionId, @repuestoId, @patron, @patronDescripcion, @adi, @cv2, @modelo, @modeloNombre, @rmsse, @wape, @sesgo,
        @mejoraSobreIngenuo, @semanasDePrueba, @comparados, @semanasDeHistoria, @semanasSinConsumo, @consumoUltimoAnio,
        @valorConsumoAnual, @claseAbc, @tendencia, @variacionTrimestral, @errorSemanal, @demandaTotal, @demandaDiaria,
        @demandaEnReposicion, @stockDeSeguridad, @puntoDeReorden, @cantidadSugerida, @debePedir, @diasDeCobertura,
        @fechaDeQuiebre, @quiebreAntesDeReponer, @stockAlCalcular, @diasReposicion, @aviso
      )
    `),
    insertarPunto: db.prepare(`
      INSERT INTO predicciones_puntos (prediccion_id, semana, unidades, inferior, superior)
      VALUES (@prediccionId, @semana, @unidades, @inferior, @superior)
    `),
    deEjecucion: db.prepare(`${SELECT_PREDICCION} WHERE p.ejecucion_id = ? ORDER BY r.nombre COLLATE NOCASE`),
    deRepuesto: db.prepare(`${SELECT_PREDICCION} WHERE p.ejecucion_id = @ejecucionId AND p.repuesto_id = @repuestoId`),
    puntos: db.prepare('SELECT semana, unidades, inferior, superior FROM predicciones_puntos WHERE prediccion_id = ? ORDER BY semana'),
    puntosDeEjecucion: db.prepare(`
      SELECT t.prediccion_id, t.semana, t.unidades
        FROM predicciones_puntos t
        JOIN predicciones_demanda p ON p.id = t.prediccion_id
       WHERE p.ejecucion_id = ?
       ORDER BY t.prediccion_id, t.semana
    `),
    // Repuestos activos que la ejecución no cubre: se crearon después, o cambió su tiempo de reposición.
    pendientes: db.prepare(`
      SELECT COUNT(*) AS total
        FROM repuestos r
        LEFT JOIN predicciones_demanda p ON p.repuesto_id = r.id AND p.ejecucion_id = ?
       WHERE r.activo = 1 AND (p.id IS NULL OR p.dias_reposicion <> r.dias_reposicion)
    `),
    antiguas: db.prepare('SELECT id FROM ejecuciones_prediccion ORDER BY id DESC LIMIT -1 OFFSET ?'),
    borrarPuntos: db.prepare('DELETE FROM predicciones_puntos WHERE prediccion_id IN (SELECT id FROM predicciones_demanda WHERE ejecucion_id = ?)'),
    borrarPredicciones: db.prepare('DELETE FROM predicciones_demanda WHERE ejecucion_id = ?'),
    borrarEjecucion: db.prepare('DELETE FROM ejecuciones_prediccion WHERE id = ?'),
  };

  const nulo = (valor) => (valor === undefined ? null : valor);

  return {
    crearEjecucion({ origen, iniciadaPor, fechaDeCorte, horizonteSemanas, nivelDeServicio, repuestos }) {
      const fila = { origen, iniciadaPor: nulo(iniciadaPor), fechaDeCorte, horizonteSemanas, nivelDeServicio, repuestos };
      return Number(sentencias.crearEjecucion.run(fila).lastInsertRowid);
    },
    completarEjecucion(id, { duracionMs, motor, resumen }) {
      sentencias.completar.run({ id, duracionMs, motor: JSON.stringify(motor || null), resumen: JSON.stringify(resumen || null) });
    },
    fallarEjecucion(id, { duracionMs, error }) {
      sentencias.fallar.run({ id, duracionMs, error: String(error).slice(0, 500) });
    },
    abandonarEjecucionesAnterioresA(fecha) {
      return Number(sentencias.abandonar.run(fecha).changes);
    },
    buscarEjecucion(id) {
      return aEjecucion(sentencias.porId.get(id));
    },
    ejecucionEnCurso() {
      return aEjecucion(sentencias.enCurso.get());
    },
    ultimaEjecucion() {
      return aEjecucion(sentencias.ultima.get());
    },
    ultimaEjecucionCompletada() {
      return aEjecucion(sentencias.ultimaCompletada.get());
    },
    listarEjecuciones(limite) {
      return sentencias.recientes.all(limite).map(aEjecucion);
    },

    /** Guarda el resultado de un repuesto con su pronóstico semana a semana. */
    guardarPrediccion(ejecucionId, { stockAlCalcular, diasReposicion }, r) {
      const prediccionId = Number(sentencias.insertarPrediccion.run({
        ejecucionId,
        repuestoId: r.id,
        patron: r.patron,
        patronDescripcion: nulo(r.patronDescripcion),
        adi: nulo(r.adi),
        cv2: nulo(r.cv2),
        modelo: r.modelo,
        modeloNombre: nulo(r.modeloNombre),
        rmsse: nulo(r.metricas.rmsse),
        wape: nulo(r.metricas.wape),
        sesgo: nulo(r.metricas.sesgo),
        mejoraSobreIngenuo: nulo(r.metricas.mejoraSobreIngenuo),
        semanasDePrueba: r.metricas.semanasDePrueba || 0,
        comparados: JSON.stringify(r.comparados || []),
        semanasDeHistoria: r.historia.semanas,
        semanasSinConsumo: nulo(r.historia.semanasSinConsumo),
        consumoUltimoAnio: r.historia.consumoUltimoAnio || 0,
        valorConsumoAnual: r.valorConsumoAnual || 0,
        claseAbc: nulo(r.claseAbc),
        tendencia: nulo(r.tendencia),
        variacionTrimestral: nulo(r.variacionTrimestral),
        errorSemanal: r.errorSemanal || 0,
        demandaTotal: r.demandaTotal || 0,
        demandaDiaria: r.demandaDiaria || 0,
        demandaEnReposicion: r.demandaEnReposicion || 0,
        stockDeSeguridad: r.stockDeSeguridad || 0,
        puntoDeReorden: r.puntoDeReorden || 0,
        cantidadSugerida: r.cantidadSugerida || 0,
        debePedir: r.debePedir ? 1 : 0,
        diasDeCobertura: nulo(r.diasDeCobertura),
        fechaDeQuiebre: nulo(r.fechaDeQuiebre),
        quiebreAntesDeReponer: r.quiebreAntesDeReponer ? 1 : 0,
        stockAlCalcular,
        diasReposicion,
        aviso: nulo(r.aviso),
      }).lastInsertRowid);
      (r.pronostico || []).forEach(({ semana, unidades, inferior, superior }) => {
        sentencias.insertarPunto.run({ prediccionId, semana, unidades, inferior, superior });
      });
      return prediccionId;
    },

    listarPredicciones(ejecucionId) {
      return sentencias.deEjecucion.all(ejecucionId).map(aPrediccion);
    },
    buscarPrediccion(ejecucionId, repuestoId) {
      const prediccion = aPrediccion(sentencias.deRepuesto.get({ ejecucionId, repuestoId }));
      if (!prediccion) return null;
      return { ...prediccion, pronostico: sentencias.puntos.all(prediccion.id).map((fila) => ({ ...fila })) };
    },

    /** @returns {Map<number, {semana: string, unidades: number}[]>} El pronóstico semanal de cada predicción de la ejecución. */
    listarPuntos(ejecucionId) {
      const porPrediccion = new Map();
      sentencias.puntosDeEjecucion.all(ejecucionId).forEach(({ prediccion_id: id, semana, unidades }) => {
        if (!porPrediccion.has(id)) porPrediccion.set(id, []);
        porPrediccion.get(id).push({ semana, unidades });
      });
      return porPrediccion;
    },
    /** Cuántos repuestos activos necesitan que el modelo se ejecute de nuevo. */
    contarPendientes(ejecucionId) {
      return sentencias.pendientes.get(ejecucionId).total;
    },

    /** Conserva solo las ejecuciones más recientes: el detalle de las antiguas ya no se consulta. */
    depurar() {
      sentencias.antiguas.all(EJECUCIONES_QUE_SE_CONSERVAN).forEach(({ id }) => {
        sentencias.borrarPuntos.run(id);
        sentencias.borrarPredicciones.run(id);
        sentencias.borrarEjecucion.run(id);
      });
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

module.exports = { crearRepositorioPrediccion, EJECUCIONES_QUE_SE_CONSERVAN };
