/**
 * PRUEBA DE ACEPTACIÓN — HU-09 Predicción de demanda de repuestos (administrador) · Sprint 3
 *
 * Criterio: el administrador obtiene, a partir del historial de consumo, un
 * pronóstico de la demanda de cada repuesto y una recomendación de compra;
 * la predicción se integra con las alertas de stock.
 *
 * Prueba de funcionalidad del sprint: "con historial de consumo cargado,
 * ejecutar el modelo y verificar que proyecte la demanda de las próximas
 * semanas y avise de los repuestos que se van a agotar".
 *
 * Usa el modelo real (Python). Sin el entorno instalado se omite con un
 * aviso; en el pipeline es obligatoria. Ver ADR-19 y ADR-20.
 */
const { crearContexto } = require('../helpers/contexto');
const { describirConPython } = require('../helpers/motor-simulado');
const { repuestoConHistoria } = require('../helpers/historia');

describirConPython('HU-09 · Criterio de aceptación: el modelo proyecta la demanda y avisa de lo que se va a agotar', () => {
  async function ejecutarPrediccion(ctx, cliente) {
    const res = await cliente.post('/api/prediccion/ejecuciones').send({});
    await ctx.servicios.prediccion.esperar();
    return res;
  }

  test('Escenario 1 — Dado un repuesto con 30 semanas de consumo de unas 6 unidades por semana, Cuando el administrador ejecuta la predicción, Entonces obtiene la demanda proyectada de las próximas 8 semanas (cerca de 6 por semana) y cuánto pedir', async () => {
    // Dado
    const ctx = crearContexto();
    const admin = ctx.como('administrador');
    const filtro = await repuestoConHistoria(ctx, {
      unidadesPorSemana: [6, 5, 7, 6, 6, 5, 7, 6, 5, 6, 7, 6, 6, 5, 7, 6, 5, 6, 7, 6, 6, 5, 7, 6, 5, 6, 7, 6, 6, 5], stockFinal: 8, stockMinimo: 2,
    });

    // Cuando
    const res = await ejecutarPrediccion(ctx, admin);

    // Entonces
    expect(res.status).toBe(202);
    const { body: prediccion } = await admin.get(`/api/prediccion/repuestos/${filtro.id}`);
    expect(prediccion.ejecucion.estado).toBe('COMPLETADA');
    expect(prediccion.pronostico).toHaveLength(8);
    prediccion.pronostico.forEach((semana) => {
      expect(semana.unidades).toBeGreaterThan(5);
      expect(semana.unidades).toBeLessThan(7);
    });
    expect(prediccion.demandaTotal).toBeGreaterThan(40);
    expect(prediccion.demandaTotal).toBeLessThan(56);
    // Con 8 en stock y unas 6 por semana, hay que pedir.
    expect(prediccion.debePedir).toBe(true);
    expect(prediccion.cantidadSugerida).toBeGreaterThan(20);
    expect(prediccion.fechaDeQuiebre).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 120000);

  test('Escenario 2 — Dado un repuesto que está por encima de su mínimo pero se agotaría antes de que llegue un pedido, Cuando se ejecuta la predicción, Entonces se genera la alerta "Se agotará pronto" y el dueño recibe la notificación', async () => {
    // Dado: consume 7 por semana, quedan 5 (mínimo 2) y un pedido tarda 14 días.
    const ctx = crearContexto();
    const dueno = ctx.como('dueno');
    await repuestoConHistoria(ctx, { unidadesPorSemana: Array(26).fill(7), stockFinal: 5, stockMinimo: 2, diasReposicion: 14 });
    expect((await dueno.get('/api/alertas')).body.datos).toEqual([]);

    // Cuando
    await ejecutarPrediccion(ctx, ctx.como('administrador'));

    // Entonces
    const { datos: alertas } = (await dueno.get('/api/alertas')).body;
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ tipo: 'QUIEBRE_PROYECTADO', tipoNombre: 'Se agotará pronto', repuesto: { stockActual: 5, stockMinimo: 2 } });
    expect(alertas[0].detalle).toMatch(/^al ritmo previsto se agota en 5 días y un pedido tarda 14 días\. Sugerido: pedir \d+\.$/);
    expect(alertas[0].prediccion.cantidadSugerida).toBeGreaterThan(30);
    const { datos: avisos } = (await dueno.get('/api/notificaciones')).body;
    expect(avisos[0]).toMatchObject({ titulo: 'Se agotará pronto: FIL-ACE-001', vista: 'alertas', leida: false });
  }, 120000);

  test('Escenario 3 — Dado un repuesto con stock para varios meses, Cuando se ejecuta la predicción, Entonces no se sugiere comprar ni se genera ninguna alerta', async () => {
    // Dado
    const ctx = crearContexto();
    const admin = ctx.como('administrador');
    const filtro = await repuestoConHistoria(ctx, { unidadesPorSemana: Array(26).fill(3), stockFinal: 120, stockMinimo: 5 });

    // Cuando
    await ejecutarPrediccion(ctx, admin);

    // Entonces
    const { body: prediccion } = await admin.get(`/api/prediccion/repuestos/${filtro.id}`);
    expect(prediccion.debePedir).toBe(false);
    expect(prediccion.cantidadSugerida).toBe(0);
    expect(prediccion.quiebreAntesDeReponer).toBe(false);
    expect((await ctx.como('dueno').get('/api/alertas')).body.datos).toEqual([]);
  }, 120000);

  test('Escenario 4 — Dado un mecánico, Cuando intenta ejecutar o consultar la predicción, Entonces la API responde 403: es una función del administrador y del dueño', async () => {
    // Dado
    const ctx = crearContexto();
    const mecanico = ctx.como('mecanico');

    // Cuando
    const ejecutar = await mecanico.post('/api/prediccion/ejecuciones').send({});
    const consultar = await mecanico.get('/api/prediccion/resumen');

    // Entonces
    expect(ejecutar.status).toBe(403);
    expect(consultar.status).toBe(403);
  });
});
