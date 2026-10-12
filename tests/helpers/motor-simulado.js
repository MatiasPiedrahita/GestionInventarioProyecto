const { spawnSync } = require('node:child_process');
const { resolverPython, CARPETA_DEL_MODELO } = require('../../src/modules/prediccion/interprete');

/**
 * Motor de predicción simulado para las pruebas de la aplicación.
 *
 * Respeta el contrato del modelo real (prediccion/README.md) con una regla
 * simple y predecible: el pronóstico de cada semana es el promedio de las
 * semanas con consumo. Así las pruebas de Node verifican qué se le envía al
 * modelo y qué se hace con su respuesta, sin depender de Python. El modelo
 * de verdad tiene sus propias pruebas (pytest) y una prueba de contrato.
 *
 * @param {{ ajustar?: (prediccion: object, repuesto: object) => object, falla?: Error }} opciones
 *        ajustar permite cambiar el resultado de un repuesto en una prueba concreta.
 */
function crearMotorSimulado({ ajustar = (prediccion) => prediccion, falla = null } = {}) {
  const llamadas = [];
  let pendiente = null;

  function predecirRepuesto(repuesto, entrada) {
    const media = repuesto.consumo.length
      ? repuesto.consumo.reduce((suma, c) => suma + c.unidades, 0) / repuesto.consumo.length
      : 0;
    const diaria = media / 7;
    const dias = diaria > 0 ? Math.round((repuesto.stockActual / diaria) * 10) / 10 : null;
    const corte = new Date(`${entrada.fechaDeCorte}T00:00:00Z`);
    const lunes = new Date(corte.getTime() - ((corte.getUTCDay() + 6) % 7) * 86400000);
    const puntoDeReorden = media > 0 ? Math.ceil(diaria * repuesto.diasDeReposicion) + 1 : 0;

    return ajustar({
      id: repuesto.id,
      sku: repuesto.sku,
      historia: { semanas: repuesto.consumo.length, semanasConConsumo: repuesto.consumo.length, total: media * repuesto.consumo.length, mediaSemanal: media, consumoUltimoAnio: media * repuesto.consumo.length, semanasSinConsumo: repuesto.consumo.length ? 0 : null },
      patron: media > 0 ? 'SUAVE' : 'SIN_CONSUMO',
      patronDescripcion: 'Patrón simulado',
      adi: media > 0 ? 1 : null,
      cv2: media > 0 ? 0 : null,
      modelo: media > 0 ? 'MEDIA_MOVIL' : 'SIN_HISTORIA',
      modeloNombre: media > 0 ? 'Media móvil de 8 semanas' : 'Sin modelo',
      metricas: { rmsse: media > 0 ? 0.8 : null, wape: media > 0 ? 0.3 : null, sesgo: media > 0 ? 0.05 : null, mejoraSobreIngenuo: media > 0 ? 0.2 : null, semanasDePrueba: media > 0 ? 52 : 0 },
      comparados: media > 0 ? [{ modelo: 'MEDIA_MOVIL', modeloNombre: 'Media móvil de 8 semanas', rmsse: 0.8, wape: 0.3, sesgo: 0.05 }, { modelo: 'INGENUO', modeloNombre: 'Última semana', rmsse: 1, wape: 0.4, sesgo: 0 }] : [],
      errorSemanal: 1,
      pronostico: Array.from({ length: entrada.horizonteSemanas }, (_, i) => ({
        semana: new Date(lunes.getTime() + i * 7 * 86400000).toISOString().slice(0, 10),
        unidades: media, inferior: Math.max(0, media - 1), superior: media + 1,
      })),
      demandaTotal: media * entrada.horizonteSemanas,
      tendencia: 'ESTABLE',
      variacionTrimestral: 0,
      demandaDiaria: diaria,
      demandaEnReposicion: diaria * repuesto.diasDeReposicion,
      stockDeSeguridad: media > 0 ? 1 : 0,
      puntoDeReorden,
      cantidadSugerida: Math.max(0, Math.ceil(diaria * (repuesto.diasDeReposicion + 30)) - repuesto.stockActual),
      debePedir: media > 0 && repuesto.stockActual <= puntoDeReorden,
      diasDeCobertura: dias,
      fechaDeQuiebre: dias === null ? null : new Date(corte.getTime() + Math.floor(dias) * 86400000).toISOString().slice(0, 10),
      quiebreAntesDeReponer: dias !== null && dias < repuesto.diasDeReposicion,
      aviso: media > 0 ? null : 'Sin consumo registrado: todavía no hay con qué pronosticar.',
      claseAbc: media > 0 ? 'A' : 'C',
      valorConsumoAnual: media * 52 * repuesto.costo,
    }, repuesto);
  }

  return {
    descripcion: 'Motor simulado (pruebas)',
    /** Las entradas que recibió el motor, en orden. */
    llamadas,

    async predecir(entrada) {
      llamadas.push(entrada);
      if (pendiente) await pendiente.promesa;
      if (falla) throw falla;
      const repuestos = entrada.repuestos.map((repuesto) => predecirRepuesto(repuesto, entrada));
      return {
        version: 1,
        generadoEn: new Date().toISOString(),
        motor: { nombre: 'motor_simulado', version: '0.0.0', python: 'ninguno', librerias: {} },
        parametros: { fechaDeCorte: entrada.fechaDeCorte, horizonteSemanas: entrada.horizonteSemanas, nivelDeServicio: entrada.nivelDeServicio },
        resumen: { repuestos: repuestos.length, porPedir: repuestos.filter((r) => r.debePedir).length },
        repuestos,
      };
    },

    /** Deja al motor "calculando" hasta que la prueba llame a la función devuelta. */
    detener() {
      let liberar;
      pendiente = { promesa: new Promise((resolver) => { liberar = resolver; }) };
      return () => { pendiente = null; liberar(); };
    },
  };
}

/** ¿Se puede ejecutar el modelo real en esta máquina? (Python con sus librerías instaladas). */
function pythonDisponible() {
  const { ejecutable } = resolverPython();
  const resultado = spawnSync(ejecutable, ['-m', 'taller_prediccion', '--version'], { cwd: CARPETA_DEL_MODELO, encoding: 'utf8' });
  return !resultado.error && resultado.status === 0;
}

/**
 * describe que solo corre si el modelo real está disponible. En el pipeline
 * (EXIGIR_PYTHON=1) es obligatorio: si falta Python, la suite falla en vez de saltarse.
 */
function describirConPython(nombre, definir) {
  const disponible = pythonDisponible();
  if (!disponible && process.env.EXIGIR_PYTHON === '1') {
    describe(nombre, () => {
      test('el modelo de Python debe estar disponible en el pipeline', () => {
        throw new Error('No se pudo ejecutar el modelo. Instale las librerías: pip install -r prediccion/requirements.txt');
      });
    });
    return;
  }
  if (!disponible) console.warn(`Se omite "${nombre}": el modelo de Python no está instalado (npm run prediccion:instalar).`);
  (disponible ? describe : describe.skip)(nombre, definir);
}

module.exports = { crearMotorSimulado, pythonDisponible, describirConPython };
