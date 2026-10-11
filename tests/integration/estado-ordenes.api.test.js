const { crearContexto } = require('../helpers/contexto');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('API PATCH /api/ordenes/:id/estado (integración)', () => {
  let ctx;
  let mecanico;
  let dueno;
  let filtro;
  let bujia;
  let orden;

  beforeEach(async () => {
    ctx = crearContexto();
    dueno = ctx.como('dueno');
    filtro = (await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 10 }))).body;
    bujia = (await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'BUJ-NGK-004', nombre: 'Bujía NGK', costo: 14500, stockActual: 4 }))).body;
    mecanico = ctx.como('mecanico');
    orden = (await mecanico.post('/api/ordenes').send(ordenValida())).body;
  });

  const stockDe = (repuesto) => ctx.db.prepare('SELECT stock_actual FROM repuestos WHERE id = ?').get(repuesto.id).stock_actual;
  const cambiar = (cliente, cuerpo, id = orden.id) => cliente.patch(`/api/ordenes/${id}/estado`).send(cuerpo);
  const registrar = (items) => mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items });

  test('el mecánico finaliza su orden: cambia el estado y queda en el historial con su nombre', async () => {
    const res = await cambiar(mecanico, { estado: 'FINALIZADA' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: orden.id, estado: 'FINALIZADA', estadoNombre: 'Finalizada' });

    const historial = await mecanico.get(`/api/ordenes/${orden.id}/historial`);
    expect(historial.status).toBe(200);
    expect(historial.body).toEqual([
      expect.objectContaining({ estadoAnterior: null, estadoNuevo: 'EN_PROCESO', estadoNuevoNombre: 'En proceso' }),
      expect.objectContaining({
        estadoAnterior: 'EN_PROCESO', estadoAnteriorNombre: 'En proceso', estadoNuevo: 'FINALIZADA', motivo: null, usuario: 'Mecánico de Prueba',
      }),
    ]);
  });

  test('una orden finalizada ya no admite repuestos y aparece como histórica en el listado', async () => {
    await cambiar(mecanico, { estado: 'FINALIZADA' });

    const registro = await registrar([{ repuestoId: filtro.id, cantidad: 1 }]);
    const historicas = await mecanico.get('/api/ordenes').query({ estado: 'HISTORICAS' });
    const activas = await mecanico.get('/api/ordenes').query({ estado: 'ACTIVAS' });

    expect(registro.status).toBe(409);
    expect(stockDe(filtro)).toBe(10);
    expect(historicas.body.datos.map((o) => o.id)).toEqual([orden.id]);
    expect(activas.body.total).toBe(0);
  });

  test('cancelar devuelve los repuestos al inventario, registra el movimiento DEVOLUCION y no los suma al total', async () => {
    await registrar([{ repuestoId: filtro.id, cantidad: 2 }, { repuestoId: bujia.id, cantidad: 4 }]);
    expect(stockDe(bujia)).toBe(0);

    const res = await cambiar(mecanico, { estado: 'CANCELADA', motivo: 'El cliente no aprobó la cotización' });

    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADA');
    expect(stockDe(filtro)).toBe(10);
    expect(stockDe(bujia)).toBe(4);
    expect(res.body.repuestos.map((r) => r.devuelto)).toEqual([true, true]);
    expect(res.body.totalRepuestos).toBe(0);

    const movimientos = await dueno.get(`/api/repuestos/${filtro.id}/movimientos`);
    expect(movimientos.body[0]).toMatchObject({
      tipo: 'DEVOLUCION', cantidad: 2, stockResultante: 10, ordenId: orden.id, detalle: `Devuelto al cancelar la orden #${orden.id} (ABC123)`,
    });
  });

  test('cancelar con devolverRepuestos: false deja el stock como estaba (la pieza ya se instaló)', async () => {
    await registrar([{ repuestoId: filtro.id, cantidad: 2 }]);

    const res = await cambiar(mecanico, { estado: 'CANCELADA', motivo: 'El cliente retiró el vehículo', devolverRepuestos: false });

    expect(res.status).toBe(200);
    expect(stockDe(filtro)).toBe(8);
    expect(res.body.repuestos[0].devuelto).toBe(false);
    expect(res.body.totalRepuestos).toBe(57000);
  });

  test('si el repuesto se dio de baja después de usarlo, al cancelar igual vuelve al estante', async () => {
    await registrar([{ repuestoId: filtro.id, cantidad: 3 }]);
    await dueno.delete(`/api/repuestos/${filtro.id}`);

    const res = await cambiar(mecanico, { estado: 'CANCELADA', motivo: 'Repuesto equivocado' });

    expect(res.status).toBe(200);
    expect(stockDe(filtro)).toBe(10);
  });

  test('validación: 400 si falta el estado, si no existe o si se cancela sin motivo', async () => {
    const sinEstado = await cambiar(mecanico, {});
    const desconocido = await cambiar(mecanico, { estado: 'ENTREGADA' });
    const sinMotivo = await cambiar(mecanico, { estado: 'CANCELADA' });

    expect(sinEstado.status).toBe(400);
    expect(desconocido.status).toBe(400);
    expect(sinMotivo.status).toBe(400);
    expect(sinMotivo.body.detalles).toEqual([{ campo: 'motivo', mensaje: 'Escribe el motivo para cancelar la orden' }]);
    expect((await mecanico.get(`/api/ordenes/${orden.id}`)).body.estado).toBe('EN_PROCESO');
  });

  test('409 si la orden ya está en ese estado o la transición no existe (finalizada → cancelada)', async () => {
    await cambiar(mecanico, { estado: 'FINALIZADA' });

    const repetida = await cambiar(mecanico, { estado: 'FINALIZADA' });
    const invalida = await cambiar(dueno, { estado: 'CANCELADA', motivo: 'Se arrepintió' });

    expect(repetida.status).toBe(409);
    expect(repetida.body.mensaje).toBe(`La orden #${orden.id} ya está finalizada`);
    expect(invalida.status).toBe(409);
    expect(invalida.body.mensaje).toBe(`La orden #${orden.id} está finalizada y no puede pasar a cancelada`);
  });

  test('reabrir: el mecánico no puede (403); el dueño sí, con motivo, y la orden vuelve a admitir repuestos', async () => {
    await cambiar(mecanico, { estado: 'FINALIZADA' });

    const porMecanico = await cambiar(mecanico, { estado: 'EN_PROCESO', motivo: 'Faltó cambiar el filtro' });
    const sinMotivo = await cambiar(dueno, { estado: 'EN_PROCESO' });
    const porDueno = await cambiar(dueno, { estado: 'EN_PROCESO', motivo: 'El cliente volvió por garantía' });

    expect(porMecanico.status).toBe(403);
    expect(sinMotivo.status).toBe(400);
    expect(porDueno.status).toBe(200);
    expect(porDueno.body.estado).toBe('EN_PROCESO');
    expect((await registrar([{ repuestoId: filtro.id, cantidad: 1 }])).status).toBe(201);
  });

  test('reabrir una orden cancelada no vuelve a descontar: los repuestos devueltos siguen devueltos', async () => {
    await registrar([{ repuestoId: filtro.id, cantidad: 2 }]);
    await cambiar(mecanico, { estado: 'CANCELADA', motivo: 'Error al crear la orden' });

    const reabierta = await cambiar(ctx.como('administrador'), { estado: 'EN_PROCESO', motivo: 'Sí se va a reparar' });
    const cancelada = await cambiar(mecanico, { estado: 'CANCELADA', motivo: 'Definitivamente no' });

    expect(reabierta.status).toBe(200);
    expect(reabierta.body.repuestos[0].devuelto).toBe(true);
    expect(stockDe(filtro)).toBe(10);
    // Cancelar otra vez no devuelve dos veces las mismas piezas.
    expect(cancelada.status).toBe(200);
    expect(stockDe(filtro)).toBe(10);
    const devoluciones = ctx.db.prepare("SELECT COUNT(*) AS n FROM movimientos_inventario WHERE tipo = 'DEVOLUCION'").get().n;
    expect(devoluciones).toBe(1);
  });

  test('permisos: otro mecánico 403, recepcionista 403, sin sesión 401, orden inexistente 404', async () => {
    const cuerpo = { estado: 'FINALIZADA' };

    expect((await cambiar(ctx.como('mecanico', 'otro'), cuerpo)).status).toBe(403);
    expect((await cambiar(ctx.como('recepcionista'), cuerpo)).status).toBe(403);
    expect((await cambiar(ctx.anonimo(), cuerpo)).status).toBe(401);
    expect((await cambiar(dueno, cuerpo, 999)).status).toBe(404);
    expect((await cambiar(dueno, cuerpo, 'abc')).status).toBe(400);
    expect((await mecanico.get(`/api/ordenes/${orden.id}`)).body.estado).toBe('EN_PROCESO');
  });

  test('el historial respeta la propiedad: otro mecánico 403, la recepcionista lo puede consultar', async () => {
    expect((await ctx.como('mecanico', 'otro').get(`/api/ordenes/${orden.id}/historial`)).status).toBe(403);
    expect((await ctx.como('recepcionista').get(`/api/ordenes/${orden.id}/historial`)).status).toBe(200);
    expect((await dueno.get('/api/ordenes/999/historial')).status).toBe(404);
  });

  test('si otra persona cambia la orden al mismo tiempo, el segundo cambio se rechaza sin tocar el stock', async () => {
    await registrar([{ repuestoId: filtro.id, cantidad: 2 }]);
    const { ordenes } = ctx.servicios;
    const usuario = ctx.usuario('mecanico');
    // Simula la carrera: la orden se finaliza justo después de que el servicio la leyó.
    const leer = ordenes.obtener.bind(ordenes);
    let primeraLectura = true;
    ordenes.obtener = (id, quien) => {
      const leida = leer(id, quien);
      if (primeraLectura) {
        primeraLectura = false;
        ctx.db.prepare("UPDATE ordenes SET estado = 'FINALIZADA' WHERE id = ?").run(id);
      }
      return leida;
    };

    expect(() => ordenes.cambiarEstado(orden.id, { estado: 'CANCELADA', motivo: 'x' }, usuario)).toThrow(/al mismo tiempo/);

    expect(stockDe(filtro)).toBe(8);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM historial_estados_orden WHERE orden_id = ?').get(orden.id).n).toBe(1);
  });
});
