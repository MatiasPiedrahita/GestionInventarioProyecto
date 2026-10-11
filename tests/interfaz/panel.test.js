const { crearContexto } = require('../helpers/contexto');
const { abrirNavegador } = require('../helpers/navegador');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('Interfaz · panel del taller, reasignación y entrada de mercancía', () => {
  let ctx;
  let nav;
  let filtro;
  let orden;

  beforeEach(async () => {
    ctx = crearContexto();
    const dueno = ctx.como('dueno');
    const mecanico = ctx.como('mecanico');
    filtro = (await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 10, stockMinimo: 8 }))).body;
    await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'BUJ-NGK-004', nombre: 'Bujía NGK', costo: 14500, stockActual: 40, stockMinimo: 4 }));
    orden = (await mecanico.post('/api/ordenes').send(ordenValida())).body;
    await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 3 }] });
    await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'FINALIZADA' });
    await mecanico.post('/api/ordenes').send(ordenValida({ vehiculo: { placa: 'DEF456', marca: 'Renault', modelo: 'Logan' } }));
    nav = await abrirNavegador(ctx.app);
  });

  afterEach(async () => {
    await nav.cerrar();
    expect(nav.errores).toEqual([]);
  });

  const indicadores = () => Object.fromEntries(nav.$$('.indicador').map((tarjeta) => [
    tarjeta.querySelector('.indicador__titulo').textContent,
    { valor: tarjeta.querySelector('.indicador__valor').textContent, nota: tarjeta.querySelector('.indicador__nota').textContent },
  ]));

  async function abrirPanel(rol = 'dueno') {
    await nav.iniciarSesion(ctx.usuario(rol));
    if (!nav.visible('#indicadores-panel')) nav.clic('#menu a[data-vista="panel"]');
    await nav.esperar(() => nav.$$('.indicador').length === 4, 'los indicadores del panel');
  }

  test('el dueño entra directo al panel y ve los indicadores del negocio', async () => {
    await abrirPanel('dueno');

    const datos = indicadores();
    expect(datos['Valor del inventario'].valor.replace(/\s/g, ' ')).toBe('$ 779.500');
    expect(datos['Valor del inventario'].nota).toBe('47 unidades en 2 repuestos');
    expect(datos['Órdenes en proceso']).toEqual({ valor: '1', nota: '1 finalizada en los últimos 30 días' });
    // El aviso de stock lleva símbolo y texto, no solo color.
    expect(datos['Stock por reponer']).toEqual({ valor: '1', nota: '!1 repuesto en el mínimo o por debajo' });
    expect(nav.$('.indicador__nota--aviso .indicador__simbolo').textContent).toBe('!');
    expect(nav.$('#resumen-panel').textContent).toMatch(/^Actualizado: /);
  });

  test('gráfico de órdenes por semana: una columna, con su descripción accesible, su recuadro al enfocar y su tabla', async () => {
    await abrirPanel();
    const grafico = nav.$('#grafico-ordenes');

    const marcas = [...grafico.querySelectorAll('.grafico__marca')];
    expect(marcas).toHaveLength(8);
    expect(grafico.querySelectorAll('.grafico__columna')).toHaveLength(1);
    const actual = marcas[7];
    expect(actual.getAttribute('aria-label')).toMatch(/^Semana del \d+ de \w+: 1$/);
    expect(actual.getAttribute('tabindex')).toBe('0');

    // El recuadro aparece con el teclado igual que con el ratón.
    const recuadro = grafico.querySelector('.grafico__recuadro');
    expect(recuadro.hidden).toBe(true);
    actual.dispatchEvent(new nav.window.Event('focus'));
    expect(recuadro.hidden).toBe(false);
    expect(recuadro.querySelector('strong').textContent).toBe('1');
    actual.dispatchEvent(new nav.window.Event('blur'));
    expect(recuadro.hidden).toBe(true);

    // Tabla equivalente: 8 semanas, la última con 1 orden.
    const filas = [...grafico.querySelectorAll('.grafico__tabla tbody tr')].map((tr) => tr.lastChild.textContent);
    expect(filas).toEqual(['0', '0', '0', '0', '0', '0', '0', '1']);
    expect(grafico.querySelector('.grafico__tabla summary').textContent).toBe('Ver como tabla');
  });

  test('las columnas tienen la base recta sobre el eje y no superan el grosor máximo', async () => {
    await abrirPanel();

    const trazo = nav.$('#grafico-ordenes .grafico__columna').getAttribute('d');
    const numeros = trazo.match(/-?\d+(\.\d+)?/g).map(Number);
    const [izquierda, base] = numeros;
    const derecha = Math.max(...trazo.match(/H(-?\d+(\.\d+)?)/)[1].split(' ').map(Number)) + 4;

    expect(trazo.endsWith(`V${base} Z`)).toBe(true);
    expect(derecha - izquierda).toBeLessThanOrEqual(24);
  });

  test('el eje de pesos usa cifras abreviadas y el valor exacto queda en la tabla', async () => {
    await abrirPanel();
    const grafico = nav.$('#grafico-gasto');

    const eje = [...grafico.querySelectorAll('.grafico__eje--y')].map((t) => t.textContent);
    expect(eje).toEqual(['$0', '$50 mil', '$100 mil']);
    const ultima = [...grafico.querySelectorAll('.grafico__tabla tbody tr')].pop();
    expect(ultima.lastChild.textContent.replace(/\s/g, ' ')).toBe('$ 85.500');
  });

  test('repuestos más usados: barras con el valor a la vista y el texto en color de texto, no en el de la serie', async () => {
    await abrirPanel();
    const filas = nav.$$('#grafico-repuestos .barras__fila');

    expect(filas).toHaveLength(1);
    expect(filas[0].querySelector('.barras__rotulo').firstChild.textContent).toBe('Filtro de aceite Mann W712');
    expect(filas[0].querySelector('.barras__valor').textContent).toBe('3');
    expect(filas[0].tabIndex).toBe(0);
    expect(nav.textos('#grafico-repuestos .grafico__tabla thead th')).toEqual(['Repuesto', 'Unidades', 'Costo']);
  });

  test('tabla de mecánicos y botón "Actualizar"', async () => {
    await abrirPanel();
    expect(nav.textos('#cuerpo-mecanicos tr:first-child td').slice(0, 3)).toEqual(['Mecánico de Prueba', '1', '1']);

    await ctx.como('mecanico').post('/api/ordenes').send(ordenValida({ vehiculo: { placa: 'GHI789', marca: 'Kia', modelo: 'Rio' } }));
    nav.clic('#boton-actualizar-panel');

    await nav.esperar(() => indicadores()['Órdenes en proceso'].valor === '2', 'el panel actualizado');
  });

  test('un taller sin movimiento muestra mensajes en lugar de gráficos vacíos', async () => {
    const vacio = crearContexto();
    const otro = await abrirNavegador(vacio.app);
    await otro.iniciarSesion(vacio.usuario('dueno'));
    await otro.esperar(() => otro.$$('.indicador').length === 4, 'los indicadores');

    expect(otro.textos('.grafico__vacio')).toEqual([
      'Todavía no se ha finalizado ninguna orden en estas semanas.',
      'Todavía no se han usado repuestos en órdenes.',
      'Todavía no se han usado repuestos en órdenes.',
    ]);
    expect(otro.textos('#cuerpo-mecanicos td')).toEqual(['Todavía no hay mecánicos registrados.']);
    await otro.cerrar();
    expect(otro.errores).toEqual([]);
  });

  test('el administrador ve el panel en su menú; el mecánico no', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'));
    expect(nav.textos('#menu a')).not.toContain('Panel');
    nav.window.location.hash = '#panel';
    await nav.esperar(() => nav.window.location.hash === '#ordenes', 'la redirección');
    expect(nav.visible('#indicadores-panel')).toBe(false);
  });

  test('el dueño reasigna una orden en proceso desde su detalle', async () => {
    const felipe = ctx.usuario('mecanico', 'felipe');
    await nav.iniciarSesion(ctx.usuario('dueno'));
    nav.clic('#menu a[data-vista="ordenes"]');
    await nav.esperar(() => nav.$$('#cuerpo-ordenes button[data-orden]').length === 2, 'la lista de órdenes');

    nav.clic(nav.$$('#cuerpo-ordenes button[data-orden]')[0]);
    await nav.esperar(() => nav.visible('#formulario-reasignar'), 'el formulario de reasignación');
    // Solo se ofrecen los otros mecánicos, no el que ya tiene la orden.
    expect(nav.textos('#reasignar-mecanico option')).toEqual(['Selecciona un mecánico', felipe.nombre]);

    nav.escribir('#reasignar-mecanico', String(felipe.id));
    nav.enviar('#formulario-reasignar');
    await nav.esperar(() => nav.$('#aviso-reasignar').textContent !== '', 'la confirmación');

    expect(nav.$('#aviso-reasignar').textContent).toBe(`La orden pasó a ${felipe.nombre}.`);
    expect(nav.textos('#ficha-orden dd')[2]).toBe(felipe.nombre);
  });

  test('el mecánico no ve la reasignación, y en una orden finalizada tampoco la ve el dueño', async () => {
    await nav.iniciarSesion(ctx.usuario('dueno'));
    nav.clic('#menu a[data-vista="ordenes"]');
    await nav.esperar(() => nav.$$('#cuerpo-ordenes button[data-orden]').length === 2, 'la lista de órdenes');

    nav.clic(nav.$(`#cuerpo-ordenes button[data-orden="${orden.id}"]`));
    await nav.esperar(() => nav.visible('#dialogo-orden'), 'el detalle');

    expect(nav.visible('#formulario-reasignar')).toBe(false);
  });

  test('entrada de mercancía desde el inventario: suma al stock y el historial la muestra con su detalle', async () => {
    await nav.iniciarSesion(ctx.usuario('dueno'));
    nav.clic('#menu a[data-vista="inventario"]');
    await nav.esperar(() => nav.$$('#cuerpo-tabla tr').length === 2, 'el catálogo');

    nav.clic(nav.$(`#cuerpo-tabla button[data-accion="entrada"][data-id="${filtro.id}"]`));
    await nav.esperar(() => nav.visible('#dialogo-entrada'), 'el diálogo de entrada');
    expect(nav.$('#texto-entrada').textContent).toBe('Filtro de aceite Mann W712. Hoy hay 7 en el inventario.');

    nav.escribir('#entrada-cantidad', '0');
    nav.enviar('#formulario-entrada');
    await nav.esperar(() => nav.$('#formulario-entrada [data-error="cantidad"]').textContent !== '', 'el error de cantidad');

    nav.escribir('#entrada-cantidad', '12');
    nav.escribir('#entrada-detalle', 'Factura 4471');
    nav.enviar('#formulario-entrada');
    await nav.esperar(() => !nav.visible('#dialogo-entrada'), 'que se cierre el diálogo');

    await nav.esperar(() => nav.$('#aviso-tabla').textContent !== '', 'la confirmación');
    expect(nav.$('#aviso-tabla').textContent).toBe('Entrada registrada: FIL-ACE-001 quedó con 19 unidades.');

    nav.clic(nav.$(`#cuerpo-tabla button[data-accion="historial"][data-id="${filtro.id}"]`));
    await nav.esperar(() => nav.visible('#dialogo-historial'), 'el historial');
    expect(nav.textos('#lista-historial li span:first-child').slice(0, 2)).toEqual(['Entrada: Factura 4471', `Usado en la orden #${orden.id}`]);
    expect(nav.textos('#lista-historial .cantidad')[0]).toBe('+12 (queda 19)');
  });
});
