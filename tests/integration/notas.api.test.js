const { crearContexto } = require('../helpers/contexto');
const { ordenValida } = require('../helpers/datos');

describe('API PATCH /api/ordenes/:id/notas (integración)', () => {
  let ctx;
  let mecanico;
  let orden;

  beforeEach(async () => {
    ctx = crearContexto();
    mecanico = ctx.como('mecanico');
    orden = (await mecanico.post('/api/ordenes').send(ordenValida())).body;
  });

  test('guarda la nota recortada y registra quién y cuándo la actualizó', async () => {
    const res = await mecanico.patch(`/api/ordenes/${orden.id}/notas`).send({ notas: '  Pastillas cambiadas. Discos dentro de tolerancia.  ' });

    expect(res.status).toBe(200);
    expect(res.body.notas).toBe('Pastillas cambiadas. Discos dentro de tolerancia.');
    expect(res.body.notasActualizadasPor).toBe(ctx.usuario('mecanico').nombre);
    expect(res.body.notasActualizadasEn).toEqual(expect.any(String));
  });

  test('una orden nueva no tiene notas y enviar texto vacío las borra', async () => {
    expect(orden.notas).toBeNull();
    await mecanico.patch(`/api/ordenes/${orden.id}/notas`).send({ notas: 'Algo' });

    const borrada = await mecanico.patch(`/api/ordenes/${orden.id}/notas`).send({ notas: '   ' });

    expect(borrada.body.notas).toBeNull();
  });

  test('valida tipo y longitud (400)', async () => {
    expect((await mecanico.patch(`/api/ordenes/${orden.id}/notas`).send({ notas: 123 })).status).toBe(400);
    expect((await mecanico.patch(`/api/ordenes/${orden.id}/notas`).send({})).status).toBe(400);
    expect((await mecanico.patch(`/api/ordenes/${orden.id}/notas`).send({ notas: 'x'.repeat(4001) })).status).toBe(400);
  });

  test('permisos: otro mecánico 403, recepcionista 403, dueño sí; 404 si la orden no existe', async () => {
    const cuerpo = { notas: 'Revisado' };
    expect((await ctx.como('mecanico', 'otro').patch(`/api/ordenes/${orden.id}/notas`).send(cuerpo)).status).toBe(403);
    expect((await ctx.como('recepcionista').patch(`/api/ordenes/${orden.id}/notas`).send(cuerpo)).status).toBe(403);
    expect((await ctx.como('dueno').patch(`/api/ordenes/${orden.id}/notas`).send(cuerpo)).status).toBe(200);
    expect((await ctx.como('dueno').patch('/api/ordenes/999/notas').send(cuerpo)).status).toBe(404);
  });
});
