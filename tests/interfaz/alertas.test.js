const { crearContexto } = require('../helpers/contexto');
const { abrirNavegador } = require('../helpers/navegador');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('Interfaz · campana de notificaciones, alertas de stock y avisos por correo (HU-08)', () => {
  let ctx;
  let nav;
  let dueno;
  let mecanico;
  let filtro;
  let orden;

  beforeEach(async () => {
    ctx = crearContexto();
    dueno = ctx.como('dueno');
    mecanico = ctx.como('mecanico');
    filtro = (await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 5, stockMinimo: 3, proveedor: 'Autopartes del Valle' }))).body;
    await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'BUJ-NGK-004', nombre: 'Bujía NGK', stockActual: 0, stockMinimo: 2 }));
    orden = (await mecanico.post('/api/ordenes').send(ordenValida())).body;
    nav = await abrirNavegador(ctx.app);
  });

  afterEach(async () => {
    await nav.cerrar();
    expect(nav.errores).toEqual([]);
  });

  const usar = (cantidad) => mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad }] });
  const contador = () => (nav.$('#contador-campana').hidden ? 0 : Number(nav.$('#contador-campana').textContent));
  // Primer texto de cada celda (la celda de acciones queda vacía cuando no hay botón).
  const filas = () => nav.$$('#cuerpo-alertas tr[data-alerta]')
    .map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.firstChild ? td.firstChild.textContent : '')));

  async function abrirAlertas(rol = 'dueno') {
    await nav.iniciarSesion(ctx.usuario(rol));
    nav.clic('#menu a[data-vista="alertas"]');
    await nav.esperar(() => nav.$('#resumen-alertas').textContent !== '', 'la vista de alertas');
  }

  describe('campana', () => {
    test('muestra el número de avisos sin leer y lo dice también en su etiqueta accesible', async () => {
      await usar(2);
      await nav.iniciarSesion(ctx.usuario('dueno'));
      await nav.esperar(() => contador() === 2, 'el contador de la campana');

      expect(nav.visible('#campana')).toBe(true);
      expect(nav.$('#boton-campana').getAttribute('aria-label')).toBe('Notificaciones: 2 sin leer');
      expect(nav.visible('#panel-notificaciones')).toBe(false);
    });

    test('al abrirla lista los avisos; al tocar uno lo marca como leído y lleva a la vista de alertas', async () => {
      await usar(2);
      await nav.iniciarSesion(ctx.usuario('dueno'));
      await nav.esperar(() => contador() === 2, 'el contador');

      nav.clic('#boton-campana');
      await nav.esperar(() => nav.$$('#lista-notificaciones button').length === 2, 'la lista de avisos');
      expect(nav.$('#boton-campana').getAttribute('aria-expanded')).toBe('true');
      expect(nav.textos('#lista-notificaciones strong')).toEqual(['Stock bajo: FIL-ACE-001', 'Agotado: BUJ-NGK-004']);
      expect(nav.$$('.aviso-campana--nuevo')).toHaveLength(2);

      nav.clic(nav.$('#lista-notificaciones button'));
      await nav.esperar(() => nav.window.location.hash === '#alertas', 'la navegación a alertas');

      expect(contador()).toBe(1);
      expect(nav.visible('#panel-notificaciones')).toBe(false);
      expect(nav.visible('#cuerpo-alertas')).toBe(true);
    });

    test('"Marcar todas como leídas" deja la campana sin contador', async () => {
      await usar(2);
      await nav.iniciarSesion(ctx.usuario('dueno'));
      nav.clic('#boton-campana');
      await nav.esperar(() => nav.$$('#lista-notificaciones button').length === 2, 'la lista');

      nav.clic('#boton-leer-todas');
      await nav.esperar(() => contador() === 0, 'el contador en cero');
      await nav.esperar(() => nav.$$('.aviso-campana--nuevo').length === 0, 'la lista sin avisos nuevos');

      expect(nav.$('#boton-campana').getAttribute('aria-label')).toBe('Notificaciones');
      expect(nav.visible('#boton-leer-todas')).toBe(false);
    });

    test('se cierra con Escape y devuelve el foco al botón; sin avisos lo dice', async () => {
      await nav.iniciarSesion(ctx.usuario('mecanico'));
      nav.clic('#boton-campana');
      await nav.esperar(() => nav.$('.aviso-campana__vacio'), 'el mensaje de lista vacía');
      expect(nav.$('.aviso-campana__vacio').textContent).toBe('No tienes notificaciones.');

      nav.document.dispatchEvent(new nav.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(nav.visible('#panel-notificaciones')).toBe(false);
      expect(nav.document.activeElement.id).toBe('boton-campana');
    });

    test('al cerrar sesión la campana se oculta y se limpia: el siguiente usuario no ve avisos ajenos', async () => {
      await usar(2);
      await nav.iniciarSesion(ctx.usuario('dueno'));
      await nav.esperar(() => contador() === 2, 'el contador');

      nav.clic('#boton-salir');
      await nav.esperar(() => nav.visible('#pantalla-login'), 'el login');
      expect(nav.$('#campana').hidden).toBe(true);
      expect(nav.$('#lista-notificaciones').children).toHaveLength(0);

      await nav.iniciarSesion(ctx.usuario('recepcionista'));
      await nav.reposo();
      expect(contador()).toBe(0);
    });

    test('el mecánico recibe en su campana la orden que le asignó recepción', async () => {
      await ctx.como('recepcionista').post('/api/ordenes').send(ordenValida({
        mecanicoId: ctx.usuario('mecanico').id, vehiculo: { placa: 'DEF456', marca: 'Renault', modelo: 'Logan' },
      }));
      await nav.iniciarSesion(ctx.usuario('mecanico'));
      await nav.esperar(() => contador() === 1, 'el aviso de la orden');

      nav.clic('#boton-campana');
      await nav.esperar(() => nav.$$('#lista-notificaciones button').length === 1, 'la lista');
      expect(nav.textos('#lista-notificaciones strong')[0]).toMatch(/^Te asignaron la orden #\d+$/);
    });
  });

  describe('vista de alertas', () => {
    test('lista las alertas abiertas con lo más urgente primero y resume la situación', async () => {
      await usar(2);
      await abrirAlertas();

      expect(nav.$('#resumen-alertas').textContent).toBe('2 alertas sin atender, 1 repuesto agotado.');
      expect(filas().map((f) => f.slice(0, 3))).toEqual([
        ['BUJ-NGK-004', 'Agotado', '0 unidades'],
        ['FIL-ACE-001', 'Stock bajo', '3 unidades'],
      ]);
      expect(nav.textos('#cuerpo-alertas tr:last-child td:first-child .detalle')).toEqual(['Filtro de aceite Mann W712 · Autopartes del Valle']);
      expect(nav.visible('#paginacion-alertas')).toBe(false);
    });

    test('"Ya hice el pedido" abre el diálogo, guarda la nota y la alerta queda como "Pedido hecho" sin botón', async () => {
      await usar(2);
      await abrirAlertas();

      nav.clic(nav.$('#cuerpo-alertas tr:last-child [data-atender]'));
      await nav.esperar(() => nav.visible('#dialogo-atender'), 'el diálogo');
      expect(nav.$('#texto-atender').textContent).toMatch(/^FIL-ACE-001 · Filtro de aceite Mann W712\./);
      nav.escribir('#atender-nota', 'Pedido a Autopartes, llega el jueves');
      nav.enviar('#formulario-atender');

      await nav.esperar(() => !nav.visible('#dialogo-atender'), 'que cierre el diálogo');
      await nav.esperar(() => filas().some((f) => f[4] === 'Pedido hecho'), 'el estado actualizado');
      const atendida = nav.$$('#cuerpo-alertas tr[data-alerta]').find((tr) => tr.textContent.includes('FIL-ACE-001'));
      expect(atendida.querySelector('[data-atender]')).toBeNull();
      expect(atendida.textContent).toContain('Dueño de Prueba: Pedido a Autopartes, llega el jueves');
      expect(nav.$('#resumen-alertas').textContent).toBe('1 alerta sin atender, 1 con pedido hecho, 1 repuesto agotado.');
    });

    test('"Revisar ahora" detecta cambios hechos por fuera y actualiza la campana', async () => {
      await abrirAlertas();
      expect(filas()).toHaveLength(1);
      ctx.db.prepare('UPDATE repuestos SET stock_actual = 1 WHERE id = ?').run(filtro.id);

      nav.clic('#boton-revisar-alertas');
      await nav.esperar(() => filas().length === 2, 'la alerta nueva');

      expect(nav.$('#aviso-alertas').textContent).toBe('Se revisaron 2 repuestos: 1 alerta nueva, 0 resueltas.');
      await nav.esperar(() => contador() === 2, 'la campana actualizada');
    });

    test('la pestaña Historial muestra las resueltas', async () => {
      await usar(5);
      await dueno.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 20 });
      await abrirAlertas();

      nav.clic('#pestanas-alertas [data-grupo="RESUELTAS"]');
      await nav.esperar(() => nav.$('#columna-fecha-alertas').textContent === 'Resuelta', 'el historial');
      await nav.esperar(() => filas().length === 1, 'la alerta resuelta');

      expect(filas()[0][4]).toBe('Resuelta');
      expect(nav.$('#cuerpo-alertas [data-atender]')).toBeNull();
    });

    test('sin alertas lo dice con claridad', async () => {
      const limpio = crearContexto();
      const otro = await abrirNavegador(limpio.app);
      await otro.iniciarSesion(limpio.usuario('administrador'));
      otro.clic('#menu a[data-vista="alertas"]');
      await otro.esperar(() => otro.$('#cuerpo-alertas .vacio'), 'el mensaje vacío');

      expect(otro.$('#resumen-alertas').textContent).toBe('Todo el inventario está por encima de su mínimo.');
      expect(otro.$('#cuerpo-alertas .vacio').textContent).toBe('No hay alertas abiertas. Ningún repuesto está en su mínimo.');
      await otro.cerrar();
    });

    test('el mecánico no tiene la sección de alertas', async () => {
      await nav.iniciarSesion(ctx.usuario('mecanico'));

      expect(nav.textos('#menu a')).not.toContain('Alertas');
      nav.window.location.hash = '#alertas';
      await nav.esperar(() => nav.window.location.hash === '#ordenes', 'la redirección');
    });
  });

  describe('avisos por correo en "Mi cuenta"', () => {
    async function abrirCuenta() {
      await nav.iniciarSesion(ctx.usuario('dueno'));
      nav.window.location.hash = '#cuenta';
      await nav.esperar(() => nav.visible('#formulario-avisos'), 'Mi cuenta');
      await nav.reposo();
    }

    test('activar el correo sin escribirlo muestra el error junto al campo', async () => {
      await abrirCuenta();
      expect(nav.$('#avisos-activar').checked).toBe(false);

      nav.escribir('#avisos-activar', true);
      nav.enviar('#formulario-avisos');

      await nav.esperar(() => nav.$('#formulario-avisos [data-error="email"]').textContent !== '', 'el error');
      expect(nav.$('#formulario-avisos [data-error="email"]').textContent).toBe('Escribe tu correo para poder enviarte los avisos');
    });

    test('con el correo activado, la siguiente alerta genera el correo y Administración lo muestra en la bandeja de salida', async () => {
      await abrirCuenta();
      nav.escribir('#avisos-email', 'jorge@taller.co');
      nav.escribir('#avisos-activar', true);
      nav.enviar('#formulario-avisos');
      await nav.esperar(() => nav.$('#aviso-avisos').textContent !== '', 'la confirmación');
      expect(nav.$('#aviso-avisos').textContent).toBe('Listo: los avisos también llegarán a jorge@taller.co.');

      await usar(2);
      nav.clic('#menu a[data-vista="administracion"]');
      await nav.esperar(() => nav.visible('#pestana-sistema'), 'administración');
      nav.clic('#pestana-sistema');
      await nav.esperar(() => nav.$$('#cuerpo-correos tr').length === 1 && !nav.$('#cuerpo-correos .vacio'), 'la bandeja de salida');

      expect(nav.$('#modo-correo').textContent).toBe('Simulado: los correos quedan en la bandeja de salida y no se envían');
      const celdas = [...nav.$('#cuerpo-correos tr').querySelectorAll('td')];
      expect(celdas[1].firstChild.textContent).toBe('jorge@taller.co');
      expect(celdas[2].querySelector('summary').textContent).toBe('[Taller] Stock bajo: FIL-ACE-001');
      expect(celdas[2].querySelector('pre').textContent).toContain('Hola, Dueño de Prueba:');
      expect(celdas[3].firstChild.textContent).toBe('Simulado (no se envió)');
      const ficha = Object.fromEntries(nav.textos('#ficha-sistema dt').map((dt, i) => [dt, nav.textos('#ficha-sistema dd')[i]]));
      expect(ficha['Alertas de stock']).toBe('2 sin atender, 0 con pedido hecho');
    });

    test('al volver a "Mi cuenta" las preferencias guardadas aparecen cargadas', async () => {
      await dueno.put('/api/notificaciones/preferencias').send({ email: 'jorge@taller.co', notificarPorCorreo: true });

      await abrirCuenta();

      expect(nav.$('#avisos-email').value).toBe('jorge@taller.co');
      expect(nav.$('#avisos-activar').checked).toBe(true);
    });
  });

  describe('reportar un faltante desde la orden (mecánico)', () => {
    async function abrirOrden() {
      await nav.iniciarSesion(ctx.usuario('mecanico'));
      await nav.esperar(() => nav.$('[data-tarjetas="EN_PROCESO"] .tarjeta'), 'el tablero');
      nav.clic(nav.$('[data-tarjetas="EN_PROCESO"] .tarjeta button[data-orden]'));
      await nav.esperar(() => nav.$$('#usado-repuesto option').length === 3, 'los repuestos disponibles');
    }

    test('los repuestos agotados se pueden elegir (para avisar) y dicen "agotado"', async () => {
      await abrirOrden();

      const opciones = nav.$$('#usado-repuesto option');
      expect(opciones.map((o) => o.textContent)).toEqual([
        'Selecciona un repuesto', 'BUJ-NGK-004: Bujía NGK (agotado)', 'FIL-ACE-001: Filtro de aceite Mann W712 (quedan 5)',
      ]);
      expect(opciones.every((o) => !o.disabled)).toBe(true);
    });

    test('pide elegir el repuesto; al avisar, el dueño recibe la notificación con la orden y la placa', async () => {
      await abrirOrden();

      nav.clic('#boton-reportar-faltante');
      expect(nav.$('#aviso-repuesto-usado').textContent).toBe('Selecciona primero el repuesto que hace falta.');

      nav.escribir('#usado-repuesto', String(filtro.id));
      nav.clic('#boton-reportar-faltante');
      await nav.esperar(() => /Se avisó al dueño/.test(nav.$('#aviso-repuesto-usado').textContent), 'la confirmación');

      const { datos } = (await dueno.get('/api/notificaciones')).body;
      expect(datos[0]).toMatchObject({
        titulo: 'Faltante reportado: FIL-ACE-001',
        mensaje: `Mecánico de Prueba reportó que falta Filtro de aceite Mann W712: Para la orden #${orden.id} (ABC123)`,
      });

      nav.clic('#boton-reportar-faltante');
      await nav.esperar(() => /Ya hay un reporte abierto/.test(nav.$('#aviso-repuesto-usado').textContent), 'el aviso de reporte repetido');
    });
  });
});
