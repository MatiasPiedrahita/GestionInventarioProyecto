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
