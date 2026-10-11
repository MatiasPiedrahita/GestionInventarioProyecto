const { crearContexto } = require('../helpers/contexto');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('Alertas de stock bajo y notificaciones (integración)', () => {
  let ctx;
  let dueno;
  let mecanico;
  let filtro;
  let orden;

  beforeEach(async () => {
    ctx = crearContexto();
    dueno = ctx.como('dueno');
    mecanico = ctx.como('mecanico');
    filtro = (await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 5, stockMinimo: 3, proveedor: 'Autopartes del Valle' }))).body;
    orden = (await mecanico.post('/api/ordenes').send(ordenValida())).body;
  });

  const usar = (cantidad, repuesto = filtro) => mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: repuesto.id, cantidad }] });
  const abiertas = async (cliente = dueno) => (await cliente.get('/api/alertas')).body;
  const campana = async (cliente = dueno) => (await cliente.get('/api/notificaciones')).body;
  const correos = () => ctx.db.prepare('SELECT destinatario, asunto, cuerpo, estado, error FROM correos_salientes ORDER BY id').all();
  const activarCorreo = (cliente, email) => cliente.put('/api/notificaciones/preferencias').send({ email, notificarPorCorreo: true });

  describe('generación de alertas al cambiar el stock', () => {
    test('mientras el stock está por encima del mínimo no hay alertas', async () => {
      await usar(1);

      expect((await abiertas()).datos).toEqual([]);
      expect((await campana()).noLeidas).toBe(0);
    });

    test('cuando el stock llega al mínimo se crea la alerta al instante, con los datos del repuesto', async () => {
      await usar(2);

      const { datos, conteo } = await abiertas();
      expect(datos).toHaveLength(1);
      expect(datos[0]).toMatchObject({
        tipo: 'STOCK_BAJO', tipoNombre: 'Stock bajo', estado: 'ACTIVA', estadoNombre: 'Sin atender', stockAlGenerar: 3,
        repuesto: { sku: 'FIL-ACE-001', stockActual: 3, stockMinimo: 3, proveedor: 'Autopartes del Valle' },
      });
      expect(conteo).toEqual({ activas: 1, atendidas: 0, agotados: 0 });
    });

    test('seguir consumiendo no duplica la alerta; al agotarse se convierte en "Agotado" y se vuelve a avisar', async () => {
      await usar(2);
      await usar(1);
      expect((await abiertas()).datos).toHaveLength(1);
      expect((await campana()).noLeidas).toBe(1);

      await usar(2);

      const { datos, conteo } = await abiertas();
      expect(datos).toHaveLength(1);
      expect(datos[0]).toMatchObject({ tipo: 'AGOTADO', repuesto: { stockActual: 0 } });
      expect(conteo.agotados).toBe(1);
      expect((await campana()).datos.map((n) => n.titulo)).toEqual(['Agotado: FIL-ACE-001', 'Stock bajo: FIL-ACE-001']);
    });

    test('una entrada de mercancía que deja el stock sobre el mínimo resuelve la alerta', async () => {
      await usar(5);

      await dueno.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 20 });

      expect((await abiertas()).datos).toEqual([]);
      const { datos } = (await dueno.get('/api/alertas').query({ estado: 'RESUELTAS' })).body;
      expect(datos).toHaveLength(1);
      expect(datos[0]).toMatchObject({ estado: 'RESUELTA', estadoNombre: 'Resuelta', repuesto: { stockActual: 20 } });
      expect(datos[0].resueltaEn).toEqual(expect.any(String));
    });

    test('si la entrada no alcanza para superar el mínimo, la alerta baja de "Agotado" a "Stock bajo" sin avisar de nuevo', async () => {
      await usar(5);
      const avisosAntes = (await campana()).noLeidas;

      await dueno.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 2 });

      expect((await abiertas()).datos[0]).toMatchObject({ tipo: 'STOCK_BAJO', estado: 'ACTIVA' });
      expect((await campana()).noLeidas).toBe(avisosAntes);
    });

    test('cancelar la orden devuelve los repuestos y con eso se resuelve la alerta', async () => {
      await usar(4);
      expect((await abiertas()).datos).toHaveLength(1);

      await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'CANCELADA', motivo: 'El cliente desistió' });

      expect((await abiertas()).datos).toEqual([]);
    });

    test('subir el stock mínimo por encima del stock actual también genera la alerta', async () => {
      await dueno.put(`/api/repuestos/${filtro.id}`).send(repuestoValido({ stockActual: 5, stockMinimo: 8 }));

      expect((await abiertas()).datos[0]).toMatchObject({ tipo: 'STOCK_BAJO', repuesto: { stockMinimo: 8 } });
    });

    test('un repuesto creado ya por debajo del mínimo, o cargado así por CSV, genera su alerta', async () => {
      await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'NUEVO-1', nombre: 'Correa', stockActual: 0, stockMinimo: 2 }));
      await dueno.post('/api/repuestos/importar').set('Content-Type', 'text/csv')
        .send('sku,nombre,costo,stockActual,stockMinimo\nCSV-1,Tornillo,500,1,5\nCSV-2,Arandela,200,50,5\nCSV-3,Tuerca,300,0,5\n');

      const { datos } = await abiertas();
      // Lo más urgente primero: los agotados antes que los de stock bajo.
      expect(datos.map((a) => [a.repuesto.sku, a.tipo])).toEqual([['CSV-3', 'AGOTADO'], ['NUEVO-1', 'AGOTADO'], ['CSV-1', 'STOCK_BAJO']]);
    });

    test('dar de baja un repuesto resuelve sus alertas: ya no hay nada que reponer', async () => {
      await usar(5);

      await dueno.delete(`/api/repuestos/${filtro.id}`);

      expect((await abiertas()).datos).toEqual([]);
    });
  });

  describe('revisión completa (tarea programada y botón "Revisar ahora")', () => {
    test('detecta un cambio hecho directamente en la base de datos y es idempotente', async () => {
      ctx.db.prepare('UPDATE repuestos SET stock_actual = 1 WHERE id = ?').run(filtro.id);
      expect((await abiertas()).datos).toEqual([]);

      const primera = await dueno.post('/api/alertas/revisar');
      const segunda = await dueno.post('/api/alertas/revisar');

      expect(primera.body).toEqual({ revisados: 1, creadas: 1, escaladas: 0, resueltas: 0 });
      expect(segunda.body).toEqual({ revisados: 1, creadas: 0, escaladas: 0, resueltas: 0 });
      expect((await abiertas()).datos).toHaveLength(1);
      expect((await campana()).noLeidas).toBe(1);
    });

    test('la tarea programada usa el mismo servicio: resuelve las alertas cuyo stock se recuperó', async () => {
      await usar(5);
      ctx.db.prepare('UPDATE repuestos SET stock_actual = 50 WHERE id = ?').run(filtro.id);

      expect(ctx.servicios.alertas.revisar()).toEqual({ revisados: 1, creadas: 0, escaladas: 0, resueltas: 1 });
    });

    test('varias alertas nuevas en una revisión se avisan en un solo correo por persona', async () => {
      await activarCorreo(dueno, 'jorge@taller.co');
      await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'BUJ-1', nombre: 'Bujía', stockActual: 30, stockMinimo: 4 }));
      ctx.db.prepare('UPDATE repuestos SET stock_actual = 0').run();

      await dueno.post('/api/alertas/revisar');

      expect(correos()).toHaveLength(1);
      expect(correos()[0]).toMatchObject({ destinatario: 'jorge@taller.co', asunto: '[Taller] 2 repuestos necesitan atención', estado: 'SIMULADO' });
      expect((await campana()).noLeidas).toBe(2);
    });
  });

  describe('a quién se avisa', () => {
    test('la notificación en la aplicación llega al dueño y al administrador, no al mecánico ni a la recepcionista', async () => {
      const admin = ctx.como('administrador');
      const recepcion = ctx.como('recepcionista');

      await usar(2);

      expect((await campana(dueno)).datos).toEqual([
        expect.objectContaining({ tipo: 'STOCK_BAJO', titulo: 'Stock bajo: FIL-ACE-001', mensaje: 'Filtro de aceite Mann W712: quedan 3 unidades (mínimo 3).', vista: 'alertas', leida: false }),
      ]);
      expect((await campana(admin)).noLeidas).toBe(1);
      expect((await campana(mecanico)).noLeidas).toBe(0);
      expect((await campana(recepcion)).noLeidas).toBe(0);
    });

    test('un dueño desactivado no recibe avisos', async () => {
      const socio = ctx.usuario('dueno', 'socio');
      await dueno.patch(`/api/usuarios/${socio.id}/estado`).send({ activo: false });

      await usar(2);

      expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ?').get(socio.id).n).toBe(0);
    });

    test('por correo solo se avisa a quien lo activó en sus preferencias y tiene correo', async () => {
      const admin = ctx.como('administrador');
      await activarCorreo(dueno, 'Jorge@Taller.co');
      await admin.put('/api/notificaciones/preferencias').send({ email: 'admin@taller.co', notificarPorCorreo: false });

      await usar(2);

      expect(correos()).toEqual([expect.objectContaining({ destinatario: 'jorge@taller.co', asunto: '[Taller] Stock bajo: FIL-ACE-001', estado: 'SIMULADO' })]);
      expect(correos()[0].cuerpo).toContain('Hola, Dueño de Prueba:');
      expect(correos()[0].cuerpo).toContain('Proveedor: Autopartes del Valle.');
    });
  });

  describe('correo real por SMTP (transporte inyectado)', () => {
    test('con servidor de correo, el mensaje se envía y queda como ENVIADO', async () => {
      const enviados = [];
      const transporte = { modo: 'smtp', descripcion: 'SMTP de prueba', remitente: 'Taller <avisos@taller.co>', enviar: async (mensaje) => { enviados.push(mensaje); } };
      const conSmtp = crearContexto({ transporteDeCorreo: transporte, urlDeLaAplicacion: 'https://taller.ejemplo' });
      const jefe = conSmtp.como('dueno');
      await jefe.put('/api/notificaciones/preferencias').send({ email: 'jorge@taller.co', notificarPorCorreo: true });

      await jefe.post('/api/repuestos').send(repuestoValido({ stockActual: 0, stockMinimo: 2 }));
      await conSmtp.servicios.notificaciones.esperarEnvios();

      expect(enviados).toEqual([expect.objectContaining({ para: 'jorge@taller.co', asunto: '[Taller] Agotado: FIL-ACE-001' })]);
      expect(enviados[0].texto).toContain('https://taller.ejemplo');
      expect(conSmtp.db.prepare('SELECT estado, error FROM correos_salientes').get()).toEqual({ estado: 'ENVIADO', error: null });
    });

    test('si el servidor de correo falla, la operación no se cae: el correo queda en ERROR y la alerta existe igual', async () => {
      const transporte = { modo: 'smtp', descripcion: 'SMTP caído', remitente: 'x', enviar: async () => { throw new Error('Conexión rechazada por el servidor'); } };
      const conSmtp = crearContexto({ transporteDeCorreo: transporte });
      const jefe = conSmtp.como('dueno');
      await jefe.put('/api/notificaciones/preferencias').send({ email: 'jorge@taller.co', notificarPorCorreo: true });

      const res = await jefe.post('/api/repuestos').send(repuestoValido({ stockActual: 0, stockMinimo: 2 }));
      await conSmtp.servicios.notificaciones.esperarEnvios();

      expect(res.status).toBe(201);
      expect(conSmtp.db.prepare('SELECT estado, error FROM correos_salientes').get()).toEqual({ estado: 'ERROR', error: 'Conexión rechazada por el servidor' });
      expect((await jefe.get('/api/alertas')).body.datos).toHaveLength(1);
      expect((await jefe.get('/api/notificaciones')).body.noLeidas).toBe(1);
    });
  });

  describe('atender una alerta', () => {
    let alerta;

    beforeEach(async () => {
      await usar(3);
      [alerta] = (await abiertas()).datos;
    });

    test('el dueño marca que ya hizo el pedido: queda atendida, con su nota, y sigue visible hasta que llegue la mercancía', async () => {
      const res = await dueno.patch(`/api/alertas/${alerta.id}/atender`).send({ nota: 'Pedido a Autopartes, llega el jueves' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ estado: 'ATENDIDA', estadoNombre: 'Pedido hecho', atendidaPor: 'Dueño de Prueba', notaDeAtencion: 'Pedido a Autopartes, llega el jueves' });
      expect((await abiertas()).conteo).toEqual({ activas: 0, atendidas: 1, agotados: 0 });
      expect(ctx.db.prepare("SELECT detalle FROM auditoria WHERE accion = 'ALERTA_ATENDIDA'").get().detalle).toBe('FIL-ACE-001 (Stock bajo): Pedido a Autopartes, llega el jueves');
    });

    test('una alerta atendida no se puede atender dos veces (409) y se resuelve sola cuando entra la mercancía', async () => {
      await dueno.patch(`/api/alertas/${alerta.id}/atender`).send({});

      const repetida = await dueno.patch(`/api/alertas/${alerta.id}/atender`).send({});
      await dueno.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 10 });

      expect(repetida.status).toBe(409);
      expect(repetida.body.mensaje).toBe('La alerta de FIL-ACE-001 ya está pedido hecho');
      expect((await abiertas()).datos).toEqual([]);
    });

    test('valida la nota (400), que la alerta exista (404) y el permiso (403)', async () => {
      expect((await dueno.patch(`/api/alertas/${alerta.id}/atender`).send({ nota: 'a'.repeat(201) })).status).toBe(400);
      expect((await dueno.patch(`/api/alertas/${alerta.id}/atender`).send({ nota: 7 })).status).toBe(400);
      expect((await dueno.patch('/api/alertas/999/atender').send({})).status).toBe(404);
      expect((await mecanico.patch(`/api/alertas/${alerta.id}/atender`).send({})).status).toBe(403);
    });
  });

  describe('permisos y consulta', () => {
    test.each([['mecanico'], ['recepcionista']])('%s no ve las alertas ni puede lanzar la revisión (403); sin sesión, 401', async (rol) => {
      expect((await ctx.como(rol).get('/api/alertas')).status).toBe(403);
      expect((await ctx.como(rol).post('/api/alertas/revisar')).status).toBe(403);
      expect((await ctx.como(rol).get('/api/correos')).status).toBe(403);
      expect((await ctx.anonimo().get('/api/alertas')).status).toBe(401);
    });

    test('el historial de resueltas se pagina y un estado desconocido responde 400', async () => {
      const res = await dueno.get('/api/alertas').query({ estado: 'RESUELTAS', pagina: 'x' });

      expect(res.body).toMatchObject({ estado: 'RESUELTAS', datos: [], pagina: 1, totalPaginas: 1, total: 0 });
      expect((await dueno.get('/api/alertas').query({ estado: 'TODAS' })).status).toBe(400);
    });

    test('la bandeja de salida muestra el modo del correo y los mensajes, para dueño y administrador', async () => {
      await activarCorreo(dueno, 'jorge@taller.co');
      await usar(2);

      const res = await ctx.como('administrador').get('/api/correos');

      expect(res.body.modo).toBe('simulado');
      expect(res.body.correos).toEqual([expect.objectContaining({ destinatario: 'jorge@taller.co', usuario: 'Dueño de Prueba', estado: 'SIMULADO' })]);
    });

    test('el estado del sistema informa el modo del correo y el conteo de alertas', async () => {
      await usar(5);

      const { body } = await dueno.get('/api/sistema/estado');

      expect(body.correo).toMatchObject({ modo: 'simulado', porEstado: {} });
      expect(body.alertas).toEqual({ activas: 1, atendidas: 0, agotados: 1 });
    });
  });

  describe('reportar un faltante (mecánico)', () => {
    test('el mecánico avisa que un repuesto falta aunque el sistema diga que hay: se crea la alerta y se notifica al dueño', async () => {
      const res = await mecanico.post(`/api/repuestos/${filtro.id}/faltantes`).send({ nota: 'Los que hay no le sirven al Spark' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ tipo: 'FALTANTE_REPORTADO', tipoNombre: 'Faltante reportado', creadaPor: 'Mecánico de Prueba', stockAlGenerar: 5 });
      expect((await campana()).datos[0]).toMatchObject({
        titulo: 'Faltante reportado: FIL-ACE-001',
        mensaje: 'Mecánico de Prueba reportó que falta Filtro de aceite Mann W712: Los que hay no le sirven al Spark',
      });
    });

    test('no se duplica el reporte del mismo repuesto (409) y se resuelve cuando entra mercancía', async () => {
      await mecanico.post(`/api/repuestos/${filtro.id}/faltantes`).send({});

      const repetido = await ctx.como('mecanico', 'felipe').post(`/api/repuestos/${filtro.id}/faltantes`).send({});
      await dueno.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 6 });

      expect(repetido.status).toBe(409);
      expect((await abiertas()).datos).toEqual([]);
    });

    test('convive con la alerta de stock bajo del mismo repuesto', async () => {
      await usar(3);
      await mecanico.post(`/api/repuestos/${filtro.id}/faltantes`).send({});

      expect((await abiertas()).datos.map((a) => a.tipo)).toEqual(['FALTANTE_REPORTADO', 'STOCK_BAJO']);
    });

    test('la recepcionista no reporta faltantes (403); repuesto inexistente 404; nota inválida 400', async () => {
      expect((await ctx.como('recepcionista').post(`/api/repuestos/${filtro.id}/faltantes`).send({})).status).toBe(403);
      expect((await mecanico.post('/api/repuestos/999/faltantes').send({})).status).toBe(404);
      expect((await mecanico.post(`/api/repuestos/${filtro.id}/faltantes`).send({ nota: 'a'.repeat(201) })).status).toBe(400);
    });
  });

  describe('la campana: notificaciones de cada usuario', () => {
    beforeEach(async () => {
      await usar(2);
      await usar(3);
    });

    test('lista primero las no leídas y permite pedir solo esas', async () => {
      const { datos } = await campana();
      await dueno.patch(`/api/notificaciones/${datos[0].id}/leida`);

      const todas = await campana();
      const pendientes = (await dueno.get('/api/notificaciones').query({ soloNoLeidas: 'true' })).body;

      expect(todas.noLeidas).toBe(1);
      expect(todas.datos.map((n) => [n.titulo, n.leida])).toEqual([['Stock bajo: FIL-ACE-001', false], ['Agotado: FIL-ACE-001', true]]);
      expect(pendientes.datos).toHaveLength(1);
      expect((await dueno.get('/api/notificaciones/resumen')).body).toEqual({ noLeidas: 1 });
    });

    test('"marcar todas como leídas" deja el contador en cero', async () => {
      const res = await dueno.post('/api/notificaciones/leer-todas');

      expect(res.body).toEqual({ noLeidas: 0 });
      expect((await campana()).datos.every((n) => n.leida)).toBe(true);
    });

    test('nadie puede marcar como leída la notificación de otro usuario (404)', async () => {
      const admin = ctx.como('administrador');
      const { datos } = await campana(dueno);

      const ajena = await admin.patch(`/api/notificaciones/${datos[0].id}/leida`);

      expect(ajena.status).toBe(404);
      expect((await campana(dueno)).noLeidas).toBe(2);
      expect((await mecanico.patch('/api/notificaciones/abc/leida')).status).toBe(400);
    });

    test('el límite de la lista se respeta y tiene un tope', async () => {
      expect((await dueno.get('/api/notificaciones').query({ limite: 1 })).body.datos).toHaveLength(1);
      expect((await dueno.get('/api/notificaciones').query({ limite: 9999 })).status).toBe(200);
      expect((await ctx.anonimo().get('/api/notificaciones')).status).toBe(401);
    });
  });

  describe('preferencias de notificación', () => {
    test('cada usuario guarda su correo y decide si recibe avisos ahí', async () => {
      const antes = await mecanico.get('/api/notificaciones/preferencias');
      const guardadas = await mecanico.put('/api/notificaciones/preferencias').send({ email: ' Andres@Taller.co ', notificarPorCorreo: true });

      expect(antes.body).toEqual({ email: null, notificarPorCorreo: false });
      expect(guardadas.status).toBe(200);
      expect(guardadas.body).toEqual({ email: 'andres@taller.co', notificarPorCorreo: true });
      expect((await mecanico.get('/api/auth/yo')).body.usuario.email).toBe('andres@taller.co');
    });

    test.each([
      ['activar el correo sin escribir uno', { notificarPorCorreo: true }, 'email', 'Escribe tu correo para poder enviarte los avisos'],
      ['un correo mal escrito', { email: 'andres@', notificarPorCorreo: false }, 'email', 'El correo no es válido'],
      ['no indicar la preferencia', { email: 'andres@taller.co' }, 'notificarPorCorreo', 'Indica si quieres recibir los avisos por correo (true o false)'],
    ])('rechaza %s', async (_, cuerpo, campo, mensaje) => {
      const res = await mecanico.put('/api/notificaciones/preferencias').send(cuerpo);

      expect(res.status).toBe(400);
      expect(res.body.detalles).toEqual([{ campo, mensaje }]);
    });
  });

  describe('aviso al mecánico cuando le asignan una orden', () => {
    test('si la orden la crea recepción, el mecánico recibe la notificación (y el correo, si lo activó)', async () => {
      await activarCorreo(mecanico, 'andres@taller.co');
      const recepcion = ctx.como('recepcionista');

      const { body: nueva } = await recepcion.post('/api/ordenes').send(ordenValida({
        mecanicoId: ctx.usuario('mecanico').id, vehiculo: { placa: 'DEF456', marca: 'Renault', modelo: 'Logan' }, descripcion: 'Cambio de aceite',
      }));

      expect((await campana(mecanico)).datos[0]).toMatchObject({
        tipo: 'ORDEN_ASIGNADA', titulo: `Te asignaron la orden #${nueva.id}`, mensaje: 'DEF456 · Renault Logan: Cambio de aceite', vista: 'ordenes',
      });
      expect(correos()[0]).toMatchObject({ destinatario: 'andres@taller.co', asunto: `[Taller] Te asignaron la orden #${nueva.id} (DEF456)` });
      expect(correos()[0].cuerpo).toContain('Recepcionista de Prueba te asignó la orden');
    });

    test('si el mecánico crea su propia orden no se avisa a sí mismo; al reasignar se avisa al nuevo', async () => {
      const felipe = ctx.como('mecanico', 'felipe');
      expect((await campana(mecanico)).noLeidas).toBe(0);

      await dueno.patch(`/api/ordenes/${orden.id}/mecanico`).send({ mecanicoId: ctx.usuario('mecanico', 'felipe').id });

      expect((await campana(felipe)).datos[0].titulo).toBe(`Te asignaron la orden #${orden.id}`);
      expect((await campana(mecanico)).noLeidas).toBe(0);
    });
  });

  describe('robustez', () => {
    const entornoOriginal = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = entornoOriginal;
      jest.restoreAllMocks();
    });

    test('en producción, un fallo al actualizar las alertas no tumba el registro del repuesto (queda en el registro del servidor)', async () => {
      process.env.NODE_ENV = 'production';
      const registro = jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(console, 'log').mockImplementation(() => {});
      ctx.db.exec('DROP TABLE notificaciones');

      const res = await usar(2);

      expect(res.status).toBe(201);
      expect(ctx.db.prepare('SELECT stock_actual FROM repuestos WHERE id = ?').get(filtro.id).stock_actual).toBe(3);
      expect(registro).toHaveBeenCalledWith('No se pudieron actualizar las alertas de stock:', expect.anything());
    });
  });
});
