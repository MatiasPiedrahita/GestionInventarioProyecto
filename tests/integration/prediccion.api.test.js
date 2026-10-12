const { crearContexto } = require('../helpers/contexto');
const { crearMotorSimulado } = require('../helpers/motor-simulado');
const { ordenValida, repuestoValido } = require('../helpers/datos');
const { ErrorDelModelo } = require('../../src/modules/prediccion/motor-python');

/**
 * Estas pruebas usan un motor simulado: verifican qué datos le envía la
 * aplicación al modelo y qué hace con su respuesta. El modelo real se prueba
 * con pytest y con la prueba de contrato (prediccion.python.test.js).
 */
describe('Predicción de demanda: integración con la aplicación (motor simulado)', () => {
  let motor;
  let ctx;
  let admin;
  let dueno;
  let mecanico;
  let filtro;

  function iniciarTaller(opcionesDelMotor) {
    motor = crearMotorSimulado(opcionesDelMotor);
    ctx = crearContexto({ motorDePrediccion: motor });
    admin = ctx.como('administrador');
    dueno = ctx.como('dueno');
    mecanico = ctx.como('mecanico');
  }

  /** Registra consumo del repuesto en una orden nueva. haceDias lo ubica en el pasado. */
  async function consumir(repuesto, cantidad, { haceDias = 0, cancelar = false } = {}) {
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: repuesto.id, cantidad }] });
    if (haceDias) ctx.db.prepare("UPDATE detalle_repuestos SET creado_en = datetime('now', ?) WHERE orden_id = ?").run(`-${haceDias} days`, orden.id);
    if (cancelar) await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'CANCELADA', motivo: 'El cliente desistió' });
    return orden;
  }

  async function ejecutar(cliente = admin, cuerpo = {}) {
    const res = await cliente.post('/api/prediccion/ejecuciones').send(cuerpo);
    await ctx.servicios.prediccion.esperar();
    return res;
  }

  const resumen = async (cliente = admin) => (await cliente.get('/api/prediccion/resumen')).body;
  const alertas = async () => (await dueno.get('/api/alertas')).body.datos;

  beforeEach(async () => {
    iniciarTaller();
    filtro = (await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 10, stockMinimo: 1, diasReposicion: 7 }))).body;
  });

  describe('permisos', () => {
    test.each([['mecanico'], ['recepcionista']])('%s no puede ejecutar ni consultar la predicción (403); sin sesión, 401', async (rol) => {
      const cliente = ctx.como(rol);
      const respuestas = await Promise.all([
        cliente.post('/api/prediccion/ejecuciones').send({}),
        cliente.get('/api/prediccion/ejecuciones'),
        cliente.get('/api/prediccion/estado'),
        cliente.get('/api/prediccion/resumen'),
        cliente.get(`/api/prediccion/repuestos/${filtro.id}`),
        cliente.patch(`/api/repuestos/${filtro.id}/minimo-sugerido`),
      ]);

      expect(respuestas.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);
      expect((await ctx.anonimo().get('/api/prediccion/resumen')).status).toBe(401);
      expect(motor.llamadas).toHaveLength(0);
    });

    test('el dueño también puede ejecutarla', async () => {
      expect((await ejecutar(dueno)).status).toBe(202);
    });
  });

  describe('ejecución', () => {
    test('responde 202 de inmediato con la ejecución en curso y, al terminar, queda completada con sus datos', async () => {
      await consumir(filtro, 7);

      const res = await admin.post('/api/prediccion/ejecuciones').send({});
      expect(res.status).toBe(202);
      expect(res.headers.location).toBe(`/api/prediccion/ejecuciones/${res.body.id}`);
      expect(res.body).toMatchObject({ estado: 'EN_CURSO', origen: 'MANUAL', iniciadaPor: 'Administrador de Prueba', horizonteSemanas: 8, nivelDeServicio: 0.95, repuestos: 1 });

      await ctx.servicios.prediccion.esperar();
      const terminada = (await admin.get(`/api/prediccion/ejecuciones/${res.body.id}`)).body;
      expect(terminada).toMatchObject({
        estado: 'COMPLETADA', error: null, motor: { nombre: 'motor_simulado' }, resumen: { repuestos: 1, porPedir: 1 },
      });
      expect(terminada.duracionMs).toEqual(expect.any(Number));
      expect(terminada.finalizadaEn).toEqual(expect.any(String));
    });

    test('mientras hay una ejecución en curso no se puede lanzar otra (409) y /estado lo informa', async () => {
      const liberar = motor.detener();
      const primera = await admin.post('/api/prediccion/ejecuciones').send({});

      const segunda = await dueno.post('/api/prediccion/ejecuciones').send({});
      const estado = (await admin.get('/api/prediccion/estado')).body;

      expect(segunda.status).toBe(409);
      expect(segunda.body.mensaje).toBe('Ya hay una predicción en curso. Espere a que termine.');
      expect(estado.enCurso).toMatchObject({ id: primera.body.id, estado: 'EN_CURSO' });
      expect(estado.ultimaCompletada).toBeNull();

      liberar();
      await ctx.servicios.prediccion.esperar();
      expect((await admin.get('/api/prediccion/estado')).body).toMatchObject({ enCurso: null, ultimaCompletada: { id: primera.body.id } });
      expect((await ejecutar()).status).toBe(202);
    });

    test('valida los parámetros (400) y los envía al modelo cuando son válidos', async () => {
      const invalida = await admin.post('/api/prediccion/ejecuciones').send({ horizonteSemanas: 2, nivelDeServicio: 1.5 });
      await ejecutar(admin, { horizonteSemanas: 12, nivelDeServicio: 0.9 });

      expect(invalida.status).toBe(400);
      expect(invalida.body.detalles.map((d) => d.campo)).toEqual(['horizonteSemanas', 'nivelDeServicio']);
      expect(motor.llamadas).toHaveLength(1);
      expect(motor.llamadas[0]).toMatchObject({ version: 1, horizonteSemanas: 12, nivelDeServicio: 0.9 });
      expect((await resumen()).ejecucion).toMatchObject({ horizonteSemanas: 12, nivelDeServicio: 0.9 });
    });

    test('si el modelo falla, la ejecución queda como fallida con un mensaje claro y la aplicación sigue funcionando', async () => {
      iniciarTaller({ falla: new ErrorDelModelo('Al Python que ejecuta el modelo le falta la librería statsmodels. Prepare el entorno con: npm run prediccion:instalar') });

      const res = await ejecutar();

      const fallida = (await admin.get(`/api/prediccion/ejecuciones/${res.body.id}`)).body;
      expect(res.status).toBe(202);
      expect(fallida).toMatchObject({ estado: 'FALLIDA', error: expect.stringContaining('le falta la librería statsmodels') });
      expect((await resumen()).ejecucion).toBeNull();
      expect((await admin.get('/api/repuestos')).status).toBe(200);
      // El fallo no deja el sistema bloqueado: se puede volver a intentar.
      expect((await ejecutar()).status).toBe(202);
    });

    test('una ejecución que quedó "en curso" porque el servidor se apagó no bloquea las siguientes', async () => {
      ctx.db.prepare(`
        INSERT INTO ejecuciones_prediccion (origen, fecha_de_corte, horizonte_semanas, nivel_de_servicio, iniciada_en)
        VALUES ('MANUAL', '2026-01-01', 8, 0.95, datetime('now', '-2 hours'))`).run();

      const res = await ejecutar();

      expect(res.status).toBe(202);
      const [, abandonada] = (await admin.get('/api/prediccion/ejecuciones')).body;
      expect(abandonada).toMatchObject({ estado: 'FALLIDA', error: 'La ejecución se interrumpió antes de terminar' });
    });

    test('queda en la auditoría quién la lanzó', async () => {
      const res = await ejecutar();

      expect(ctx.db.prepare("SELECT usuario_id, entidad_id, detalle FROM auditoria WHERE accion = 'PREDICCION_EJECUTADA'").get()).toEqual({
        usuario_id: ctx.usuario('administrador').id, entidad_id: res.body.id, detalle: '1 repuestos, horizonte de 8 semanas',
      });
    });

    test('solo se conservan las 12 ejecuciones más recientes con su detalle', async () => {
      for (let i = 0; i < 14; i += 1) await ejecutar();

      const ejecuciones = (await admin.get('/api/prediccion/ejecuciones')).body;
      expect(ejecuciones).toHaveLength(12);
      expect(ctx.db.prepare('SELECT COUNT(DISTINCT ejecucion_id) AS n FROM predicciones_demanda').get().n).toBe(12);
      expect((await admin.get('/api/prediccion/ejecuciones/1')).status).toBe(404);
    });
  });

  describe('datos que se le envían al modelo (la tubería de datos)', () => {
    test('envía cada repuesto activo con su stock, su costo, sus días de reposición y su consumo por semana', async () => {
      await dueno.put(`/api/repuestos/${filtro.id}`).send(repuestoValido({ stockActual: 30, stockMinimo: 4, diasReposicion: 15 }));
      await consumir(filtro, 3, { haceDias: 14 });
      await consumir(filtro, 2, { haceDias: 14 });
      await consumir(filtro, 6, { haceDias: 7 });

      await ejecutar();

      const [entrada] = motor.llamadas;
      expect(entrada.fechaDeCorte).toBe(new Date().toISOString().slice(0, 10));
      expect(entrada.repuestos).toHaveLength(1);
      expect(entrada.repuestos[0]).toMatchObject({
        id: filtro.id, sku: 'FIL-ACE-001', stockActual: 19, stockMinimo: 4, costo: 28500, diasDeReposicion: 15, primeraSemana: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
      // Dos órdenes de la misma semana se suman; las semanas son lunes.
      expect(entrada.repuestos[0].consumo.map((c) => c.unidades)).toEqual([5, 6]);
      entrada.repuestos[0].consumo.forEach((c) => expect(new Date(`${c.semana}T00:00:00Z`).getUTCDay()).toBe(1));
    });

    test('los repuestos devueltos por órdenes canceladas no cuentan como consumo', async () => {
      await consumir(filtro, 4, { haceDias: 7 });
      await consumir(filtro, 5, { haceDias: 7, cancelar: true });

      await ejecutar();

      expect(motor.llamadas[0].repuestos[0].consumo.map((c) => c.unidades)).toEqual([4]);
    });

    test('no envía los repuestos dados de baja, y un repuesto sin consumo va con la lista vacía', async () => {
      const { body: retirado } = await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'VIEJO-1', nombre: 'Descontinuado' }));
      await dueno.delete(`/api/repuestos/${retirado.id}`);

      await ejecutar();

      expect(motor.llamadas[0].repuestos.map((r) => [r.sku, r.consumo])).toEqual([['FIL-ACE-001', []]]);
    });
  });

  describe('resultados', () => {
    test('el resumen trae la predicción de cada repuesto con sus datos actuales', async () => {
      await consumir(filtro, 7, { haceDias: 7 });
      await ejecutar();

      const { ejecucion, predicciones, enCurso } = await resumen();

      expect(ejecucion.estado).toBe('COMPLETADA');
      expect(enCurso).toBeNull();
      expect(predicciones).toHaveLength(1);
      expect(predicciones[0]).toMatchObject({
        repuesto: { id: filtro.id, sku: 'FIL-ACE-001', stockActual: 3, stockMinimo: 1, diasReposicion: 7 },
        patron: 'SUAVE',
        modelo: 'MEDIA_MOVIL',
        modeloNombre: 'Media móvil de 8 semanas',
        metricas: { rmsse: 0.8, mejoraSobreIngenuo: 0.2, semanasDePrueba: 52 },
        demandaTotal: 56,
        puntoDeReorden: 8,
        cantidadSugerida: 34,
        debePedir: true,
        diasDeCobertura: 3,
        quiebreAntesDeReponer: true,
        stockAlCalcular: 3,
        claseAbc: 'A',
      });
      expect(predicciones[0].comparados).toHaveLength(2);
    });

    test('sin ninguna ejecución, el resumen viene vacío y el detalle responde 404 con una explicación', async () => {
      expect(await resumen()).toEqual({ ejecucion: null, predicciones: [], enCurso: null });
      const detalle = await admin.get(`/api/prediccion/repuestos/${filtro.id}`);
      expect(detalle.status).toBe(404);
      expect(detalle.body.mensaje).toBe('Todavía no se ha ejecutado la predicción de demanda');
    });

    test('el detalle trae el pronóstico semana a semana y la historia con las semanas sin consumo en cero', async () => {
      await consumir(filtro, 4, { haceDias: 21 });
      await consumir(filtro, 2, { haceDias: 7 });
      iniciarMotorConHistoriaDe(3);
      await ejecutar();

      const { body } = await admin.get(`/api/prediccion/repuestos/${filtro.id}`);

      expect(body.pronostico).toHaveLength(8);
      expect(body.pronostico[0]).toEqual({ semana: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), unidades: 3, inferior: 2, superior: 4 });
      expect(body.pronostico.map((p) => p.semana)).toEqual([...body.pronostico.map((p) => p.semana)].sort());
      expect(body.historia.serie.map((h) => h.unidades)).toEqual([4, 0, 2]);
      // La historia termina la semana anterior a la primera del pronóstico.
      const ultima = new Date(`${body.historia.serie[2].semana}T00:00:00Z`).getTime();
      expect(new Date(`${body.pronostico[0].semana}T00:00:00Z`).getTime() - ultima).toBe(7 * 24 * 3600 * 1000);
      expect(body.ejecucion.estado).toBe('COMPLETADA');
    });

    test('un repuesto creado después de la última ejecución todavía no tiene predicción (404)', async () => {
      await ejecutar();
      const { body: nuevo } = await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'NUEVO-1', nombre: 'Recién llegado' }));

      const res = await admin.get(`/api/prediccion/repuestos/${nuevo.id}`);

      expect(res.status).toBe(404);
      expect(res.body.mensaje).toMatch(/todavía no tiene predicción/);
      expect((await admin.get('/api/prediccion/repuestos/abc')).status).toBe(400);
    });

    test('si un repuesto se da de baja después de calcular, deja de aparecer en el resumen', async () => {
      await ejecutar();
      await dueno.delete(`/api/repuestos/${filtro.id}`);

      expect((await resumen()).predicciones).toEqual([]);
    });

    test('si el modelo devuelve un repuesto que no se le pidió, se ignora', async () => {
      iniciarTaller();
      filtro = (await dueno.post('/api/repuestos').send(repuestoValido())).body;
      const original = motor.predecir.bind(motor);
      motor.predecir = async (entrada) => {
        const salida = await original(entrada);
        return { ...salida, repuestos: [...salida.repuestos, { ...salida.repuestos[0], id: 9999 }] };
      };

      await ejecutar();

      expect((await resumen()).predicciones.map((p) => p.repuesto.id)).toEqual([filtro.id]);
    });

    test('una respuesta del modelo sin la lista de repuestos deja la ejecución como fallida', async () => {
      motor.predecir = async () => ({ version: 1 });

      const res = await ejecutar();

      expect((await admin.get(`/api/prediccion/ejecuciones/${res.body.id}`)).body).toMatchObject({
        estado: 'FALLIDA', error: 'La respuesta del modelo no trae la lista de repuestos',
      });
    });
  });

  /** Hace que el motor simulado informe cierta cantidad de semanas de historia (define el largo del gráfico). */
  function iniciarMotorConHistoriaDe(semanas) {
    const original = motor.predecir.bind(motor);
    motor.predecir = async (entrada) => {
      const salida = await original(entrada);
      return { ...salida, repuestos: salida.repuestos.map((r) => ({ ...r, historia: { ...r.historia, semanas } })) };
    };
  }

  describe('integración con las alertas de stock', () => {
    test('un repuesto sobre su mínimo que se agotaría antes de reponerlo genera la alerta "Se agotará pronto" y avisa al dueño', async () => {
      await consumir(filtro, 7, { haceDias: 7 });
      expect(await alertas()).toEqual([]);

      await ejecutar();

      const [alerta] = await alertas();
      expect(alerta).toMatchObject({
        tipo: 'QUIEBRE_PROYECTADO',
        tipoNombre: 'Se agotará pronto',
        estado: 'ACTIVA',
        detalle: 'al ritmo previsto se agota en 3 días y un pedido tarda 7 días. Sugerido: pedir 34.',
        repuesto: { sku: 'FIL-ACE-001', stockActual: 3, stockMinimo: 1 },
      });
      const { datos } = (await dueno.get('/api/notificaciones')).body;
      expect(datos[0]).toMatchObject({
        tipo: 'QUIEBRE_PROYECTADO',
        titulo: 'Se agotará pronto: FIL-ACE-001',
        mensaje: 'Filtro de aceite Mann W712: al ritmo previsto se agota en 3 días y un pedido tarda 7 días. Sugerido: pedir 34.',
        vista: 'alertas',
      });
    });

    test('volver a ejecutar no duplica la alerta ni el aviso: solo actualiza su texto', async () => {
      await consumir(filtro, 7, { haceDias: 7 });
      await ejecutar();
      await consumir(filtro, 1, { haceDias: 7 });

      await ejecutar();

      const abiertas = await alertas();
      expect(abiertas).toHaveLength(1);
      expect(abiertas[0].detalle).toBe('al ritmo previsto se agota en 1 día y un pedido tarda 7 días. Sugerido: pedir 41.');
      expect((await dueno.get('/api/notificaciones')).body.noLeidas).toBe(1);
    });

    test('cuando llega mercancía y la siguiente predicción ya no proyecta el quiebre, la alerta se resuelve', async () => {
      await consumir(filtro, 7, { haceDias: 7 });
      await ejecutar();

      await dueno.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 100 });
      await ejecutar();

      expect(await alertas()).toEqual([]);
      expect((await dueno.get('/api/alertas').query({ estado: 'RESUELTAS' })).body.datos[0].tipo).toBe('QUIEBRE_PROYECTADO');
    });

    test('si el stock llega al mínimo, la alerta real reemplaza a la proyectada', async () => {
      await consumir(filtro, 7, { haceDias: 7 });
      await ejecutar();

      await consumir(filtro, 2);

      expect((await alertas()).map((a) => a.tipo)).toEqual(['STOCK_BAJO']);
    });

    test('un repuesto que ya está en su mínimo no recibe además la alerta proyectada', async () => {
      await consumir(filtro, 9, { haceDias: 7 });
      expect((await alertas()).map((a) => a.tipo)).toEqual(['STOCK_BAJO']);

      await ejecutar();

      expect((await alertas()).map((a) => a.tipo)).toEqual(['STOCK_BAJO']);
    });

    test('cada alerta abierta muestra lo que sugiere la predicción: cuánto pedir y cuándo se agota', async () => {
      await consumir(filtro, 9, { haceDias: 7 });
      const antes = (await alertas())[0].prediccion;

      await ejecutar();

      const despues = (await alertas())[0].prediccion;
      expect(antes).toBeNull();
      expect(despues).toMatchObject({ cantidadSugerida: 47, puntoDeReorden: 10, diasDeCobertura: 0.8, debePedir: true });
      expect(despues.fechaDeQuiebre).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(despues.calculadaEn).toEqual(expect.any(String));
    });
  });

  describe('aplicar el stock mínimo sugerido', () => {
    test('pone como mínimo el punto de reorden calculado, lo deja en la auditoría y actualiza las alertas', async () => {
      await consumir(filtro, 7, { haceDias: 7 });
      await ejecutar();

      const res = await dueno.patch(`/api/repuestos/${filtro.id}/minimo-sugerido`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ stockMinimo: 8, stockActual: 3, bajoStock: true });
      expect(ctx.db.prepare("SELECT detalle FROM auditoria WHERE accion = 'REPUESTO_MINIMO'").get().detalle).toBe('FIL-ACE-001: stock mínimo de 1 a 8');
      // Con el mínimo nuevo, el stock (3) ya está por debajo: la alerta pasa a ser real.
      expect((await alertas()).map((a) => a.tipo)).toEqual(['STOCK_BAJO']);
    });

    test('aplicarlo dos veces no repite el registro de auditoría', async () => {
      await consumir(filtro, 7, { haceDias: 7 });
      await ejecutar();
      await dueno.patch(`/api/repuestos/${filtro.id}/minimo-sugerido`);

      await dueno.patch(`/api/repuestos/${filtro.id}/minimo-sugerido`);

      expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'REPUESTO_MINIMO'").get().n).toBe(1);
    });

    test('sin predicción no hay nada que aplicar (404)', async () => {
      expect((await dueno.patch(`/api/repuestos/${filtro.id}/minimo-sugerido`)).status).toBe(404);
      await ejecutar();
      expect((await dueno.patch('/api/repuestos/999/minimo-sugerido')).status).toBe(404);
    });
  });

  describe('tarea programada', () => {
    test('calcula la predicción si no hay ninguna y la marca como programada', async () => {
      const resultado = await ctx.servicios.prediccion.ejecutarSiHaceFalta();

      expect(resultado).toEqual({ ejecutada: true, estado: 'COMPLETADA' });
      expect((await resumen()).ejecucion).toMatchObject({ origen: 'PROGRAMADA', iniciadaPor: null });
    });

    test('no recalcula si la predicción vigente tiene menos de un día; sí cuando ya venció', async () => {
      await ejecutar();

      const reciente = await ctx.servicios.prediccion.ejecutarSiHaceFalta();
      ctx.db.prepare("UPDATE ejecuciones_prediccion SET finalizada_en = datetime('now', '-25 hours')").run();
      const vencida = await ctx.servicios.prediccion.ejecutarSiHaceFalta();

      expect(reciente).toEqual({ ejecutada: false, motivo: 'La predicción vigente tiene menos de un día' });
      expect(vencida).toEqual({ ejecutada: true, estado: 'COMPLETADA' });
      expect(motor.llamadas).toHaveLength(2);
    });

    test('no se ejecuta con el catálogo vacío ni si el modelo no está disponible, y no deja ejecuciones fallidas', async () => {
      await dueno.delete(`/api/repuestos/${filtro.id}`);
      const sinCatalogo = await ctx.servicios.prediccion.ejecutarSiHaceFalta();

      iniciarTaller();
      await dueno.post('/api/repuestos').send(repuestoValido());
      motor.comprobar = async () => ({ disponible: false, motivo: 'No se encontró Python' });
      const sinPython = await ctx.servicios.prediccion.ejecutarSiHaceFalta();

      expect(sinCatalogo).toEqual({ ejecutada: false, motivo: 'No hay repuestos en el catálogo' });
      expect(sinPython).toEqual({ ejecutada: false, motivo: 'No se encontró Python' });
      expect((await admin.get('/api/prediccion/ejecuciones')).body).toEqual([]);
    });

    test('si el modelo falla en la tarea programada, lo informa sin lanzar una excepción', async () => {
      iniciarTaller({ falla: new Error('Sin memoria') });
      await dueno.post('/api/repuestos').send(repuestoValido());

      expect(await ctx.servicios.prediccion.ejecutarSiHaceFalta()).toEqual({ ejecutada: true, estado: 'FALLIDA', error: 'Sin memoria' });
    });
  });

  describe('estado del sistema', () => {
    test('informa con qué motor se calcula y cómo terminó la última ejecución', async () => {
      const antes = (await admin.get('/api/sistema/estado')).body.prediccion;
      await ejecutar();
      const despues = (await admin.get('/api/sistema/estado')).body.prediccion;

      expect(antes).toEqual({ motor: 'Motor simulado (pruebas)', ultimaEjecucion: null, version: null });
      expect(despues).toMatchObject({ ultimaEjecucion: { estado: 'COMPLETADA', error: null }, version: 'motor_simulado 0.0.0 · Python ninguno' });
    });
  });
});
