const { crearContexto } = require('../helpers/contexto');
const { ordenValida } = require('../helpers/datos');

describe('API /api/ordenes (integración)', () => {
  let ctx;

  beforeEach(() => {
    ctx = crearContexto();
  });

  test('el mecánico crea una orden: queda asignada a él, en estado En proceso y con Location', async () => {
    const res = await ctx.como('mecanico').post('/api/ordenes').send(ordenValida());

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/ordenes/${res.body.id}`);
    expect(res.body).toMatchObject({
      estado: 'EN_PROCESO',
      estadoNombre: 'En proceso',
      mecanico: { id: ctx.usuario('mecanico').id },
      vehiculo: { placa: 'ABC123', marca: 'Chevrolet' },
      cliente: { documento: '1037654321', nombre: 'Camila Ortiz' },
    });
  });

  test('el mecánico no puede asignar la orden a otro: siempre queda a su nombre', async () => {
    const otro = ctx.usuario('mecanico', 'otro');
    const res = await ctx.como('mecanico').post('/api/ordenes').send(ordenValida({ mecanicoId: otro.id }));

    expect(res.body.mecanico.id).toBe(ctx.usuario('mecanico').id);
  });

  test('reutiliza cliente (por documento) y vehículo (por placa) y actualiza sus datos de contacto', async () => {
    const mecanico = ctx.como('mecanico');
    const primera = await mecanico.post('/api/ordenes').send(ordenValida());
    const segunda = await mecanico.post('/api/ordenes').send(ordenValida({
      cliente: { documento: '1037654321', nombre: 'Camila Ortiz', telefono: '3119998877' },
      vehiculo: { placa: 'ABC 123', marca: 'Chevrolet', modelo: 'Spark GT' },
      descripcion: 'Revisión de los 50.000 km',
    }));

    expect(segunda.body.cliente.id).toBe(primera.body.cliente.id);
    expect(segunda.body.vehiculo.id).toBe(primera.body.vehiculo.id);
    expect(segunda.body.cliente.telefono).toBe('3119998877');
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n).toBe(1);
  });

  test('el dueño debe elegir un mecánico activo para la orden', async () => {
    const dueno = ctx.como('dueno');
    const mecanico = ctx.usuario('mecanico');

    const sinMecanico = await dueno.post('/api/ordenes').send(ordenValida());
    const conRecepcionista = await dueno.post('/api/ordenes').send(ordenValida({ mecanicoId: ctx.usuario('recepcionista').id }));
    const correcta = await dueno.post('/api/ordenes').send(ordenValida({ mecanicoId: mecanico.id }));

    expect(sinMecanico.status).toBe(400);
    expect(conRecepcionista.status).toBe(400);
    expect(correcta.status).toBe(201);
    expect(correcta.body.mecanico).toEqual({ id: mecanico.id, nombre: mecanico.nombre });
  });

  test('la recepcionista no puede crear órdenes (403)', async () => {
    const res = await ctx.como('recepcionista').post('/api/ordenes').send(ordenValida());
    expect(res.status).toBe(403);
  });

  test('cada mecánico ve solo sus órdenes; el dueño ve todas', async () => {
    await ctx.como('mecanico').post('/api/ordenes').send(ordenValida());
    await ctx.como('mecanico', 'otro').post('/api/ordenes').send(ordenValida({
      vehiculo: { placa: 'XYZ98D', marca: 'Yamaha', modelo: 'NMAX' },
    }));

    const propias = await ctx.como('mecanico').get('/api/ordenes');
    const todas = await ctx.como('dueno').get('/api/ordenes');

    expect(propias.body.map((o) => o.vehiculo.placa)).toEqual(['ABC123']);
    expect(todas.body).toHaveLength(2);
  });

  test('detalle: 403 si la orden es de otro mecánico, 404 si no existe', async () => {
    const { body: orden } = await ctx.como('mecanico').post('/api/ordenes').send(ordenValida());

    expect((await ctx.como('mecanico', 'otro').get(`/api/ordenes/${orden.id}`)).status).toBe(403);
    expect((await ctx.como('recepcionista').get(`/api/ordenes/${orden.id}`)).status).toBe(200);
    expect((await ctx.como('dueno').get('/api/ordenes/999')).status).toBe(404);
  });

  test('GET /api/usuarios/mecanicos lista solo mecánicos activos', async () => {
    ctx.usuario('mecanico');
    ctx.usuario('dueno');
    const res = await ctx.como('recepcionista').get('/api/usuarios/mecanicos');

    expect(res.body.map((u) => u.rol)).toEqual(['mecanico']);
  });
});
