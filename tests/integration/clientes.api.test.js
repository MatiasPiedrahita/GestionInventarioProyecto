const { crearContexto } = require('../helpers/contexto');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('Recepción: directorio de clientes y vehículos (integración)', () => {
  let ctx;
  let recepcion;
  let mecanico;
  let camila;

  beforeEach(async () => {
    ctx = crearContexto();
    recepcion = ctx.como('recepcionista');
    mecanico = ctx.como('mecanico');
    // Camila tiene dos vehículos y tres órdenes; Juan, un vehículo y una orden.
    const primera = await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.post('/api/ordenes').send(ordenValida({ descripcion: 'Cambio de aceite' }));
    await mecanico.post('/api/ordenes').send(ordenValida({ vehiculo: { placa: 'XYZ98D', marca: 'Yamaha', modelo: 'NMAX' }, descripcion: 'Revisión de frenos' }));
    await mecanico.post('/api/ordenes').send(ordenValida({
      cliente: { documento: '71555444', nombre: 'Juan Pérez', telefono: '3012223344' },
      vehiculo: { placa: 'DEF456', marca: 'Renault', modelo: 'Logan', anio: 2020 },
    }));
    camila = primera.body.cliente;
  });

  describe('quién entra', () => {
    test('el mecánico no puede consultar ni editar el directorio (403); sin sesión, 401', async () => {
      const respuestas = await Promise.all([
        mecanico.get('/api/clientes'),
        mecanico.get(`/api/clientes/${camila.id}`),
        mecanico.put(`/api/clientes/${camila.id}`).send({ nombre: 'x', telefono: '3000000000' }),
        mecanico.get('/api/vehiculos/ABC123'),
      ]);

      expect(respuestas.map((r) => r.status)).toEqual([403, 403, 403, 403]);
      expect((await ctx.anonimo().get('/api/clientes')).status).toBe(401);
    });

    test.each([['recepcionista'], ['dueno'], ['administrador']])('%s sí puede', async (rol) => {
      expect((await ctx.como(rol).get('/api/clientes')).status).toBe(200);
      expect((await ctx.como(rol).get('/api/vehiculos/ABC123')).status).toBe(200);
    });
  });

  describe('GET /api/clientes', () => {
    test('lista por nombre con el conteo de vehículos y órdenes de cada cliente', async () => {
      const res = await recepcion.get('/api/clientes');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ pagina: 1, tamano: 15, total: 2, totalPaginas: 1 });
      expect(res.body.datos.map((c) => [c.nombre, c.documento, c.vehiculos, c.ordenes])).toEqual([
        ['Camila Ortiz', '1037654321', 2, 3],
        ['Juan Pérez', '71555444', 1, 1],
      ]);
      expect(res.body.datos[0].ultimaOrden).toEqual(expect.any(String));
    });

    test.each([
      ['parte del nombre', 'camil', ['Camila Ortiz']],
      ['el nombre sin importar mayúsculas', 'JUAN', ['Juan Pérez']],
      ['el inicio del documento', '7155', ['Juan Pérez']],
      ['parte del teléfono', '222334', ['Juan Pérez']],
      ['la placa exacta de uno de sus vehículos', 'XYZ98D', ['Camila Ortiz']],
      ['la placa escrita con guion y minúsculas', 'def-456', ['Juan Pérez']],
      ['una placa incompleta', 'DEF45', []],
      ['algo que nadie tiene', 'zzzz', []],
    ])('busca por %s', async (_, q, nombres) => {
      const res = await recepcion.get('/api/clientes').query({ q });

      expect(res.body.datos.map((c) => c.nombre)).toEqual(nombres);
      expect(res.body.total).toBe(nombres.length);
    });

    test('?documento= busca el documento exacto (para completar el formulario de una orden)', async () => {
      const exacto = await recepcion.get('/api/clientes').query({ documento: '71555444' });
      const parcial = await recepcion.get('/api/clientes').query({ documento: '7155' });

      expect(exacto.body.datos.map((c) => c.nombre)).toEqual(['Juan Pérez']);
      expect(parcial.body.datos).toEqual([]);
    });

    test('pagina y valida los parámetros', async () => {
      const segunda = await recepcion.get('/api/clientes').query({ tamano: 1, pagina: 2 });
      const invalida = await recepcion.get('/api/clientes').query({ tamano: 500 });

      expect(segunda.body).toMatchObject({ total: 2, totalPaginas: 2, pagina: 2 });
      expect(segunda.body.datos.map((c) => c.nombre)).toEqual(['Juan Pérez']);
      expect(invalida.status).toBe(400);
    });

    test('los comodines de SQL escritos en la búsqueda no rompen la consulta ni inyectan nada', async () => {
      const inyeccion = await recepcion.get('/api/clientes').query({ q: "' OR 1=1 --" });
      const comodin = await recepcion.get('/api/clientes').query({ q: "x'; DROP TABLE clientes; --" });

      expect(inyeccion.status).toBe(200);
      expect(inyeccion.body.datos).toEqual([]);
      expect(comodin.status).toBe(200);
      expect((await recepcion.get('/api/clientes')).body.total).toBe(2);
    });
  });

  describe('GET /api/clientes/:id', () => {
    test('devuelve la ficha con sus vehículos y su historial de órdenes, de la más reciente a la más antigua', async () => {
      const res = await recepcion.get(`/api/clientes/${camila.id}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ documento: '1037654321', nombre: 'Camila Ortiz', telefono: '3001234567', email: 'camila@ejemplo.com' });
      expect(res.body.vehiculos).toEqual([
        expect.objectContaining({ placa: 'ABC123', marca: 'Chevrolet', modelo: 'Spark GT', anio: 2018, ordenes: 2 }),
        expect.objectContaining({ placa: 'XYZ98D', marca: 'Yamaha', ordenes: 1 }),
      ]);
      expect(res.body.ordenes.map((o) => [o.placa, o.descripcion, o.estadoNombre, o.mecanico])).toEqual([
        ['XYZ98D', 'Revisión de frenos', 'En proceso', 'Mecánico de Prueba'],
        ['ABC123', 'Cambio de aceite', 'En proceso', 'Mecánico de Prueba'],
        ['ABC123', 'Ruido metálico al frenar y vibración en el timón', 'En proceso', 'Mecánico de Prueba'],
      ]);
    });

    test('404 si no existe y 400 si el id no es válido', async () => {
      expect((await recepcion.get('/api/clientes/999')).status).toBe(404);
      expect((await recepcion.get('/api/clientes/abc')).status).toBe(400);
    });
  });

  describe('PUT /api/clientes/:id', () => {
    test('corrige el contacto, conserva el documento y lo deja en la auditoría', async () => {
      const res = await recepcion.put(`/api/clientes/${camila.id}`).send({
        nombre: 'Camila Ortiz Restrepo', telefono: '3119998877', email: '', documento: '999',
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nombre: 'Camila Ortiz Restrepo', telefono: '3119998877', email: null, documento: '1037654321' });
      expect(res.body.vehiculos).toHaveLength(2);
      expect(ctx.db.prepare("SELECT usuario_id, entidad_id, detalle FROM auditoria WHERE accion = 'CLIENTE_EDITADO'").get()).toEqual({
        usuario_id: ctx.usuario('recepcionista').id, entidad_id: camila.id, detalle: 'Camila Ortiz (1037654321): nombre, teléfono, correo',
      });
    });

    test('guardar sin cambios no llena la auditoría', async () => {
      await recepcion.put(`/api/clientes/${camila.id}`).send({ nombre: 'Camila Ortiz', telefono: '3001234567', email: 'camila@ejemplo.com' });

      expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'CLIENTE_EDITADO'").get().n).toBe(0);
    });

    test('valida los datos (400) y que el cliente exista (404)', async () => {
      const invalido = await recepcion.put(`/api/clientes/${camila.id}`).send({ nombre: '', telefono: 'abc', email: 'malo' });

      expect(invalido.status).toBe(400);
      expect(invalido.body.detalles.map((d) => d.campo)).toEqual(['nombre', 'telefono', 'email']);
      expect((await recepcion.put('/api/clientes/999').send({ nombre: 'x', telefono: '3000000000' })).status).toBe(404);
      expect((await recepcion.get(`/api/clientes/${camila.id}`)).body.nombre).toBe('Camila Ortiz');
    });
  });

  describe('GET /api/vehiculos/:placa', () => {
    test('devuelve el vehículo, su dueño actual y todas sus órdenes, aunque la placa llegue con guion', async () => {
      const res = await recepcion.get('/api/vehiculos/abc-123');

      expect(res.status).toBe(200);
      expect(res.body.vehiculo).toMatchObject({ placa: 'ABC123', marca: 'Chevrolet', modelo: 'Spark GT', anio: 2018 });
      expect(res.body.cliente).toMatchObject({ documento: '1037654321', nombre: 'Camila Ortiz' });
      expect(res.body.ordenes.map((o) => o.descripcion)).toEqual(['Cambio de aceite', 'Ruido metálico al frenar y vibración en el timón']);
    });

    test('si el vehículo cambió de dueño, el historial conserva quién lo trajo en cada orden', async () => {
      await mecanico.post('/api/ordenes').send(ordenValida({
        cliente: { documento: '71555444', nombre: 'Juan Pérez', telefono: '3012223344' },
        descripcion: 'Revisión por compra',
      }));

      const res = await recepcion.get('/api/vehiculos/ABC123');

      expect(res.body.cliente.nombre).toBe('Juan Pérez');
      expect(res.body.ordenes.map((o) => o.cliente)).toEqual(['Juan Pérez', 'Camila Ortiz', 'Camila Ortiz']);
    });

    test('400 si la placa no tiene formato válido y 404 si no está registrada', async () => {
      expect((await recepcion.get('/api/vehiculos/12')).status).toBe(400);
      expect((await recepcion.get('/api/vehiculos/ZZZ999')).status).toBe(404);
    });
  });

  describe('GET /api/ordenes/mi-resumen (mecánico)', () => {
    test('cuenta sus órdenes abiertas, las que cerró y los repuestos que usó en 30 días', async () => {
      const { body: filtro } = await ctx.como('dueno').post('/api/repuestos').send(repuestoValido({ stockActual: 20 }));
      const { body: lista } = await mecanico.get('/api/ordenes');
      const [reciente, otra, antigua] = lista.datos;
      await mecanico.post(`/api/ordenes/${reciente.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 3 }] });
      await mecanico.post(`/api/ordenes/${otra.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 5 }] });
      await mecanico.patch(`/api/ordenes/${reciente.id}/estado`).send({ estado: 'FINALIZADA' });
      await mecanico.patch(`/api/ordenes/${otra.id}/estado`).send({ estado: 'CANCELADA', motivo: 'Desistió' });
      ctx.db.prepare("UPDATE ordenes SET creado_en = datetime('now', '-4 days', '-1 hours') WHERE id = ?").run(antigua.id);

      const res = await mecanico.get('/api/ordenes/mi-resumen');

      expect(res.status).toBe(200);
      // Los 5 repuestos de la orden cancelada se devolvieron: no cuentan como usados.
      expect(res.body).toEqual({ enProceso: 2, finalizadas: 1, repuestosUsados: 3, diasDeLaMasAntigua: 4, dias: 30 });
    });

    test('cada mecánico ve solo lo suyo; sin órdenes, todo en cero', async () => {
      const res = await ctx.como('mecanico', 'felipe').get('/api/ordenes/mi-resumen');

      expect(res.body).toEqual({ enProceso: 0, finalizadas: 0, repuestosUsados: 0, diasDeLaMasAntigua: null, dias: 30 });
    });

    test('es solo para mecánicos (403 para los demás roles)', async () => {
      expect((await recepcion.get('/api/ordenes/mi-resumen')).status).toBe(403);
      expect((await ctx.como('dueno').get('/api/ordenes/mi-resumen')).status).toBe(403);
    });
  });
});
