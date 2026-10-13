const { crearContexto } = require('../helpers/contexto');
const { describirConPython } = require('../helpers/motor-simulado');
const { repuestoConHistoria } = require('../helpers/historia');
const { crearMotorPython } = require('../../src/modules/prediccion/motor-python');
const { aplicarPolitica } = require('../../src/modules/prediccion/politica');

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

  /**
   * La aplicación repite la política de inventario del modelo cada vez que
   * muestra una recomendación, con el stock del momento (politica.js). Con
   * el stock y la fecha del cálculo, las dos versiones tienen que coincidir.
   */
  describe('la política de la aplicación da lo mismo que la del modelo', () => {
    jest.setTimeout(120000);

    /** Catálogo variado y siempre igual: demanda alta, media y esporádica, con distintos stocks y plazos. */
    function catalogo(corte) {
      let semilla = 20261012;
      const azar = () => {
        semilla = (semilla * 1103515245 + 12345) % 2147483648;
        return semilla / 2147483648;
      };
      const lunes = new Date(`${corte}T00:00:00Z`);
      lunes.setUTCDate(lunes.getUTCDate() - ((lunes.getUTCDay() + 6) % 7));
      const semana = (haceSemanas) => new Date(lunes.getTime() - haceSemanas * 7 * 86400000).toISOString().slice(0, 10);

      return Array.from({ length: 18 }, (_, i) => {
        const nivel = [9, 3, 0.4][i % 3];
        const semanas = 20 + Math.floor(azar() * 50);
        const consumo = [];
        for (let hace = semanas; hace >= 1; hace -= 1) {
          const hay = nivel >= 1 || azar() < nivel;
          if (hay) consumo.push({ semana: semana(hace), unidades: Math.max(1, Math.round(nivel * (0.4 + azar() * 1.2))) });
        }
        return {
          id: i + 1, sku: `CON-${i + 1}`, costo: 1000 * (i + 1), stockMinimo: 2, stockActual: Math.floor(azar() * 40),
          diasDeReposicion: 1 + Math.floor(azar() * 30), primeraSemana: semana(semanas), consumo,
        };
      });
    }

    test.each([['lunes', '2026-10-12'], ['jueves', '2026-10-15'], ['domingo', '2026-10-18']])(
      'calculando un %s, cada decisión del modelo se reproduce con su pronóstico publicado',
      async (_, corte) => {
        const repuestos = catalogo(corte);
        const salida = await crearMotorPython().predecir({ version: 1, fechaDeCorte: corte, horizonteSemanas: 8, nivelDeServicio: 0.95, repuestos });

        expect(salida.repuestos).toHaveLength(18);
        salida.repuestos.forEach((r, i) => {
          const deLaAplicacion = aplicarPolitica({
            pronostico: r.pronostico.map((punto) => punto.unidades),
            primeraSemana: r.pronostico[0].semana,
            hoy: corte,
            stockActual: repuestos[i].stockActual,
            diasDeReposicion: repuestos[i].diasDeReposicion,
            stockDeSeguridad: r.stockDeSeguridad,
          });
          const delModelo = {
            demandaEnReposicion: r.demandaEnReposicion,
            puntoDeReorden: r.puntoDeReorden,
            cantidadSugerida: r.cantidadSugerida,
            debePedir: r.debePedir,
            diasDeCobertura: r.diasDeCobertura,
            fechaDeQuiebre: r.fechaDeQuiebre,
            quiebreAntesDeReponer: r.quiebreAntesDeReponer,
          };

          expect({ sku: r.sku, ...deLaAplicacion }).toEqual({ sku: r.sku, ...delModelo });
          if (r.debePedir) expect(r.cantidadSugerida).toBeGreaterThanOrEqual(1);
        });
        // El catálogo de prueba ejercita los dos caminos: repuestos por pedir y repuestos con stock de sobra.
        expect(new Set(salida.repuestos.map((r) => r.debePedir)).size).toBe(2);
      },
    );
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
