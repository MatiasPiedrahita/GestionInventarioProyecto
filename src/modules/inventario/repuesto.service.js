const { validarRepuesto } = require('./repuesto.validator');
const { validarEntrada } = require('./entrada.validator');
const { parsearCsv } = require('./csv');
const { ACCIONES } = require('../auditoria/acciones');
const { SIN_AUDITORIA } = require('../auditoria/auditoria.service');
const { SIN_EVENTOS } = require('../../shared/eventos');
const { ErrorDeValidacion, NoEncontrado, Conflicto } = require('../../shared/errors');

/**
 * Lógica de negocio de la HU-01 "Gestión de inventario de repuestos".
 * Orquesta validación, reglas (SKU único, historial) y persistencia.
 *
 * Las operaciones sensibles reciben el usuario que las hace para dejarlo en
 * la auditoría; es opcional porque los scripts (seed) no tienen sesión.
 * Después de cada cambio de stock se avisa con eventos.stockCambiado, para
 * que las alertas de stock bajo se actualicen al instante.
 */
function crearServicioInventario(repositorio, { auditoria = SIN_AUDITORIA, eventos = SIN_EVENTOS } = {}) {
  const idDe = (usuario) => (usuario ? usuario.id : null);

  function exigirValido(entrada) {
    const resultado = validarRepuesto(entrada);
    if (!resultado.valido) throw new ErrorDeValidacion(resultado.errores);
    return resultado.valor;
  }

  function exigirSkuDisponible(sku, idPropio = null) {
    const existente = repositorio.buscarPorSku(sku);
    if (existente && existente.id !== idPropio) {
      const estado = existente.activo ? '' : ' (dado de baja)';
      throw new Conflicto(`Ya existe un repuesto con el SKU ${sku}${estado}`, [
        { campo: 'sku', mensaje: 'El SKU debe ser único' },
      ]);
    }
  }

  function exigirExistente(id) {
    const repuesto = repositorio.buscarPorId(id);
    if (!repuesto) throw new NoEncontrado(`No existe un repuesto activo con id ${id}`);
    return repuesto;
  }

  return {
    listar(filtros) {
      return repositorio.listar(filtros);
    },

    obtener(id) {
      return exigirExistente(id);
    },

    crear(entrada) {
      const datos = exigirValido(entrada);
      exigirSkuDisponible(datos.sku);
      const creado = repositorio.enTransaccion(() => {
        const id = repositorio.insertar(datos);
        repositorio.registrarMovimiento({
          repuestoId: id,
          tipo: 'ALTA',
          cantidad: datos.stockActual,
          stockResultante: datos.stockActual,
          detalle: 'Registro inicial del repuesto',
        });
        return repositorio.buscarPorId(id);
      });
      eventos.stockCambiado([creado.id]);
      return creado;
    },

    actualizar(id, entrada, usuario) {
      const anterior = exigirExistente(id);
      const datos = exigirValido(entrada);
      exigirSkuDisponible(datos.sku, id);
      const actualizado = repositorio.enTransaccion(() => {
        repositorio.actualizar(id, datos);
        const diferencia = datos.stockActual - anterior.stockActual;
        if (diferencia !== 0) {
          repositorio.registrarMovimiento({
            repuestoId: id,
            tipo: 'AJUSTE',
            cantidad: diferencia,
            stockResultante: datos.stockActual,
            detalle: 'Ajuste manual de stock',
          });
          auditoria.registrar({
            usuarioId: idDe(usuario),
            accion: ACCIONES.REPUESTO_AJUSTE,
            entidad: 'repuesto',
            entidadId: id,
            detalle: `${anterior.sku}: de ${anterior.stockActual} a ${datos.stockActual} unidades`,
          });
        }
        return repositorio.buscarPorId(id);
      });
      // También si solo cambió el mínimo: un repuesto puede quedar por debajo sin que se mueva el stock.
      eventos.stockCambiado([id]);
      return actualizado;
    },

    darDeBaja(id, usuario) {
      const repuesto = exigirExistente(id);
      repositorio.enTransaccion(() => {
        repositorio.darDeBaja(id);
        repositorio.registrarMovimiento({
          repuestoId: id,
          tipo: 'BAJA',
          cantidad: 0,
          stockResultante: repuesto.stockActual,
          detalle: 'Repuesto dado de baja del catálogo',
        });
        auditoria.registrar({
          usuarioId: idDe(usuario),
          accion: ACCIONES.REPUESTO_BAJA,
          entidad: 'repuesto',
          entidadId: id,
          detalle: `${repuesto.sku} (${repuesto.nombre}), con ${repuesto.stockActual} unidades`,
        });
      });
      eventos.stockCambiado([id]);
    },

    /**
     * Entrada de mercancía: suma al stock las unidades que llegaron del
     * proveedor y deja el movimiento ENTRADA en el historial. A diferencia
     * del ajuste manual, no hay que calcular el stock final a mano.
     */
    registrarEntrada(id, entrada, usuario) {
      const repuesto = exigirExistente(id);
      const resultado = validarEntrada(entrada);
      if (!resultado.valido) throw new ErrorDeValidacion(resultado.errores);
      const { cantidad, detalle } = resultado.valor;

      const actualizado = repositorio.enTransaccion(() => {
        const stockResultante = repositorio.sumarStock(id, cantidad);
        repositorio.registrarMovimiento({
          repuestoId: id,
          tipo: 'ENTRADA',
          cantidad,
          stockResultante,
          detalle: detalle || 'Entrada de mercancía',
        });
        auditoria.registrar({
          usuarioId: idDe(usuario),
          accion: ACCIONES.REPUESTO_ENTRADA,
          entidad: 'repuesto',
          entidadId: id,
          detalle: `${repuesto.sku}: +${cantidad} (de ${repuesto.stockActual} a ${stockResultante})`,
        });
        return repositorio.buscarPorId(id);
      });
      eventos.stockCambiado([id]);
      return actualizado;
    },

    historial(id) {
      exigirExistente(id);
      return repositorio.listarMovimientos(id);
    },

    /**
     * Carga masiva desde CSV. Es "todo o nada": si una sola fila falla,
     * no se guarda ninguna y se devuelve el detalle de cada error por fila.
     */
    importarCsv(textoCsv, usuario) {
      let resultado;
      try {
        resultado = parsearCsv(textoCsv);
      } catch (error) {
        throw new ErrorDeValidacion([{ fila: null, campo: '_', mensaje: error.message }], 'No se pudo leer el CSV');
      }

      const { filas } = resultado;
      if (filas.length === 0) {
        throw new ErrorDeValidacion([{ fila: null, campo: '_', mensaje: 'El CSV no tiene filas de datos' }]);
      }

      const errores = [];
      const validos = [];
      const skusEnArchivo = new Set();

      for (const { numeroFila, datos } of filas) {
        const validacion = validarRepuesto(datos);
        if (!validacion.valido) {
          validacion.errores.forEach((e) => errores.push({ fila: numeroFila, ...e }));
          continue;
        }
        const { sku } = validacion.valor;
        if (skusEnArchivo.has(sku)) {
          errores.push({ fila: numeroFila, campo: 'sku', mensaje: `SKU ${sku} repetido dentro del archivo` });
          continue;
        }
        if (repositorio.buscarPorSku(sku)) {
          errores.push({ fila: numeroFila, campo: 'sku', mensaje: `SKU ${sku} ya existe en el inventario` });
          continue;
        }
        skusEnArchivo.add(sku);
        validos.push(validacion.valor);
      }

      if (errores.length > 0) {
        throw new ErrorDeValidacion(errores, `El CSV tiene ${errores.length} error(es); no se cargó ninguna fila`);
      }

      const creados = repositorio.enTransaccion(() =>
        validos.map((datos) => {
          const id = repositorio.insertar(datos);
          repositorio.registrarMovimiento({
            repuestoId: id,
            tipo: 'CARGA_CSV',
            cantidad: datos.stockActual,
            stockResultante: datos.stockActual,
            detalle: 'Carga masiva por CSV',
          });
          return repositorio.buscarPorId(id);
        }),
      );

      auditoria.registrar({
        usuarioId: idDe(usuario),
        accion: ACCIONES.REPUESTO_IMPORTACION,
        entidad: 'repuesto',
        detalle: `${creados.length} repuesto(s) cargados por CSV`,
      });
      eventos.stockCambiado(creados.map((repuesto) => repuesto.id));
      return { cantidad: creados.length, creados };
    },
  };
}

module.exports = { crearServicioInventario };
