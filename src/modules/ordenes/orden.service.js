const { validarNuevaOrden } = require('./orden.validator');
const { ROLES } = require('../auth/roles');
const { ErrorDeValidacion, NoEncontrado, SinPermiso } = require('../../shared/errors');

/**
 * Lógica de las órdenes de trabajo.
 * @param {object} repositorio Repositorio de órdenes.
 * @param {object} usuarios Repositorio de usuarios (para validar el mecánico asignado).
 */
function crearServicioOrdenes(repositorio, usuarios) {
  /** Un mecánico solo ve y trabaja sus propias órdenes; los demás roles ven todas. */
  function verificarAcceso(orden, usuario) {
    if (usuario.rol === ROLES.MECANICO && orden.mecanico.id !== usuario.id) {
      throw new SinPermiso('Esta orden está asignada a otro mecánico');
    }
  }

  function resolverMecanico(mecanicoIdPedido, usuario) {
    if (usuario.rol === ROLES.MECANICO) return usuario.id;
    if (!mecanicoIdPedido) {
      throw new ErrorDeValidacion([{ campo: 'mecanicoId', mensaje: 'Selecciona el mecánico que atenderá la orden' }]);
    }
    const mecanico = usuarios.buscarPorId(mecanicoIdPedido);
    if (!mecanico || mecanico.rol !== ROLES.MECANICO || !mecanico.activo) {
      throw new ErrorDeValidacion([{ campo: 'mecanicoId', mensaje: 'El usuario seleccionado no es un mecánico activo' }]);
    }
    return mecanico.id;
  }

  return {
    /**
     * Registra una orden nueva en estado "En proceso". Si el cliente (por
     * documento) o el vehículo (por placa) ya existen, se reutilizan.
     */
    crear(entrada, usuario) {
      const resultado = validarNuevaOrden(entrada);
      if (!resultado.valido) throw new ErrorDeValidacion(resultado.errores);
      const { cliente, vehiculo, descripcion, mecanicoId } = resultado.valor;
      const mecanicoAsignado = resolverMecanico(mecanicoId, usuario);

      return repositorio.enTransaccion(() => {
        const clienteId = repositorio.guardarCliente(cliente);
        const vehiculoId = repositorio.guardarVehiculo(vehiculo, clienteId);
        const id = repositorio.insertarOrden({
          clienteId,
          vehiculoId,
          mecanicoId: mecanicoAsignado,
          creadoPor: usuario.id,
          descripcion,
        });
        return repositorio.buscarPorId(id);
      });
    },

    obtener(id, usuario) {
      const orden = repositorio.buscarPorId(id);
      if (!orden) throw new NoEncontrado(`No existe la orden #${id}`);
      verificarAcceso(orden, usuario);
      return orden;
    },

    listar(usuario) {
      return repositorio.listar({ mecanicoId: usuario.rol === ROLES.MECANICO ? usuario.id : null });
    },
  };
}

module.exports = { crearServicioOrdenes };
