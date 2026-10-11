const { validarContacto, validarBusquedaDeClientes } = require('./cliente.validator');
const { normalizarPlaca, PATRON_PLACA } = require('../ordenes/orden.validator');
const { ACCIONES } = require('../auditoria/acciones');
const { SIN_AUDITORIA } = require('../auditoria/auditoria.service');
const { ErrorDeValidacion, NoEncontrado } = require('../../shared/errors');

const ETIQUETAS = { nombre: 'nombre', telefono: 'teléfono', email: 'correo' };

/**
 * Directorio de clientes y vehículos (recepción, dueño y administrador).
 * Los clientes y los vehículos nacen al crear una orden; aquí se consultan,
 * se corrige el contacto y se revisa el historial de cada vehículo.
 */
function crearServicioClientes(repositorio, { auditoria = SIN_AUDITORIA } = {}) {
  function exigirExistente(id) {
    const cliente = repositorio.buscarPorId(id);
    if (!cliente) throw new NoEncontrado(`No existe el cliente con id ${id}`);
    return cliente;
  }

  return {
    listar(query) {
      const resultado = validarBusquedaDeClientes(query);
      if (!resultado.valido) throw new ErrorDeValidacion(resultado.errores, 'La búsqueda no es válida');
      const filtros = resultado.valor;
      // Si lo buscado tiene forma de placa, también se busca por placa exacta ("abc-123" encuentra ABC123).
      const placa = filtros.q && PATRON_PLACA.test(normalizarPlaca(filtros.q)) ? normalizarPlaca(filtros.q) : null;
      const { datos, total } = repositorio.buscar({ ...filtros, placa });
      return {
        datos,
        pagina: filtros.pagina,
        tamano: filtros.tamano,
        total,
        totalPaginas: Math.max(1, Math.ceil(total / filtros.tamano)),
      };
    },

    /** Ficha completa: contacto, sus vehículos y sus últimas órdenes. */
    obtener(id) {
      const cliente = exigirExistente(id);
      return {
        ...cliente,
        vehiculos: repositorio.listarVehiculosDe(id),
        ordenes: repositorio.listarOrdenesDeCliente(id),
      };
    },

    actualizarContacto(id, entrada, usuario) {
      const anterior = exigirExistente(id);
      const resultado = validarContacto(entrada);
      if (!resultado.valido) throw new ErrorDeValidacion(resultado.errores);
      repositorio.actualizar(id, resultado.valor);
      const cambios = ['nombre', 'telefono', 'email'].filter((campo) => resultado.valor[campo] !== anterior[campo]);
      if (cambios.length > 0) {
        auditoria.registrar({
          usuarioId: usuario.id,
          accion: ACCIONES.CLIENTE_EDITADO,
          entidad: 'cliente',
          entidadId: id,
          detalle: `${anterior.nombre} (${anterior.documento}): ${cambios.map((campo) => ETIQUETAS[campo]).join(', ')}`,
        });
      }
      return this.obtener(id);
    },

    /** Historial de un vehículo por su placa: datos, dueño actual y todas sus órdenes. */
    historialDeVehiculo(placaPedida) {
      const placa = normalizarPlaca(placaPedida);
      if (!PATRON_PLACA.test(placa)) {
        throw new ErrorDeValidacion([{ campo: 'placa', mensaje: 'La placa debe tener el formato ABC123 (carro) o ABC12D (moto)' }]);
      }
      const encontrado = repositorio.buscarVehiculoPorPlaca(placa);
      if (!encontrado) throw new NoEncontrado(`No hay un vehículo registrado con la placa ${placa}`);
      return { ...encontrado, ordenes: repositorio.listarOrdenesDeVehiculo(encontrado.vehiculo.id) };
    },
  };
}

module.exports = { crearServicioClientes };
