const { crearContexto } = require('../helpers/contexto');
const { abrirNavegador } = require('../helpers/navegador');
const { crearMotorSimulado } = require('../helpers/motor-simulado');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('Interfaz · predicción de demanda integrada con inventario, alertas y sistema (HU-09)', () => {
  let ctx;
  let nav;
  let dueno;
  let filtro;

  beforeEach(async () => {
    ctx = crearContexto({ motorDePrediccion: crearMotorSimulado() });
    dueno = ctx.como('dueno');
    filtro = (await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 10, stockMinimo: 1 }))).body;
    nav = await abrirNavegador(ctx.app);
  });

  afterEach(async () => {
    await nav.cerrar();
    expect(nav.errores).toEqual([]);
  });

  /** Consumo de la semana pasada y una ejecución de la predicción. */
  async function consumirYPredecir(cantidad) {
    const mecanico = ctx.como('mecanico');
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad }] });
    ctx.db.prepare("UPDATE detalle_repuestos SET creado_en = datetime('now', '-7 days')").run();
    await ctx.como('administrador').post('/api/prediccion/ejecuciones').send({});
    await ctx.servicios.prediccion.esperar();
  }

  test('el formulario del inventario permite indicar cuántos días tarda en llegar un pedido', async () => {
    await nav.iniciarSesion(ctx.usuario('dueno'));
    nav.clic('#menu a[data-vista="inventario"]');
    await nav.esperar(() => nav.$$('#cuerpo-tabla tr').length === 1, 'el catálogo');
    expect(nav.$('#diasReposicion').value).toBe('7');

    nav.clic(nav.$('#cuerpo-tabla button[data-accion="editar"]'));
    nav.escribir('#diasReposicion', '21');
    nav.enviar('#formulario');
    await nav.esperar(() => /guardado/.test(nav.$('#aviso-formulario').textContent), 'la confirmación');

    expect((await dueno.get(`/api/repuestos/${filtro.id}`)).body.diasReposicion).toBe(21);
    // Al volver al modo "nuevo repuesto", el campo retoma su valor por defecto.
    expect(nav.$('#diasReposicion').value).toBe('7');
  });

  test('un valor fuera de rango muestra el error junto al campo', async () => {
    await nav.iniciarSesion(ctx.usuario('dueno'));
    nav.clic('#menu a[data-vista="inventario"]');
    await nav.esperar(() => nav.$$('#cuerpo-tabla tr').length === 1, 'el catálogo');

    nav.clic(nav.$('#cuerpo-tabla button[data-accion="editar"]'));
    nav.escribir('#diasReposicion', '500');
    nav.enviar('#formulario');

    await nav.esperar(() => nav.$('[data-error="diasReposicion"]').textContent !== '', 'el error');
    expect(nav.$('[data-error="diasReposicion"]').textContent).toBe('Los días de reposición deben estar entre 1 y 180');
  });

  test('la alerta "Se agotará pronto" aparece en la vista de alertas con la cantidad que sugiere el modelo', async () => {
    await consumirYPredecir(7);
    await nav.iniciarSesion(ctx.usuario('dueno'));
    nav.clic('#menu a[data-vista="alertas"]');
    await nav.esperar(() => nav.$('#cuerpo-alertas tr[data-alerta]'), 'la alerta proyectada');

    const fila = nav.$('#cuerpo-alertas tr[data-alerta]');
    expect(fila.querySelector('.estado').textContent).toBe('Se agotará pronto');
    expect(fila.querySelector('.estado').className).toContain('alerta--quiebre_proyectado');
    expect(fila.textContent).toContain('al ritmo previsto se agota en 3 días y un pedido tarda 7 días');
    expect(fila.querySelector('.sugerencia').textContent).toBe('Sugerido: pedir 34');
  });

  test('sin predicción calculada, las alertas no muestran sugerencia', async () => {
    const mecanico = ctx.como('mecanico');
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 9 }] });
    await nav.iniciarSesion(ctx.usuario('dueno'));
    nav.clic('#menu a[data-vista="alertas"]');
    await nav.esperar(() => nav.$('#cuerpo-alertas tr[data-alerta]'), 'la alerta de stock bajo');

    expect(nav.$('#cuerpo-alertas .sugerencia')).toBeNull();
  });

  test('Administración > Sistema informa el estado de la predicción', async () => {
    await consumirYPredecir(7);
    await nav.iniciarSesion(ctx.usuario('administrador'));
    nav.clic('#pestana-sistema');
    await nav.esperar(() => nav.$$('#ficha-sistema dt').length > 0, 'el estado del sistema');

    const ficha = Object.fromEntries(nav.textos('#ficha-sistema dt').map((dt, i) => [dt, nav.textos('#ficha-sistema dd')[i]]));
    expect(ficha['Predicción de demanda']).toMatch(/^motor_simulado 0\.0\.0 · Python ninguno, última ejecución completada el /);
  });
});
