const { NOMBRE_ESTADO } = require('../ordenes/estados');

const ORDENES_EN_EL_HISTORIAL = 50;

/** Resumen de una orden para los historiales de cliente y de vehículo. */
const SELECT_ORDEN_RESUMIDA = `
  SELECT o.id, o.estado, o.descripcion, o.creado_en, v.placa, v.marca, v.modelo,
         m.nombre AS mecanico, c.nombre AS cliente
    FROM ordenes o
    JOIN vehiculos v ON v.id = o.vehiculo_id
    JOIN clientes  c ON c.id = o.cliente_id
    JOIN usuarios  m ON m.id = o.mecanico_id
`;

function aCliente(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    documento: fila.documento,
    nombre: fila.nombre,
    telefono: fila.telefono,
    email: fila.email,
    creadoEn: fila.creado_en,
  };
}

function aOrden(fila) {
  return {
    id: fila.id,
    estado: fila.estado,
    estadoNombre: NOMBRE_ESTADO[fila.estado],
    descripcion: fila.descripcion,
    creadoEn: fila.creado_en,
    placa: fila.placa,
    vehiculo: `${fila.marca} ${fila.modelo}`,
    mecanico: fila.mecanico,
    cliente: fila.cliente,
  };
}

/** Acceso a datos del directorio de clientes y vehículos. */
function crearRepositorioClientes(db) {
  // La búsqueda cubre nombre y teléfono (parcial), documento (desde el inicio) y placa (exacta, normalizada).
  const FILTRO = `
    WHERE (@documento IS NULL OR c.documento = @documento)
      AND (@q IS NULL
           OR c.nombre LIKE @parcial
           OR c.telefono LIKE @parcial
           OR c.documento LIKE @prefijo
           OR EXISTS (SELECT 1 FROM vehiculos v WHERE v.cliente_id = c.id AND v.placa = @placa))
  `;

  const sentencias = {
    contar: db.prepare(`SELECT COUNT(*) AS total FROM clientes c ${FILTRO}`),
    buscar: db.prepare(`
      SELECT c.*,
             (SELECT COUNT(*) FROM vehiculos v WHERE v.cliente_id = c.id)       AS vehiculos,
             (SELECT COUNT(*) FROM ordenes o WHERE o.cliente_id = c.id)         AS ordenes,
             (SELECT MAX(o.creado_en) FROM ordenes o WHERE o.cliente_id = c.id) AS ultima_orden
        FROM clientes c
        ${FILTRO}
       ORDER BY c.nombre COLLATE NOCASE
       LIMIT @limite OFFSET @desplazamiento
    `),
    porId: db.prepare('SELECT * FROM clientes WHERE id = ?'),
    actualizar: db.prepare('UPDATE clientes SET nombre = @nombre, telefono = @telefono, email = @email WHERE id = @id'),
    vehiculosDe: db.prepare(`
      SELECT v.id, v.placa, v.marca, v.modelo, v.anio,
             (SELECT COUNT(*) FROM ordenes o WHERE o.vehiculo_id = v.id) AS ordenes
        FROM vehiculos v
       WHERE v.cliente_id = ?
       ORDER BY v.placa
    `),
    ordenesDeCliente: db.prepare(`${SELECT_ORDEN_RESUMIDA} WHERE o.cliente_id = ? ORDER BY o.id DESC LIMIT ${ORDENES_EN_EL_HISTORIAL}`),
    vehiculoPorPlaca: db.prepare(`
      SELECT v.id, v.placa, v.marca, v.modelo, v.anio, c.id AS cliente_id, c.documento, c.nombre, c.telefono, c.email, c.creado_en
        FROM vehiculos v
        JOIN clientes c ON c.id = v.cliente_id
       WHERE v.placa = ?
    `),
    ordenesDeVehiculo: db.prepare(`${SELECT_ORDEN_RESUMIDA} WHERE o.vehiculo_id = ? ORDER BY o.id DESC LIMIT ${ORDENES_EN_EL_HISTORIAL}`),
  };

  return {
    buscar({ q, documento, placa, pagina, tamano }) {
      const filtro = { q, documento, parcial: q ? `%${q}%` : null, prefijo: q ? `${q}%` : null, placa: placa || null };
      const { total } = sentencias.contar.get(filtro);
      const filas = sentencias.buscar.all({ ...filtro, limite: tamano, desplazamiento: (pagina - 1) * tamano });
      return {
        total,
        datos: filas.map((fila) => ({ ...aCliente(fila), vehiculos: fila.vehiculos, ordenes: fila.ordenes, ultimaOrden: fila.ultima_orden })),
      };
    },
    buscarPorId(id) {
      return aCliente(sentencias.porId.get(id));
    },
    actualizar(id, { nombre, telefono, email }) {
      sentencias.actualizar.run({ id, nombre, telefono, email });
    },
    listarVehiculosDe(clienteId) {
      return sentencias.vehiculosDe.all(clienteId).map((fila) => ({ ...fila }));
    },
    listarOrdenesDeCliente(clienteId) {
      return sentencias.ordenesDeCliente.all(clienteId).map(aOrden);
    },
    /** @returns {{ vehiculo: object, cliente: object } | null} El vehículo con su dueño actual. */
    buscarVehiculoPorPlaca(placa) {
      const fila = sentencias.vehiculoPorPlaca.get(placa);
      if (!fila) return null;
      return {
        vehiculo: { id: fila.id, placa: fila.placa, marca: fila.marca, modelo: fila.modelo, anio: fila.anio },
        cliente: aCliente({ ...fila, id: fila.cliente_id }),
      };
    },
    listarOrdenesDeVehiculo(vehiculoId) {
      return sentencias.ordenesDeVehiculo.all(vehiculoId).map(aOrden);
    },
  };
}

module.exports = { crearRepositorioClientes };
