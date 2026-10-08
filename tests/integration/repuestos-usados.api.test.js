const { crearContexto } = require('../helpers/contexto');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('API POST /api/ordenes/:id/repuestos (integración)', () => {
  let ctx;
  let mecanico;
  let filtro;
  let bujia;
  let orden;

  beforeEach(async () => {
    ctx = crearContexto();
    const dueno = ctx.como('dueno');
    filtro = (await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 10 }))).body;
    bujia = (await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'BUJ-NGK-004', nombre: 'Bujía NGK', costo: 14500, stockActual: 4 }))).body;
    mecanico = ctx.como('mecanico');
    orden = (await mecanico.post('/api/ordenes').send(ordenValida())).body;
  });

  const stockDe = async (repuesto) => (await ctx.como('dueno').get(`/api/repuestos/${repuesto.id}`)).body.stockActual;

  test('registra varios repuestos: descuenta stock, guarda costo y devuelve el total de la orden', async () => {
    const res = await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({
      items: [{ repuestoId: filtro.id, cantidad: 2 }, { repuestoId: bujia.id, cantidad: 4 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.repuestos).toEqual([
      expect.objectContaining({ sku: 'FIL-ACE-001', cantidad: 2, costoUnitario: 28500, subtotal: 57000 }),
      expect.objectContaining({ sku: 'BUJ-NGK-004', cantidad: 4, costoUnitario: 14500, subtotal: 58000 }),
    ]);
    expect(res.body.totalRepuestos).toBe(115000);
    expect(await stockDe(filtro)).toBe(8);
    expect(await stockDe(bujia)).toBe(0);
  });

  test('queda en el historial del repuesto como USO_EN_ORDEN, con la orden de origen', async () => {
    await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 3 }] });

    const historial = await ctx.como('dueno').get(`/api/repuestos/${filtro.id}/movimientos`);
    expect(historial.body[0]).toMatchObject({ tipo: 'USO_EN_ORDEN', cantidad: -3, stockResultante: 7, ordenId: orden.id });
  });

  test('todo o nada: si un repuesto no alcanza, no se descuenta ninguno (409)', async () => {
    const res = await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({
      items: [{ repuestoId: filtro.id, cantidad: 2 }, { repuestoId: bujia.id, cantidad: 5 }],
    });

    expect(res.status).toBe(409);
    expect(res.body.detalles[0].mensaje).toBe('Stock insuficiente de BUJ-NGK-004: hay 4 y se piden 5');
    expect(await stockDe(filtro)).toBe(10);
    expect(await stockDe(bujia)).toBe(4);
    expect((await mecanico.get(`/api/ordenes/${orden.id}`)).body.repuestos).toEqual([]);
  });

  test('rechaza repuestos inexistentes o dados de baja (400)', async () => {
    await ctx.como('dueno').delete(`/api/repuestos/${bujia.id}`);

    const inexistente = await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: 999, cantidad: 1 }] });
    const deBaja = await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: bujia.id, cantidad: 1 }] });

    expect(inexistente.status).toBe(400);
    expect(deBaja.status).toBe(400);
  });

  test('permisos: otro mecánico 403, recepcionista 403, dueño sí puede', async () => {
    const items = { items: [{ repuestoId: filtro.id, cantidad: 1 }] };

    expect((await ctx.como('mecanico', 'otro').post(`/api/ordenes/${orden.id}/repuestos`).send(items)).status).toBe(403);
    expect((await ctx.como('recepcionista').post(`/api/ordenes/${orden.id}/repuestos`).send(items)).status).toBe(403);
    expect((await ctx.como('dueno').post(`/api/ordenes/${orden.id}/repuestos`).send(items)).status).toBe(201);
    expect(await stockDe(filtro)).toBe(9);
  });

  test('no permite registrar repuestos en una orden que ya no está en proceso (409)', async () => {
    ctx.db.prepare("UPDATE ordenes SET estado = 'FINALIZADA' WHERE id = ?").run(orden.id);

    const res = await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 1 }] });

    expect(res.status).toBe(409);
    expect(await stockDe(filtro)).toBe(10);
  });
});
