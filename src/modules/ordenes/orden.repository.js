const { NOMBRE_ESTADO } = require('./estados');

/** Columnas comunes para leer una orden con su cliente, vehículo y mecánico. */
const SELECT_ORDEN = `
  SELECT o.id, o.descripcion, o.estado, o.creado_en, o.actualizado_en,
         o.mecanico_id, m.nombre AS mecanico_nombre,
         c.id AS cliente_id, c.documento, c.nombre AS cliente_nombre, c.telefono, c.email,
         v.id AS vehiculo_id, v.placa, v.marca, v.modelo, v.anio
    FROM ordenes o
    JOIN clientes  c ON c.id = o.cliente_id
    JOIN vehiculos v ON v.id = o.vehiculo_id
    JOIN usuarios  m ON m.id = o.mecanico_id
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
    listarTodas: db.prepare(`${SELECT_ORDEN} ORDER BY o.id DESC LIMIT 200`),
    listarDeMecanico: db.prepare(`${SELECT_ORDEN} WHERE o.mecanico_id = ? ORDER BY o.id DESC LIMIT 200`),
    insertarDetalle: db.prepare(`
      INSERT INTO detalle_repuestos (orden_id, repuesto_id, cantidad, costo_unitario, registrado_por)
      VALUES (@ordenId, @repuestoId, @cantidad, @costoUnitario, @registradoPor)
    `),
    repuestosDeOrden: db.prepare(`
      SELECT d.id, d.repuesto_id, r.sku, r.nombre, d.cantidad, d.costo_unitario, d.creado_en, u.nombre AS registrado_por
        FROM detalle_repuestos d
        JOIN repuestos r ON r.id = d.repuesto_id
        JOIN usuarios  u ON u.id = d.registrado_por
       WHERE d.orden_id = ?
       ORDER BY d.id
    `),
    tocarOrden: db.prepare("UPDATE ordenes SET actualizado_en = datetime('now') WHERE id = ?"),
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
    listar({ mecanicoId = null } = {}) {
      const filas = mecanicoId ? sentencias.listarDeMecanico.all(mecanicoId) : sentencias.listarTodas.all();
      return filas.map(aDominio);
    },
    insertarDetalle(datos) {
      sentencias.insertarDetalle.run(datos);
      sentencias.tocarOrden.run(datos.ordenId);
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
        registradoPor: fila.registrado_por,
        creadoEn: fila.creado_en,
      }));
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
