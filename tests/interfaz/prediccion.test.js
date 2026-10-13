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
    expect(fila.querySelector('.sugerencia').textContent).toBe('Sugerido: pedir 35');
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

describe('Interfaz · vista "Predicción": cálculo, reportes y pronóstico por repuesto (HU-09)', () => {
  let ctx;
  let nav;
  let dueno;
  let filtro;
  let descargas;

  async function consumir(repuesto, cantidad) {
    const mecanico = ctx.como('mecanico');
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: repuesto.id, cantidad }] });
    ctx.db.prepare("UPDATE detalle_repuestos SET creado_en = datetime('now', '-7 days') WHERE orden_id = ?").run(orden.id);
  }

  async function predecir() {
    await ctx.como('administrador').post('/api/prediccion/ejecuciones').send({});
    await ctx.servicios.prediccion.esperar();
  }

  async function abrirVista(rol = 'administrador') {
    await nav.iniciarSesion(ctx.usuario(rol));
    nav.clic('#menu a[data-vista="prediccion"]');
    await nav.esperar(() => nav.$('#resumen-prediccion').textContent !== '', 'la vista de predicción');
    await nav.reposo();
  }

  const indicadores = () => Object.fromEntries(nav.$$('#indicadores-prediccion .indicador').map((t) => [
    t.querySelector('.indicador__titulo').textContent, t.querySelector('.indicador__valor').textContent.replace(/\s/g, ' '),
  ]));

  beforeEach(async () => {
    const motor = crearMotorSimulado({
      ajustar: (prediccion, repuesto) => ({ ...prediccion, historia: { ...prediccion.historia, semanasSinConsumo: repuesto.consumo.length ? 0 : 40 } }),
    });
    ctx = crearContexto({ motorDePrediccion: motor });
    dueno = ctx.como('dueno');
    filtro = (await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 10, stockMinimo: 1, proveedor: 'Autopartes del Valle' }))).body;
    await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'REF-VER-012', nombre: 'Refrigerante descontinuado', costo: 46000, stockActual: 8, stockMinimo: 0 }));
    await consumir(filtro, 7);
    nav = await abrirNavegador(ctx.app);
    // jsdom no descarga archivos: se registra lo que la página habría descargado.
    descargas = [];
    nav.window.URL.createObjectURL = () => 'blob:prueba';
    nav.window.URL.revokeObjectURL = () => {};
    nav.window.HTMLAnchorElement.prototype.click = function click() { descargas.push(this.download); };
  });

  afterEach(async () => {
    await nav.cerrar();
    expect(nav.errores).toEqual([]);
  });

  test('sin predicción explica qué hace el modelo; al calcular, la página se actualiza sola con los resultados', async () => {
    await abrirVista();
    expect(nav.visible('#prediccion-vacia')).toBe(true);
    expect(nav.visible('#contenido-prediccion')).toBe(false);
    expect(nav.$('#resumen-prediccion').textContent).toBe('Todavía no se ha calculado ninguna predicción.');

    nav.escribir('#prediccion-horizonte', '12');
    nav.enviar('#formulario-prediccion');
    await nav.esperar(() => /^Predicción lista/.test(nav.$('#aviso-prediccion').textContent), 'el aviso de que terminó', 5000);

    expect(nav.visible('#contenido-prediccion')).toBe(true);
    expect(nav.visible('#prediccion-vacia')).toBe(false);
    expect(nav.$('#aviso-prediccion').textContent).toMatch(/^Predicción lista: 2 repuestos analizados en /);
    expect(nav.$('#resumen-prediccion').textContent).toMatch(/por Administrador de Prueba, con motor_simulado 0\.0\.0\. Proyecta 12 semanas con un nivel de servicio del 95 %\.$/);
    expect(nav.$('#boton-calcular-prediccion').disabled).toBe(false);
    expect(nav.$('#boton-calcular-prediccion').textContent).toBe('Calcular predicción');
  });

  test('los indicadores resumen cuánto pedir, cuánto cuesta, lo urgente y la plata quieta', async () => {
    await predecir();
    await abrirVista();

    expect(indicadores()).toEqual({
      'Repuestos por pedir': '1',
      'Inversión sugerida': '$ 997.500',
      'Se agotan antes de reponer': '1',
      'Plata quieta': '$ 368.000',
      'Acierto del modelo': '1 de 1',
    });
    // El aviso de urgencia lleva símbolo y texto, no solo color.
    expect(nav.$('#indicadores-prediccion .indicador__nota--aviso').textContent).toBe('!No alcanzan hasta que llegue el pedido');
  });

  test('compras sugeridas: agrupa por proveedor, marca lo urgente y exporta a CSV', async () => {
    await predecir();
    await abrirVista();

    expect(nav.textos('.proveedor__cabecera h3')).toEqual(['Autopartes del Valle']);
    expect(nav.$('.proveedor__total').textContent.replace(/\s/g, ' ')).toBe('35 unidades · $ 997.500');
    const fila = nav.$('.proveedor tr[data-sku="FIL-ACE-001"]');
    expect(fila.querySelector('.estado').textContent).toBe('Urgente');
    expect(fila.querySelector('td.fuerte').textContent).toBe('35');

    nav.clic('#boton-exportar-compras');
    await nav.esperar(() => descargas.length === 1, 'la descarga');
    expect(descargas[0]).toMatch(/^compras-sugeridas-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(nav.$('#aviso-prediccion').textContent).toMatch(/^Se descargó compras-sugeridas-/);
  });

  test('sin nada por pedir lo dice y oculta la exportación', async () => {
    await dueno.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 500 });
    await predecir();
    await abrirVista();

    expect(nav.$('#lista-compras').textContent).toBe('No hay nada que pedir hoy: el stock alcanza hasta la próxima reposición.');
    expect(nav.visible('#boton-exportar-compras')).toBe(false);
  });

  test('las pestañas muestran un reporte a la vez', async () => {
    await predecir();
    await abrirVista();

    nav.clic('#pestana-pred-quietos');
    expect(nav.visible('#panel-pred-compras')).toBe(false);
    expect(nav.visible('#panel-pred-quietos')).toBe(true);
    expect(nav.$('#pestana-pred-quietos').getAttribute('aria-selected')).toBe('true');
    expect(nav.textos('#cuerpo-quietos tr td:nth-child(2)')).toEqual(['40 semanas sin usarse']);
    expect(nav.textos('#cuerpo-quietos .sku')).toEqual(['REF-VER-012']);

    nav.clic('#pestana-pred-abc');
    expect(nav.textos('#resumen-abc .insignia-abc')).toEqual(['A', 'B', 'C']);
    expect(nav.$$('#grafico-abc .barras__fila')).toHaveLength(2);
    expect(nav.textos('#grafico-abc .grafico__tabla thead th')).toEqual(['Repuesto', 'Valor consumido en un año', 'Participación']);

    nav.clic('#pestana-pred-precision');
    expect(nav.$('#resumen-precision').textContent).toMatch(/^De 1 repuesto evaluado, 1 se pronostican mejor que repitiendo la última semana\./);
    expect(nav.textos('#cuerpo-precision tr td:nth-child(3)')).toEqual(['20 %', 'Sin medir']);
    expect(nav.textos('#cuerpo-precision tr td:last-child')).toEqual(['Sin observaciones', 'Sin consumo registrado: todavía no hay con qué pronosticar.']);
  });

  test('el detalle de un repuesto dibuja su historia y su pronóstico, con leyenda, tabla y recorrido por teclado', async () => {
    await predecir();
    await abrirVista();
    nav.clic('#pestana-pred-repuestos');
    expect(nav.textos('#cuerpo-prediccion .sku')).toEqual(['FIL-ACE-001', 'REF-VER-012']);

    nav.clic(nav.$(`#cuerpo-prediccion button[data-ver="${filtro.id}"]`));
    await nav.esperar(() => nav.visible('#dialogo-prediccion') && nav.$('#grafico-prediccion svg'), 'el pronóstico');

    expect(nav.$('#titulo-prediccion').textContent).toBe('FIL-ACE-001 · Filtro de aceite Mann W712');
    const grafico = nav.$('#grafico-prediccion');
    // Dos series: leyenda obligatoria, y el pronóstico se distingue también por su franja.
    expect(nav.textos('#grafico-prediccion .grafico__leyenda li')).toEqual(['Consumo real', 'Pronóstico', 'Intervalo del 80 %']);
    expect(grafico.querySelector('.grafico__linea--estimado')).not.toBeNull();
    expect(grafico.querySelector('.grafico__franja')).not.toBeNull();
    expect(grafico.querySelector('.grafico__valor--final').textContent).toBe('7');
    // Tabla equivalente: 1 semana de historia + 8 de pronóstico.
    const filas = [...grafico.querySelectorAll('.grafico__tabla tbody tr')].map((tr) => [...tr.children].map((td) => td.textContent));
    expect(filas).toHaveLength(9);
    expect(filas[0].slice(1)).toEqual(['7', '', '', '']);
    expect(filas[1].slice(1)).toEqual(['', '7', '6', '8']);

    // Con el teclado: al enfocar muestra la última semana real; la flecha derecha pasa al pronóstico.
    const zona = grafico.querySelector('.grafico__zona');
    const recuadro = grafico.querySelector('.grafico__recuadro');
    expect(zona.getAttribute('aria-label')).toBe('Consumo de 1 semanas y pronóstico de 8. Use las flechas para recorrer las semanas.');
    zona.dispatchEvent(new nav.window.Event('focus'));
    expect(recuadro.hidden).toBe(false);
    expect(recuadro.textContent).toMatch(/^7Semana del \d+ de \w+: consumo real$/);
    zona.dispatchEvent(new nav.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(recuadro.textContent).toMatch(/^7Semana del \d+ de \w+: pronóstico \(entre 6 y 8\)$/);
    zona.dispatchEvent(new nav.window.Event('blur'));
    expect(recuadro.hidden).toBe(true);
  });

  test('la ficha explica el resultado en lenguaje del taller y compara los modelos por su nombre', async () => {
    await predecir();
    await abrirVista();
    nav.clic('#pestana-pred-repuestos');
    nav.clic(nav.$(`#cuerpo-prediccion button[data-ver="${filtro.id}"]`));
    await nav.esperar(() => nav.$$('#ficha-prediccion .ficha__dato').length > 0, 'la ficha');

    const ficha = Object.fromEntries(nav.$$('#ficha-prediccion .ficha__dato').map((d) => [
      d.querySelector('dt').textContent, [...d.querySelectorAll('dd span')].map((s) => s.textContent),
    ]));
    expect(ficha['Modelo elegido']).toEqual(['Media móvil de 8 semanas', '20 % menos de error que repetir la última semana']);
    expect(ficha['Stock actual']).toEqual(['3 unidades', 'Alcanza para: 3 días']);
    expect(ficha['Punto de reorden']).toEqual(['8 unidades', 'Incluye 1 de colchón. El pedido tarda 7 días']);
    expect(ficha['Recomendación']).toEqual(['Pedir 35', 'Se agotaría antes de que llegue el pedido']);
    expect(nav.textos('#cuerpo-comparados tr td:first-child')).toEqual(['Media móvil de 8 semanas (elegido)', 'Última semana']);
    expect(nav.$('#cuerpo-comparados tr').className).toBe('elegido');
    expect(nav.visible('#nota-prediccion')).toBe(false);
  });

  test('"Usar N como stock mínimo" aplica el punto de reorden y deja de ofrecerse', async () => {
    await predecir();
    await abrirVista();
    nav.clic('#pestana-pred-repuestos');
    nav.clic(nav.$(`#cuerpo-prediccion button[data-ver="${filtro.id}"]`));
    await nav.esperar(() => nav.visible('#boton-aplicar-minimo'), 'el botón del mínimo sugerido');
    expect(nav.$('#boton-aplicar-minimo').textContent).toBe('Usar 8 como stock mínimo (hoy es 1)');

    nav.clic('#boton-aplicar-minimo');
    await nav.esperar(() => /ahora es 8/.test(nav.$('#aviso-detalle-prediccion').textContent), 'la confirmación');

    expect((await dueno.get(`/api/repuestos/${filtro.id}`)).body.stockMinimo).toBe(8);
    expect(nav.visible('#boton-aplicar-minimo')).toBe(false);
  });

  test('un repuesto sin consumo muestra el aviso del modelo en lugar de un pronóstico engañoso', async () => {
    await predecir();
    await abrirVista();
    nav.clic('#pestana-pred-repuestos');
    nav.clic(nav.$$('#cuerpo-prediccion button[data-ver]')[1]);
    await nav.esperar(() => nav.visible('#nota-prediccion'), 'el aviso del modelo');

    expect(nav.$('#nota-prediccion').textContent).toBe('Sin consumo registrado: todavía no hay con qué pronosticar.');
    expect(nav.textos('#cuerpo-comparados td')).toEqual(['No hubo historia suficiente para comparar modelos.']);
    expect(nav.visible('#boton-aplicar-minimo')).toBe(false);
  });

  test('si el cálculo falla, la vista dice por qué y sigue mostrando la predicción anterior', async () => {
    await predecir();
    ctx.db.prepare(`
      INSERT INTO ejecuciones_prediccion (estado, origen, fecha_de_corte, horizonte_semanas, nivel_de_servicio, finalizada_en, error)
      VALUES ('FALLIDA', 'MANUAL', '2026-10-12', 8, 0.95, datetime('now'), 'No se encontró Python. Prepare el entorno con: npm run prediccion:instalar')`).run();

    await abrirVista();

    expect(nav.$('#aviso-prediccion').textContent).toBe('El último cálculo falló: No se encontró Python. Prepare el entorno con: npm run prediccion:instalar');
    expect(nav.visible('#contenido-prediccion')).toBe(true);
  });

  test('el panel del dueño suma la tarjeta de compras sugeridas cuando hay predicción', async () => {
    await predecir();
    await nav.iniciarSesion(ctx.usuario('dueno'));
    await nav.esperar(() => nav.$$('#indicadores-panel .indicador').length === 5, 'los indicadores del panel');

    const titulos = nav.textos('#indicadores-panel .indicador__titulo');
    expect(titulos[4]).toBe('Compras sugeridas');
    expect(nav.textos('#indicadores-panel .indicador__valor')[4].replace(/\s/g, ' ')).toBe('$ 997.500');
  });

  test('el mecánico y la recepcionista no tienen la sección de predicción', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'));

    expect(nav.textos('#menu a')).not.toContain('Predicción');
    nav.window.location.hash = '#prediccion';
    await nav.esperar(() => nav.window.location.hash === '#ordenes', 'la redirección');
  });
});
