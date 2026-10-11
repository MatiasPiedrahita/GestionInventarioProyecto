const { NOMBRE_ESTADO } = require('./estados');

/** Columnas comunes para leer una orden con su cliente, vehículo y mecánico. */
const SELECT_ORDEN = `
  SELECT o.id, o.descripcion, o.estado, o.creado_en, o.actualizado_en,
         o.notas, o.notas_actualizadas_en, n.nombre AS notas_autor,
         o.mecanico_id, m.nombre AS mecanico_nombre,
         c.id AS cliente_id, c.documento, c.nombre AS cliente_nombre, c.telefono, c.email,
         v.id AS vehiculo_id, v.placa, v.marca, v.modelo, v.anio
    FROM ordenes o
    JOIN clientes  c ON c.id = o.cliente_id
    JOIN vehiculos v ON v.id = o.vehiculo_id
    JOIN usuarios  m ON m.id = o.mecanico_id
    LEFT JOIN usuarios n ON n.id = o.notas_actualizadas_por
`;

function aDominio(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    estado: fila.estado,
    estadoNombre: NOMBRE_ESTADO[fila.estado],
    descripcion: fila.descripcion,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
    notas: fila.notas,
    notasActualizadasEn: fila.notas_actualizadas_en,
    notasActualizadasPor: fila.notas_autor,
    mecanico: { id: fila.mecanico_id, nombre: fila.mecanico_nombre },
    cliente: {
      id: fila.cliente_id,
      documento: fila.documento,
      nombre: fila.cliente_nombre,
      telefono: fila.telefono,
      email: fila.email,
    },
    vehiculo: {
      id: fila.vehiculo_id,
      placa: fila.placa,
      marca: fila.marca,
      modelo: fila.modelo,
      anio: fila.anio,
    },
  };
}

/**
 * Acceso a datos de órdenes, clientes y vehículos.
 * Nota: node:sqlite rechaza parámetros con nombre que la consulta no usa,
 * por eso cada sentencia recibe exactamente sus campos.
 */
