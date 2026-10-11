const { crearContexto } = require('../helpers/contexto');
const { abrirNavegador } = require('../helpers/navegador');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('Interfaz · tablero Kanban y cambio de estado (HU-07)', () => {
  let ctx;
  let nav;
  let filtro;
  let orden;

  beforeEach(async () => {
    ctx = crearContexto();
    filtro = (await ctx.como('dueno').post('/api/repuestos').send(repuestoValido({ stockActual: 10 }))).body;
    orden = (await ctx.como('mecanico').post('/api/ordenes').send(ordenValida())).body;
    await ctx.como('mecanico').post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 2 }] });
    nav = await abrirNavegador(ctx.app);
  });

  afterEach(async () => {
    await nav.cerrar();
    expect(nav.errores).toEqual([]);
  });

  const tarjetasDe = (estado) => nav.$$(`[data-tarjetas="${estado}"] .tarjeta`);
  const botonesDe = (tarjeta) => [...tarjeta.querySelectorAll('button')].map((b) => b.textContent);
  const stock = () => ctx.db.prepare('SELECT stock_actual FROM repuestos WHERE id = ?').get(filtro.id).stock_actual;

  async function entrarAlTablero(rol) {
    await nav.iniciarSesion(ctx.usuario(rol));
    if (!nav.visible('#tablero-ordenes')) nav.clic('.alternador [data-modo="tablero"]');
    await nav.esperar(() => tarjetasDe('EN_PROCESO').length + tarjetasDe('FINALIZADA').length + tarjetasDe('CANCELADA').length > 0, 'que carguen las tarjetas');
  }

  test('el mecánico entra directo al tablero y ve su orden en "En proceso" con las acciones Finalizar y Cancelar', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'));
    await nav.esperar(() => tarjetasDe('EN_PROCESO').length === 1, 'la tarjeta de la orden');

    expect(nav.visible('#tablero-ordenes')).toBe(true);
    expect(nav.visible('#lista-ordenes')).toBe(false);
    expect(nav.visible('#campo-filtro-estado')).toBe(false);
    const [tarjeta] = tarjetasDe('EN_PROCESO');
    expect(tarjeta.querySelector('.placa').textContent).toBe('ABC123');
    expect(botonesDe(tarjeta)).toEqual(['Abrir', 'Finalizar', 'Cancelar']);
    expect(tarjeta.draggable).toBe(true);
    expect(nav.textos('.tablero__conteo')).toEqual(['1', '0', '0']);
  });

  test('finalizar desde la tarjeta: confirma en el diálogo, la tarjeta pasa a "Finalizadas" y el stock no cambia', async () => {
    await entrarAlTablero('mecanico');

    nav.clic(tarjetasDe('EN_PROCESO')[0].querySelector('[data-destino="FINALIZADA"]'));
    await nav.esperar(() => nav.visible('#dialogo-estado'), 'el diálogo de confirmación');
    expect(nav.$('#titulo-cambio-estado').textContent).toBe(`Finalizar la orden #${orden.id}`);
    expect(nav.visible('#campo-devolver')).toBe(false);
    nav.enviar('#formulario-estado');

    await nav.esperar(() => tarjetasDe('FINALIZADA').length === 1, 'la tarjeta en Finalizadas');
    expect(tarjetasDe('EN_PROCESO')).toHaveLength(0);
    expect(nav.visible('#dialogo-estado')).toBe(false);
    // El mecánico no puede reabrir: la tarjeta cerrada solo se puede abrir.
    expect(botonesDe(tarjetasDe('FINALIZADA')[0])).toEqual(['Abrir']);
    expect(tarjetasDe('FINALIZADA')[0].draggable).toBe(false);
    expect(stock()).toBe(8);
  });

  test('cancelar exige motivo; con motivo la orden pasa a "Canceladas" y los repuestos vuelven al inventario', async () => {
    await entrarAlTablero('mecanico');

    nav.clic(tarjetasDe('EN_PROCESO')[0].querySelector('[data-destino="CANCELADA"]'));
    await nav.esperar(() => nav.visible('#dialogo-estado'), 'el diálogo de cancelación');
    expect(nav.visible('#campo-devolver')).toBe(true);
    expect(nav.$('#texto-devolver').textContent).toBe('Devolver al inventario las 2 unidades registradas en esta orden');

    nav.enviar('#formulario-estado');
    await nav.esperar(() => nav.$('[data-error="motivo"]').textContent !== '', 'el error del motivo');
    expect(nav.$('[data-error="motivo"]').textContent).toBe('Escribe el motivo para cancelar la orden');
    expect(tarjetasDe('EN_PROCESO')).toHaveLength(1);

    nav.escribir('#estado-motivo', 'El cliente no aprobó la cotización');
    nav.enviar('#formulario-estado');
    await nav.esperar(() => tarjetasDe('CANCELADA').length === 1, 'la tarjeta en Canceladas');
    expect(stock()).toBe(10);
  });

  test('arrastrar la tarjeta a "Finalizadas" abre la confirmación; soltarla en su misma columna no hace nada', async () => {
    await entrarAlTablero('mecanico');
    const [tarjeta] = tarjetasDe('EN_PROCESO');
    const columna = (estado) => nav.$(`.tablero__columna[data-estado="${estado}"]`);

    nav.arrastre('dragstart', tarjeta);
    expect(nav.arrastre('dragover', columna('EN_PROCESO')).defaultPrevented).toBe(false);
    expect(nav.arrastre('dragover', columna('FINALIZADA')).defaultPrevented).toBe(true);
    nav.arrastre('drop', columna('FINALIZADA'));
    nav.arrastre('dragend', tarjeta);

    await nav.esperar(() => nav.visible('#dialogo-estado'), 'el diálogo tras soltar la tarjeta');
    expect(nav.$('#boton-confirmar-estado').textContent).toBe('Finalizar orden');
  });

  test('el dueño arranca en la lista, puede pasar al tablero y reabrir una orden finalizada con motivo', async () => {
    await ctx.como('mecanico').patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'FINALIZADA' });
    await nav.iniciarSesion(ctx.usuario('dueno'));
    nav.clic('.barra-app__menu a[data-vista="ordenes"]');
    await nav.esperar(() => nav.$$('#cuerpo-ordenes button[data-orden]').length === 1, 'la lista de órdenes');
    expect(nav.visible('#lista-ordenes')).toBe(true);

    nav.clic('.alternador [data-modo="tablero"]');
    await nav.esperar(() => tarjetasDe('FINALIZADA').length === 1, 'el tablero');
    expect(botonesDe(tarjetasDe('FINALIZADA')[0])).toEqual(['Abrir', 'Reabrir']);

    nav.clic(tarjetasDe('FINALIZADA')[0].querySelector('[data-destino="EN_PROCESO"]'));
    await nav.esperar(() => nav.visible('#dialogo-estado'), 'el diálogo de reapertura');
    nav.escribir('#estado-motivo', 'El cliente volvió por garantía');
    nav.enviar('#formulario-estado');

    await nav.esperar(() => tarjetasDe('EN_PROCESO').length === 1, 'la tarjeta de vuelta en En proceso');
  });

  test('el detalle de la orden muestra el historial de estados y las acciones disponibles', async () => {
    await ctx.como('mecanico').patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'CANCELADA', motivo: 'Repuesto equivocado' });
    await entrarAlTablero('mecanico');

    nav.clic(tarjetasDe('CANCELADA')[0].querySelector('button[data-orden]'));
    await nav.esperar(() => nav.visible('#dialogo-orden'), 'el detalle de la orden');

    expect(nav.textos('#historial-estados li span:first-child')).toEqual([
      'Creada por Mecánico de Prueba',
      'Cancelada por Mecánico de Prueba',
    ]);
    expect(nav.textos('#historial-estados .motivo')).toEqual(['Repuesto equivocado']);
    expect(nav.$$('#acciones-estado button')).toHaveLength(0);
    expect(nav.$('#cuerpo-repuestos-orden tr').className).toBe('devuelto');
    expect(nav.visible('#formulario-repuesto-usado')).toBe(false);
  });

  test('la recepcionista ve el tablero sin acciones ni arrastre, pero sí el formulario para recibir vehículos', async () => {
    await entrarAlTablero('recepcionista');

    expect(nav.visible('#panel-nueva-orden')).toBe(true);
    expect(nav.visible('#campo-mecanico')).toBe(true);
    expect(nav.visible('#franja-mi-resumen')).toBe(false);

    const [tarjeta] = tarjetasDe('EN_PROCESO');
    expect(botonesDe(tarjeta)).toEqual(['Abrir']);
    expect(tarjeta.draggable).toBe(false);
  });
});
