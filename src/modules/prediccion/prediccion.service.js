const { ACCIONES } = require('../auditoria/acciones');
const { SIN_AUDITORIA } = require('../auditoria/auditoria.service');
const { ErrorDeValidacion, NoEncontrado, Conflicto } = require('../../shared/errors');
const { comprasSugeridas, clasificacionAbc, sinMovimiento, precisionDelModelo, comprasEnCsv } = require('./reportes');
const { aplicarPolitica } = require('./politica');

const VERSION_DEL_CONTRATO = 1;
const HORIZONTE_POR_DEFECTO = 8;
const NIVEL_DE_SERVICIO_POR_DEFECTO = 0.95;
const SEMANAS_DE_HISTORIA = 156;
const SEMANAS_EN_EL_GRAFICO = 104;
const HORAS_DE_VIGENCIA = 24;
const MINUTOS_PARA_DAR_POR_PERDIDA = 15;
const MINUTOS_ENTRE_REINTENTOS = 60;
const DIA_MS = 24 * 3600 * 1000;

const aFechaSql = (fecha) => fecha.toISOString().slice(0, 19).replace('T', ' ');
const aDia = (fecha) => fecha.toISOString().slice(0, 10);
const deFechaSql = (texto) => Date.parse(`${texto.replace(' ', 'T')}Z`);

/** Lunes (UTC) de la semana de la fecha. */
function lunesDe(fecha) {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() - ((fecha.getUTCDay() + 6) % 7)));
}

/** Parámetros del modelo que el usuario puede cambiar al lanzar una ejecución (función pura). */
function validarParametros(entrada) {
  const datos = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};
  const errores = [];

  let horizonteSemanas = HORIZONTE_POR_DEFECTO;
  if (datos.horizonteSemanas !== undefined && datos.horizonteSemanas !== null && datos.horizonteSemanas !== '') {
    horizonteSemanas = Number(datos.horizonteSemanas);
    if (!Number.isInteger(horizonteSemanas) || horizonteSemanas < 4 || horizonteSemanas > 26) {
      errores.push({ campo: 'horizonteSemanas', mensaje: 'El horizonte debe ser un número entero de semanas entre 4 y 26' });
    }
  }

  let nivelDeServicio = NIVEL_DE_SERVICIO_POR_DEFECTO;
  if (datos.nivelDeServicio !== undefined && datos.nivelDeServicio !== null && datos.nivelDeServicio !== '') {
    nivelDeServicio = Number(datos.nivelDeServicio);
    if (!Number.isFinite(nivelDeServicio) || nivelDeServicio < 0.8 || nivelDeServicio > 0.99) {
      errores.push({ campo: 'nivelDeServicio', mensaje: 'El nivel de servicio debe estar entre 0.80 y 0.99' });
    }
  }

  if (errores.length > 0) return { valido: false, errores, valor: null };
  return { valido: true, errores: [], valor: { horizonteSemanas, nivelDeServicio } };
}

/** Explica en una frase por qué un repuesto con stock sobre el mínimo igual necesita atención. */
function redactarQuiebre(r, diasReposicion) {
  const cuando = r.diasDeCobertura < 1 ? 'hoy' : `en ${Math.floor(r.diasDeCobertura)} ${Math.floor(r.diasDeCobertura) === 1 ? 'día' : 'días'}`;
  const pedido = `un pedido tarda ${diasReposicion} ${diasReposicion === 1 ? 'día' : 'días'}`;
  return `al ritmo previsto se agota ${cuando} y ${pedido}. Sugerido: pedir ${r.cantidadSugerida}.`;
}

/**
 * Lleva una predicción guardada al día de hoy: el pronóstico es el que
 * calculó el modelo, pero cuánto pedir, para cuántos días alcanza y cuándo
 * se agota se recalculan con el stock y la fecha de este momento.
 */
function ponerAlDia(prediccion, puntos, hoy) {
  const decision = aplicarPolitica({
    pronostico: puntos.map((punto) => punto.unidades),
    primeraSemana: puntos.length > 0 ? puntos[0].semana : null,
    hoy,
    stockActual: prediccion.repuesto.stockActual,
    diasDeReposicion: prediccion.repuesto.diasReposicion,
    stockDeSeguridad: prediccion.stockDeSeguridad,
  });
  return { ...prediccion, ...decision };
}

