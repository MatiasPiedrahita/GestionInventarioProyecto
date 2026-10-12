const { crearContexto } = require('../helpers/contexto');
const { describirConPython } = require('../helpers/motor-simulado');
const { repuestoConHistoria } = require('../helpers/historia');
const { crearMotorPython } = require('../../src/modules/prediccion/motor-python');

/**
 * PRUEBA DE CONTRATO entre la aplicación (Node.js) y el modelo (Python).
 *
 * Aquí no hay nada simulado: la aplicación arma los datos desde su base,
 * lanza el proceso de Python de verdad y guarda lo que responde. Si alguno
 * de los dos lados cambia el formato sin avisar al otro, esta prueba falla.
 *
 * Necesita el entorno de Python (npm run prediccion:instalar). Sin él se
 * omite con un aviso; en el pipeline es obligatoria (EXIGIR_PYTHON=1).
 */
describirConPython('Contrato Node ↔ Python: la aplicación ejecuta el modelo real', () => {
  const MODELOS = ['MEDIA_MOVIL', 'INGENUO', 'SUAVIZADO_EXPONENCIAL', 'HOLT_AMORTIGUADO', 'ESTACIONAL_MENSUAL', 'CROSTON', 'SBA', 'TSB', 'SIN_HISTORIA'];
  let ctx;
  let admin;
  let estable;
  let escaso;
  let sinUso;

  beforeAll(async () => {
    ctx = crearContexto();
    admin = ctx.como('administrador');
    // Consumo parejo de 5 por semana durante 30 semanas, con stock de sobra.
    estable = await repuestoConHistoria(ctx, { sku: 'EST-001', nombre: 'Filtro estable', unidadesPorSemana: Array(30).fill(5), stockFinal: 200 });
    // Sale una unidad cada cuatro semanas; quedan 2.
    escaso = await repuestoConHistoria(ctx, {
      sku: 'INT-002', nombre: 'Correa de baja rotación', costo: 185000, stockMinimo: 0,
      unidadesPorSemana: Array.from({ length: 32 }, (_, i) => (i % 4 === 0 ? 1 : 0)), stockFinal: 2,
    });
    sinUso = await repuestoConHistoria(ctx, { sku: 'NUN-003', nombre: 'Nunca usado', unidadesPorSemana: [], stockFinal: 4 });

    await admin.post('/api/prediccion/ejecuciones').send({});
    await ctx.servicios.prediccion.esperar();
  }, 180000);

  const prediccionDe = async (repuesto) => (await admin.get(`/api/prediccion/repuestos/${repuesto.id}`)).body;

  test('la ejecución termina completada e informa con qué versión del modelo, de Python y de las librerías se calculó', async () => {
    const { ejecucion, predicciones } = (await admin.get('/api/prediccion/resumen')).body;

    expect(ejecucion).toMatchObject({ estado: 'COMPLETADA', error: null, repuestos: 3 });
    expect(ejecucion.motor).toMatchObject({ nombre: 'taller_prediccion', version: expect.stringMatching(/^\d+\.\d+\.\d+$/), python: expect.stringMatching(/^3\.\d+/) });
    expect(Object.keys(ejecucion.motor.librerias).sort()).toEqual(['numpy', 'pandas', 'statsmodels']);
    expect(ejecucion.resumen).toMatchObject({ repuestos: 3 });
    expect(predicciones).toHaveLength(3);
  });

  test('cada predicción guardada tiene todos los campos del contrato con tipos correctos', async () => {
    const { predicciones } = (await admin.get('/api/prediccion/resumen')).body;

    predicciones.forEach((p) => {
      expect(MODELOS).toContain(p.modelo);
      expect(['SUAVE', 'ERRATICA', 'INTERMITENTE', 'IRREGULAR', 'SIN_CONSUMO']).toContain(p.patron);
      expect(['A', 'B', 'C']).toContain(p.claseAbc);
      expect(['CRECE', 'ESTABLE', 'BAJA', 'SIN_DATOS']).toContain(p.tendencia);
      expect(p.modeloNombre).toEqual(expect.any(String));
      expect(Number.isInteger(p.puntoDeReorden) && p.puntoDeReorden >= 0).toBe(true);
      expect(Number.isInteger(p.cantidadSugerida) && p.cantidadSugerida >= 0).toBe(true);
      expect(Number.isInteger(p.stockDeSeguridad) && p.stockDeSeguridad >= 0).toBe(true);
      expect(typeof p.debePedir).toBe('boolean');
      expect(typeof p.quiebreAntesDeReponer).toBe('boolean');
      expect(p.metricas).toEqual(expect.objectContaining({ semanasDePrueba: expect.any(Number) }));
    });
  });

  test('consumo parejo de 5 por semana: pronostica 5, el modelo acierta y con 200 en stock no hay que pedir', async () => {
    const p = await prediccionDe(estable);

    expect(p.pronostico).toHaveLength(8);
    p.pronostico.forEach((punto) => {
      expect(punto.unidades).toBeCloseTo(5, 1);
      expect(punto.inferior).toBeLessThanOrEqual(punto.unidades);
      expect(punto.superior).toBeGreaterThanOrEqual(punto.unidades);
    });
    expect(p.patron).toBe('SUAVE');
    expect(p.metricas.rmsse).toBeCloseTo(0, 2);
    expect(p.debePedir).toBe(false);
    expect(p.cantidadSugerida).toBe(0);
    expect(p.historia.semanas).toBeGreaterThanOrEqual(30);
    // La historia que dibuja el gráfico es la misma que vio el modelo.
    expect(p.historia.serie.slice(-30).every((semana) => semana.unidades === 5)).toBe(true);
    expect(p.aviso).toBeNull();
  });

  test('repuesto de baja rotación: lo reconoce como intermitente y pronostica su promedio, no cero', async () => {
    const p = await prediccionDe(escaso);

    expect(p.patron).toBe('INTERMITENTE');
    expect(p.adi).toBeCloseTo(4, 0);
    expect(p.demandaTotal).toBeGreaterThan(1);
    expect(p.demandaTotal).toBeLessThan(4);
    expect(p.claseAbc).toBe('A');
    expect(p.diasDeCobertura).toBeGreaterThan(30);
  });

  test('repuesto que nunca se ha usado: sin modelo, sin sugerencia de compra y con un aviso claro', async () => {
    const p = await prediccionDe(sinUso);

    expect(p).toMatchObject({ modelo: 'SIN_HISTORIA', patron: 'SIN_CONSUMO', cantidadSugerida: 0, debePedir: false, demandaTotal: 0 });
    expect(p.aviso).toBe('Sin consumo registrado: todavía no hay con qué pronosticar.');
    expect(p.pronostico.every((punto) => punto.unidades === 0)).toBe(true);
  });

  test('los textos con tildes llegan intactos de Python a la base de datos (UTF-8 de punta a punta)', async () => {
    const p = await prediccionDe(sinUso);

    expect(p.aviso).toContain('todavía');
    expect(p.modeloNombre).toBe('Sin modelo');
    expect((await prediccionDe(estable)).patronDescripcion).toBe('Se usa casi todas las semanas y en cantidades parecidas');
  });

  describe('el motor por separado', () => {
    // Arrancar Python puede tardar varios segundos cuando todas las suites corren a la vez.
    jest.setTimeout(60000);

    test('comprobar informa que el modelo está disponible y su versión', async () => {
      expect(await crearMotorPython().comprobar()).toEqual({ disponible: true, version: expect.stringMatching(/^taller_prediccion \d+\.\d+\.\d+$/) });
    });

    test('si el modelo rechaza los datos, el error trae su explicación en español', async () => {
      await expect(crearMotorPython().predecir({ version: 99, repuestos: [] })).rejects.toMatchObject({
        codigo: 'ENTRADA_INVALIDA',
        message: expect.stringContaining('El modelo rechazó los datos: Versión del contrato no soportada'),
      });
    });

    test('si el modelo se pasa del tiempo límite, se detiene y se informa', async () => {
      const motor = crearMotorPython({ tiempoLimiteMs: 1 });

      await expect(motor.predecir({ version: 1, fechaDeCorte: '2026-10-12', repuestos: [] })).rejects.toMatchObject({ codigo: 'TIEMPO_AGOTADO' });
    });

    test('un catálogo vacío es una entrada válida', async () => {
      const salida = await crearMotorPython().predecir({ version: 1, fechaDeCorte: '2026-10-12', repuestos: [] });

      expect(salida.repuestos).toEqual([]);
      expect(salida.resumen.repuestos).toBe(0);
    });
  });
});