function crearRepositorioOrdenes(db) {
  const sentencias = {
    clientePorDocumento: db.prepare('SELECT id FROM clientes WHERE documento = ?'),
    insertarCliente: db.prepare(`
      INSERT INTO clientes (documento, nombre, telefono, email) VALUES (@documento, @nombre, @telefono, @email)
    `),
    actualizarCliente: db.prepare(`
      UPDATE clientes SET nombre = @nombre, telefono = @telefono, email = COALESCE(@email, email) WHERE id = @id
    `),
    vehiculoPorPlaca: db.prepare('SELECT id FROM vehiculos WHERE placa = ?'),
    insertarVehiculo: db.prepare(`
      INSERT INTO vehiculos (placa, marca, modelo, anio, cliente_id) VALUES (@placa, @marca, @modelo, @anio, @clienteId)
    `),
    actualizarVehiculo: db.prepare(`
      UPDATE vehiculos SET marca = @marca, modelo = @modelo, anio = COALESCE(@anio, anio), cliente_id = @clienteId WHERE id = @id
    `),
    insertarOrden: db.prepare(`
      INSERT INTO ordenes (cliente_id, vehiculo_id, mecanico_id, creado_por, descripcion)
      VALUES (@clienteId, @vehiculoId, @mecanicoId, @creadoPor, @descripcion)
    `),
    porId: db.prepare(`${SELECT_ORDEN} WHERE o.id = ?`),
    insertarDetalle: db.prepare(`
      INSERT INTO detalle_repuestos (orden_id, repuesto_id, cantidad, costo_unitario, registrado_por)
      VALUES (@ordenId, @repuestoId, @cantidad, @costoUnitario, @registradoPor)
    `),
    repuestosDeOrden: db.prepare(`
      SELECT d.id, d.repuesto_id, r.sku, r.nombre, d.cantidad, d.costo_unitario, d.devuelto, d.creado_en,
             u.nombre AS registrado_por
        FROM detalle_repuestos d
        JOIN repuestos r ON r.id = d.repuesto_id
        JOIN usuarios  u ON u.id = d.registrado_por
       WHERE d.orden_id = ?
       ORDER BY d.id
    `),
    tocarOrden: db.prepare("UPDATE ordenes SET actualizado_en = datetime('now') WHERE id = ?"),
    actualizarNotas: db.prepare(`
      UPDATE ordenes
         SET notas = @notas, notas_actualizadas_en = datetime('now'), notas_actualizadas_por = @usuarioId,
             actualizado_en = datetime('now')
       WHERE id = @id
    `),
    // La condición sobre el estado actual evita que dos personas cambien la
    // misma orden a la vez: solo el primero encuentra la fila.
    cambiarEstado: db.prepare(`
      UPDATE ordenes SET estado = @estado, actualizado_en = datetime('now') WHERE id = @id AND estado = @estadoActual
    `),
    insertarHistorial: db.prepare(`
      INSERT INTO historial_estados_orden (orden_id, estado_anterior, estado_nuevo, usuario_id, motivo)
      VALUES (@ordenId, @estadoAnterior, @estadoNuevo, @usuarioId, @motivo)
    `),
    historialDeEstados: db.prepare(`
      SELECT h.id, h.estado_anterior, h.estado_nuevo, h.motivo, h.fecha, u.nombre AS usuario
        FROM historial_estados_orden h
        JOIN usuarios u ON u.id = h.usuario_id
       WHERE h.orden_id = ?
       ORDER BY h.id
    `),
    // Lo que un mecánico quiere saber de su propio trabajo, en una sola consulta.
    resumenDeMecanico: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM ordenes WHERE mecanico_id = @id AND estado = 'EN_PROCESO') AS enProceso,
        (SELECT MIN(creado_en) FROM ordenes WHERE mecanico_id = @id AND estado = 'EN_PROCESO') AS masAntiguaDesde,
        (SELECT COUNT(*) FROM ordenes o
          WHERE o.mecanico_id = @id AND o.estado = 'FINALIZADA'
            AND (SELECT MAX(h.fecha) FROM historial_estados_orden h
                  WHERE h.orden_id = o.id AND h.estado_nuevo = 'FINALIZADA') >= @desde) AS finalizadas,
        (SELECT COALESCE(SUM(d.cantidad), 0) FROM detalle_repuestos d
           JOIN ordenes o ON o.id = d.orden_id
          WHERE o.mecanico_id = @id AND d.devuelto = 0 AND d.creado_en >= @desde) AS repuestosUsados
    `),
    cambiarMecanico: db.prepare("UPDATE ordenes SET mecanico_id = @mecanicoId, actualizado_en = datetime('now') WHERE id = @id"),
    enProcesoDeMecanico: db.prepare("SELECT COUNT(*) AS n FROM ordenes WHERE mecanico_id = ? AND estado = 'EN_PROCESO'"),
    marcarDevueltos: db.prepare('UPDATE detalle_repuestos SET devuelto = 1 WHERE orden_id = ? AND devuelto = 0'),
  };

  return {
    /** Crea el cliente o actualiza sus datos de contacto si ya existía (por documento). */
    guardarCliente(cliente) {
      const existente = sentencias.clientePorDocumento.get(cliente.documento);
      if (existente) {
        sentencias.actualizarCliente.run({
          id: existente.id,
          nombre: cliente.nombre,
          telefono: cliente.telefono,
          email: cliente.email,
        });
        return existente.id;
      }
      return Number(sentencias.insertarCliente.run(cliente).lastInsertRowid);
    },
    /** Crea el vehículo o lo actualiza (incluido su dueño actual) si ya existía (por placa). */
    guardarVehiculo(vehiculo, clienteId) {
      const existente = sentencias.vehiculoPorPlaca.get(vehiculo.placa);
      if (existente) {
        sentencias.actualizarVehiculo.run({
          id: existente.id,
          marca: vehiculo.marca,
          modelo: vehiculo.modelo,
          anio: vehiculo.anio,
          clienteId,
        });
        return existente.id;
      }
      return Number(sentencias.insertarVehiculo.run({ ...vehiculo, clienteId }).lastInsertRowid);
    },
    insertarOrden(datos) {
      return Number(sentencias.insertarOrden.run(datos).lastInsertRowid);
    },
    buscarPorId(id) {
      return aDominio(sentencias.porId.get(id));
    },
    /**
     * Listado con filtros y paginación. La consulta se arma solo con los
     * filtros presentes y siempre con parámetros (nunca concatenando valores),
     * así no hay riesgo de inyección SQL.
     */
    buscar({ placa, cliente, mecanicoId, estado, pagina, tamano }) {
      const condiciones = [];
      const parametros = {};

      if (placa) {
        condiciones.push('v.placa = @placa');
        parametros.placa = placa;
      }
      if (cliente) {
        condiciones.push('(c.nombre LIKE @clienteParcial OR c.documento = @cliente)');
        parametros.clienteParcial = `%${cliente}%`;
        parametros.cliente = cliente;
      }
      if (mecanicoId) {
        condiciones.push('o.mecanico_id = @mecanicoId');
        parametros.mecanicoId = mecanicoId;
      }
      if (estado === 'ACTIVAS') {
        condiciones.push("o.estado = 'EN_PROCESO'");
      } else if (estado === 'HISTORICAS') {
        condiciones.push("o.estado IN ('FINALIZADA', 'CANCELADA')");
      } else if (estado) {
        condiciones.push('o.estado = @estado');
        parametros.estado = estado;
      }

      const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
      const desde = `
        FROM ordenes o
        JOIN clientes  c ON c.id = o.cliente_id
        JOIN vehiculos v ON v.id = o.vehiculo_id
        ${where}`;

      const { total } = db.prepare(`SELECT COUNT(*) AS total ${desde}`).get(parametros);
      const filas = db
        .prepare(`${SELECT_ORDEN} ${where} ORDER BY o.id DESC LIMIT @limite OFFSET @desplazamiento`)
        .all({ ...parametros, limite: tamano, desplazamiento: (pagina - 1) * tamano });

      return { datos: filas.map(aDominio), total };
    },
    insertarDetalle(datos) {
      sentencias.insertarDetalle.run(datos);
      sentencias.tocarOrden.run(datos.ordenId);
    },
    actualizarNotas(id, notas, usuarioId) {
      sentencias.actualizarNotas.run({ id, notas, usuarioId });
    },
    listarRepuestosDeOrden(ordenId) {
      return sentencias.repuestosDeOrden.all(ordenId).map((fila) => ({
        id: fila.id,
        repuestoId: fila.repuesto_id,
        sku: fila.sku,
        nombre: fila.nombre,
        cantidad: fila.cantidad,
        costoUnitario: fila.costo_unitario,
        subtotal: Math.round(fila.cantidad * fila.costo_unitario * 100) / 100,
        devuelto: fila.devuelto === 1,
        registradoPor: fila.registrado_por,
        creadoEn: fila.creado_en,
      }));
    },
    /** @returns {boolean} false si la orden ya no estaba en el estado esperado. */
    cambiarEstado(id, estadoActual, estado) {
      return sentencias.cambiarEstado.run({ id, estadoActual, estado }).changes > 0;
    },
    registrarCambioDeEstado({ ordenId, estadoAnterior = null, estadoNuevo, usuarioId, motivo = null }) {
      sentencias.insertarHistorial.run({ ordenId, estadoAnterior, estadoNuevo, usuarioId, motivo });
    },
    listarHistorialDeEstados(ordenId) {
      return sentencias.historialDeEstados.all(ordenId).map((fila) => ({
        id: fila.id,
        estadoAnterior: fila.estado_anterior,
        estadoAnteriorNombre: fila.estado_anterior ? NOMBRE_ESTADO[fila.estado_anterior] : null,
        estadoNuevo: fila.estado_nuevo,
        estadoNuevoNombre: NOMBRE_ESTADO[fila.estado_nuevo],
        motivo: fila.motivo,
        usuario: fila.usuario,
        fecha: fila.fecha,
      }));
    },
    resumenDeMecanico(id, desde) {
      return { ...sentencias.resumenDeMecanico.get({ id, desde }) };
    },
    cambiarMecanico(id, mecanicoId) {
      sentencias.cambiarMecanico.run({ id, mecanicoId });
    },
    contarEnProcesoDeMecanico(mecanicoId) {
      return sentencias.enProcesoDeMecanico.get(mecanicoId).n;
    },
    marcarRepuestosDevueltos(ordenId) {
      sentencias.marcarDevueltos.run(ordenId);
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

module.exports = { crearRepositorioOrdenes };