/**
 * Predicción de demanda (HU-09): prepara los datos, ejecuta el modelo de
 * Python, guarda los resultados y los conecta con las alertas.
 *
 * El modelo tarda (segundos o minutos, según el catálogo), así que
 * `iniciar` responde de inmediato con la ejecución "en curso" y el cálculo
 * sigue aparte; la interfaz consulta el estado hasta que termina. Solo
 * corre una ejecución a la vez.
 *
 * Lo que se guarda de cada ejecución es el pronóstico. Las decisiones que
 * dependen del stock (cuánto pedir, cuándo se agota) se recalculan cada vez
 * que se consultan (ver politica.js): no esperan a la siguiente ejecución.
 *
 * @param {{ consumo: object, repositorio: object, motor: { predecir: Function, descripcion: string },
 *           alertas?: object, auditoria?: object, ahora?: () => Date, horasDeVigencia?: number }} dependencias
 */
function crearServicioPrediccion({
  consumo, repositorio, motor, alertas = null, auditoria = SIN_AUDITORIA, ahora = () => new Date(), horasDeVigencia = HORAS_DE_VIGENCIA,
}) {
  let tareaEnCurso = Promise.resolve();

  /** Las predicciones de una ejecución, con sus decisiones calculadas para el stock de hoy. */
  function prediccionesAlDia(ejecucion) {
    const puntos = repositorio.listarPuntos(ejecucion.id);
    const hoy = aDia(ahora());
    return repositorio.listarPredicciones(ejecucion.id).map((p) => ponerAlDia(p, puntos.get(p.id) || [], hoy));
  }

  /** Arma la entrada del contrato y recuerda con qué stock y qué tiempo de reposición se calculó cada repuesto. */
  function prepararDatos({ horizonteSemanas, nivelDeServicio }, momento) {
    const desde = aFechaSql(new Date(lunesDe(momento).getTime() - SEMANAS_DE_HISTORIA * 7 * DIA_MS));
    const consumos = consumo.consumoSemanalDesde(desde);
    const primeros = consumo.primerMovimientoPorRepuesto();
    const repuestos = consumo.listarRepuestos();
    const contexto = new Map(repuestos.map((r) => [r.id, { stockAlCalcular: r.stockActual, diasReposicion: r.diasReposicion }]));

    const entrada = {
      version: VERSION_DEL_CONTRATO,
      fechaDeCorte: aDia(momento),
      horizonteSemanas,
      nivelDeServicio,
      repuestos: repuestos.map((r) => ({
        id: r.id,
        sku: r.sku,
        stockActual: r.stockActual,
        stockMinimo: r.stockMinimo,
        costo: r.costo,
        diasDeReposicion: r.diasReposicion,
        ...(primeros.has(r.id) ? { primeraSemana: primeros.get(r.id) } : {}),
        consumo: consumos.get(r.id) || [],
      })),
    };
    return { entrada, contexto };
  }

  function guardar(ejecucionId, resultado, contexto, duracionMs) {
    if (!resultado || !Array.isArray(resultado.repuestos)) throw new Error('La respuesta del modelo no trae la lista de repuestos');
    const validos = resultado.repuestos.filter((r) => contexto.has(r.id));
    repositorio.enTransaccion(() => {
      validos.forEach((r) => repositorio.guardarPrediccion(ejecucionId, contexto.get(r.id), r));
      repositorio.completarEjecucion(ejecucionId, { duracionMs, motor: resultado.motor, resumen: resultado.resumen });
      repositorio.depurar();
    });
    return validos;
  }

  async function correr(ejecucionId, entrada, contexto) {
    const inicio = Date.now();
    try {
      const resultado = await motor.predecir(entrada);
      guardar(ejecucionId, resultado, contexto, Date.now() - inicio);
      // Con el pronóstico nuevo, las alertas vuelven a mirar qué repuestos se agotarían antes de poder reponerlos.
      if (alertas) alertas.revisar();
    } catch (error) {
      repositorio.fallarEjecucion(ejecucionId, { duracionMs: Date.now() - inicio, error: error.message || String(error) });
      if (process.env.NODE_ENV !== 'test') console.error('La predicción de demanda falló:', error.message, error.detalle || '');
    }
  }

  function exigirResultados() {
    const ejecucion = repositorio.ultimaEjecucionCompletada();
    if (!ejecucion) throw new NoEncontrado('Todavía no se ha ejecutado la predicción de demanda');
    return ejecucion;
  }

  return {
    /**
     * Lanza una ejecución y responde de inmediato. El cálculo sigue aparte.
     * @returns {object} La ejecución, en estado EN_CURSO.
     */
    iniciar({ usuario = null, origen = 'MANUAL', parametros = {} } = {}) {
      const validacion = validarParametros(parametros);
      if (!validacion.valido) throw new ErrorDeValidacion(validacion.errores);

      const momento = ahora();
      repositorio.abandonarEjecucionesAnterioresA(aFechaSql(new Date(momento.getTime() - MINUTOS_PARA_DAR_POR_PERDIDA * 60000)));
      if (repositorio.ejecucionEnCurso()) throw new Conflicto('Ya hay una predicción en curso. Espere a que termine.');

      const { entrada, contexto } = prepararDatos(validacion.valor, momento);
      const id = repositorio.crearEjecucion({
        origen,
        iniciadaPor: usuario ? usuario.id : null,
        fechaDeCorte: entrada.fechaDeCorte,
        horizonteSemanas: entrada.horizonteSemanas,
        nivelDeServicio: entrada.nivelDeServicio,
        repuestos: entrada.repuestos.length,
      });
      auditoria.registrar({
        usuarioId: usuario ? usuario.id : null,
        accion: ACCIONES.PREDICCION_EJECUTADA,
        entidad: 'prediccion',
        entidadId: id,
        detalle: `${entrada.repuestos.length} repuestos, horizonte de ${entrada.horizonteSemanas} semanas${origen === 'PROGRAMADA' ? ' (tarea programada)' : ''}`,
      });

      tareaEnCurso = correr(id, entrada, contexto);
      return repositorio.buscarEjecucion(id);
    },

    /** Espera a que termine la ejecución en curso (pruebas, tarea programada y cierre ordenado). */
    async esperar() {
      await tareaEnCurso;
    },

    /**
     * Para la tarea programada, que pregunta cada pocos minutos. Recalcula si la
     * última predicción ya venció, o si el catálogo cambió desde entonces (un
     * repuesto nuevo, o uno al que le cambiaron el tiempo de reposición).
     */
    async ejecutarSiHaceFalta() {
      const momento = ahora().getTime();
      const completada = repositorio.ultimaEjecucionCompletada();
      const reciente = completada && momento - deFechaSql(completada.finalizadaEn) < horasDeVigencia * 3600 * 1000;
      const pendientes = completada ? repositorio.contarPendientes(completada.id) : 0;
      if (reciente && pendientes === 0) return { ejecutada: false, motivo: 'La predicción está vigente' };
      if (repositorio.ejecucionEnCurso()) return { ejecutada: false, motivo: 'Ya hay una ejecución en curso' };
      if (consumo.listarRepuestos().length === 0) return { ejecutada: false, motivo: 'No hay repuestos en el catálogo' };
      // Si el último intento falló hace poco, no se insiste en cada vuelta: el historial se llenaría de fallos iguales.
      const ultima = repositorio.ultimaEjecucion();
      if (ultima && ultima.estado === 'FALLIDA' && momento - deFechaSql(ultima.iniciadaEn) < MINUTOS_ENTRE_REINTENTOS * 60000) {
        return { ejecutada: false, motivo: 'El último intento falló hace menos de una hora' };
      }
      // Sin Python instalado no se llena el historial de ejecuciones fallidas en cada arranque.
      if (typeof motor.comprobar === 'function') {
        const { disponible, motivo } = await motor.comprobar();
        if (!disponible) return { ejecutada: false, motivo };
      }

      const { id } = this.iniciar({ origen: 'PROGRAMADA' });
      await this.esperar();
      const { estado, error } = repositorio.buscarEjecucion(id);
      return { ejecutada: true, estado, ...(error ? { error } : {}) };
    },

    estado() {
      return {
        enCurso: repositorio.ejecucionEnCurso(),
        ultima: repositorio.ultimaEjecucion(),
        ultimaCompletada: repositorio.ultimaEjecucionCompletada(),
      };
    },

    ejecucion(id) {
      const ejecucion = repositorio.buscarEjecucion(id);
      if (!ejecucion) throw new NoEncontrado(`No existe la ejecución #${id}`);
      return ejecucion;
    },

    ejecuciones() {
      return repositorio.listarEjecuciones(12);
    },

    /**
     * La última predicción completa: la ejecución y el resultado de cada repuesto, con las decisiones al día.
     * `pendientes` son los repuestos activos que esa ejecución no cubre (nuevos, o con otro tiempo de reposición).
     */
    resumen() {
      const ejecucion = repositorio.ultimaEjecucionCompletada();
      if (!ejecucion) return { ejecucion: null, predicciones: [], pendientes: 0, enCurso: repositorio.ejecucionEnCurso() };
      return {
        ejecucion,
        predicciones: prediccionesAlDia(ejecucion).filter((p) => p.repuesto.activo),
        pendientes: repositorio.contarPendientes(ejecucion.id),
        enCurso: repositorio.ejecucionEnCurso(),
      };
    },

    /** Predicción de un repuesto con su pronóstico semanal y la historia de consumo, para dibujar el gráfico. */
    detalle(repuestoId) {
      const ejecucion = exigirResultados();
      const guardada = repositorio.buscarPrediccion(ejecucion.id, repuestoId);
      if (!guardada) throw new NoEncontrado('Este repuesto todavía no tiene predicción. Ejecútela de nuevo para incluirlo.');
      const prediccion = ponerAlDia(guardada, guardada.pronostico, aDia(ahora()));

      // Historia semanal con las semanas sin consumo en cero, hasta la última semana completa antes del corte.
      const corte = lunesDe(new Date(`${ejecucion.fechaDeCorte}T00:00:00Z`));
      const semanas = Math.min(SEMANAS_EN_EL_GRAFICO, Math.max(prediccion.historia.semanas, 1));
      const inicio = new Date(corte.getTime() - semanas * 7 * DIA_MS);
      const porSemana = new Map(consumo.consumoSemanalDe(repuestoId, aFechaSql(inicio)).map((c) => [c.semana, c.unidades]));
      const historia = Array.from({ length: semanas }, (_, i) => {
        const semana = aDia(new Date(inicio.getTime() + i * 7 * DIA_MS));
        return { semana, unidades: porSemana.get(semana) || 0 };
      });

      return { ejecucion, ...prediccion, historia: { ...prediccion.historia, serie: historia } };
    },

    /** Reportes de la última predicción: compras sugeridas, clasificación ABC, repuestos sin movimiento y precisión del modelo. */
    reportes() {
      const ejecucion = exigirResultados();
      const predicciones = prediccionesAlDia(ejecucion).filter((p) => p.repuesto.activo);
      return {
        ejecucion,
        compras: comprasSugeridas(predicciones),
        abc: clasificacionAbc(predicciones),
        sinMovimiento: sinMovimiento(predicciones),
        precision: precisionDelModelo(predicciones),
      };
    },

    /** El reporte de compras sugeridas como archivo CSV. @returns {{ nombre: string, contenido: string }} */
    comprasCsv() {
      const { ejecucion, compras } = this.reportes();
      return { nombre: `compras-sugeridas-${ejecucion.fechaDeCorte}.csv`, contenido: comprasEnCsv(compras) };
    },

    /**
     * Lo que la última predicción sugiere hoy para cada repuesto (lo usan las alertas).
     * `quiebreProyectado` trae la explicación cuando el repuesto se agotaría antes de
     * que alcance a llegar un pedido; null si el stock alcanza.
     * @returns {Map<number, object>}
     */
    sugerencias() {
      const ejecucion = repositorio.ultimaEjecucionCompletada();
      if (!ejecucion) return new Map();
      return new Map(prediccionesAlDia(ejecucion).map((p) => [p.repuesto.id, {
        cantidadSugerida: p.cantidadSugerida,
        puntoDeReorden: p.puntoDeReorden,
        diasDeCobertura: p.diasDeCobertura,
        fechaDeQuiebre: p.fechaDeQuiebre,
        debePedir: p.debePedir,
        quiebreProyectado: p.quiebreAntesDeReponer && p.demandaTotal > 0 && p.diasDeCobertura !== null
          ? redactarQuiebre(p, p.repuesto.diasReposicion)
          : null,
        calculadaEn: ejecucion.finalizadaEn,
      }]));
    },

    /** Punto de reorden que la última predicción sugiere como stock mínimo de un repuesto. */
    minimoSugerido(repuestoId) {
      return this.detalle(repuestoId).puntoDeReorden;
    },

    /** Sección "prediccion" del estado del sistema. */
    estadoParaElSistema() {
      const ultima = repositorio.ultimaEjecucion();
      return {
        motor: motor.descripcion,
        ultimaEjecucion: ultima ? { estado: ultima.estado, iniciadaEn: ultima.iniciadaEn, duracionMs: ultima.duracionMs, error: ultima.error } : null,
        version: ultima && ultima.motor ? `${ultima.motor.nombre} ${ultima.motor.version} · Python ${ultima.motor.python}` : null,
      };
    },
  };
}

module.exports = { crearServicioPrediccion, validarParametros, redactarQuiebre, ponerAlDia, lunesDe };
