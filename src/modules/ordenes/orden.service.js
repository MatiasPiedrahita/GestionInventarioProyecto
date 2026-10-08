const { validarNuevaOrden } = require('./orden.validator');
const { validarRepuestosUsados } = require('./repuestos-usados.validator');
const { validarFiltros } = require('./filtros.validator');
const { ESTADOS } = require('./estados');
const { ROLES } = require('../auth/roles');
const { ErrorDeValidacion, NoEncontrado, SinPermiso, Conflicto } = require('../../shared/errors');

const LIMITE_NOTAS = 4000;

/**
 * Lógica de las órdenes de trabajo.
 * @param {object} repositorio Repositorio de órdenes.
 * @param {object} usuarios Repositorio de usuarios (para validar el mecánico asignado).
 * @param {object} repuestos Repositorio de repuestos (para descontar stock).
 */
function crearServicioOrdenes(repositorio, usuarios, repuestos) {
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

    /** Detalle completo: datos de la orden más los repuestos usados y su total. */
    obtener(id, usuario) {
      const orden = repositorio.buscarPorId(id);
      if (!orden) throw new NoEncontrado(`No existe la orden #${id}`);
      verificarAcceso(orden, usuario);
      const usados = repositorio.listarRepuestosDeOrden(id);
      const total = usados.reduce((suma, r) => suma + r.subtotal, 0);
      return { ...orden, repuestos: usados, totalRepuestos: Math.round(total * 100) / 100 };
    },

    /**
     * HU-04: asocia repuestos del inventario a la orden y descuenta el stock.
     * Es "todo o nada": si un repuesto no existe o no alcanza el stock, no se
     * registra ninguno y se informa cada problema.
     */
    registrarRepuestos(id, entrada, usuario) {
      const orden = this.obtener(id, usuario);
      if (orden.estado !== ESTADOS.EN_PROCESO) {
        throw new Conflicto(`La orden #${id} está ${orden.estadoNombre.toLowerCase()}; solo se registran repuestos en órdenes en proceso`);
      }

      const resultado = validarRepuestosUsados(entrada);
      if (!resultado.valido) throw new ErrorDeValidacion(resultado.errores);

      const problemas = [];
      const preparados = resultado.valor.map(({ repuestoId, cantidad }, indice) => {
        const repuesto = repuestos.buscarPorId(repuestoId);
        if (!repuesto) {
          problemas.push({ campo: `items[${indice}].repuestoId`, mensaje: `El repuesto ${repuestoId} no existe o fue dado de baja` });
        } else if (repuesto.stockActual < cantidad) {
          problemas.push({
            campo: `items[${indice}].cantidad`,
            mensaje: `Stock insuficiente de ${repuesto.sku}: hay ${repuesto.stockActual} y se piden ${cantidad}`,
          });
        }
        return { repuesto, cantidad };
      });
      if (problemas.some((p) => p.campo.endsWith('repuestoId'))) throw new ErrorDeValidacion(problemas);
      if (problemas.length > 0) throw new Conflicto('No hay stock suficiente; no se registró ningún repuesto', problemas);

      repositorio.enTransaccion(() => {
        preparados.forEach(({ repuesto, cantidad }) => {
          if (!repuestos.descontarStock(repuesto.id, cantidad)) {
            throw new Conflicto(`El stock de ${repuesto.sku} cambió mientras se registraba; intenta de nuevo`);
          }
          repositorio.insertarDetalle({
            ordenId: id,
            repuestoId: repuesto.id,
            cantidad,
            costoUnitario: repuesto.costo,
            registradoPor: usuario.id,
          });
          repuestos.registrarMovimiento({
            repuestoId: repuesto.id,
            tipo: 'USO_EN_ORDEN',
            cantidad: -cantidad,
            stockResultante: repuesto.stockActual - cantidad,
            detalle: `Usado en la orden #${id} (${orden.vehiculo.placa})`,
            ordenId: id,
          });
        });
      });

      return this.obtener(id, usuario);
    },

    /**
     * HU-05: guarda texto libre con las observaciones del servicio. Se
     * registra quién y cuándo lo actualizó. Enviar texto vacío borra la nota.
     */
    actualizarNotas(id, entrada, usuario) {
      this.obtener(id, usuario);
      const notas = entrada ? entrada.notas : undefined;
      if (typeof notas !== 'string') {
        throw new ErrorDeValidacion([{ campo: 'notas', mensaje: 'Las notas deben ser texto' }]);
      }
      const limpias = notas.trim();
      if (limpias.length > LIMITE_NOTAS) {
        throw new ErrorDeValidacion([{ campo: 'notas', mensaje: `Las notas admiten máximo ${LIMITE_NOTAS} caracteres` }]);
      }
      repositorio.actualizarNotas(id, limpias === '' ? null : limpias, usuario.id);
      return this.obtener(id, usuario);
    },

    /**
     * HU-06: listado global con filtros (placa exacta, cliente, mecánico,
     * estado) y paginación. El mecánico solo ve sus órdenes, aunque pida otras.
     */
    listar(query, usuario) {
      const resultado = validarFiltros(query);
      if (!resultado.valido) throw new ErrorDeValidacion(resultado.errores, 'Los filtros del listado no son válidos');
      const filtros = { ...resultado.valor };
      if (usuario.rol === ROLES.MECANICO) filtros.mecanicoId = usuario.id;

      const { datos, total } = repositorio.buscar(filtros);
      return {
        datos,
        pagina: filtros.pagina,
        tamano: filtros.tamano,
        total,
        totalPaginas: Math.max(1, Math.ceil(total / filtros.tamano)),
      };
    },
  };
}

module.exports = { crearServicioOrdenes };
