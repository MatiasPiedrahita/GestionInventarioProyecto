const { validarRepuesto } = require('./repuesto.validator');
const { parsearCsv } = require('./csv');
const { ErrorDeValidacion, NoEncontrado, Conflicto } = require('../../shared/errors');

/**
 * Lógica de negocio de la HU-01 "Gestión de inventario de repuestos".
 * Orquesta validación, reglas (SKU único, historial) y persistencia.
 */
function crearServicioInventario(repositorio) {
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
      return repositorio.enTransaccion(() => {
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
    },

    actualizar(id, entrada) {
      const anterior = exigirExistente(id);
      const datos = exigirValido(entrada);
      exigirSkuDisponible(datos.sku, id);
      return repositorio.enTransaccion(() => {
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
        }
        return repositorio.buscarPorId(id);
      });
    },

    darDeBaja(id) {
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
      });
    },

    historial(id) {
      exigirExistente(id);
      return repositorio.listarMovimientos(id);
    },

    /**
     * Carga masiva desde CSV. Es "todo o nada": si una sola fila falla,
     * no se guarda ninguna y se devuelve el detalle de cada error por fila.
     */
    importarCsv(textoCsv) {
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

      return { cantidad: creados.length, creados };
    },
  };
}

module.exports = { crearServicioInventario };
