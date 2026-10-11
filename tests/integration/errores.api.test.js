const { crearContexto } = require('../helpers/contexto');

describe('Respuestas de error de la API (integración)', () => {
  test('una ruta que no existe responde 404 con el formato común, y 401 si no hay sesión', async () => {
    const ctx = crearContexto();

    const conSesion = await ctx.como('dueno').get('/api/no-existe');
    const sinSesion = await ctx.anonimo().get('/api/no-existe');

    expect(conSesion.status).toBe(404);
    expect(conSesion.body).toEqual({ error: 'RUTA_NO_ENCONTRADA', mensaje: 'No existe GET /api/no-existe', detalles: [] });
    expect(sinSesion.status).toBe(401);
  });

  test('un JSON mal formado en el login responde 400 JSON_INVALIDO', async () => {
    const ctx = crearContexto();
    const res = await ctx.anonimo().post('/api/auth/login').set('Content-Type', 'application/json').send('{"usuario": ');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('JSON_INVALIDO');
  });

  test('el login sin cuerpo responde 400 en lugar de fallar', async () => {
    const ctx = crearContexto();
    const res = await ctx.anonimo().post('/api/auth/login');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDACION');
  });

  test('un cuerpo JSON de más de 100 kB responde 413', async () => {
    const ctx = crearContexto();
    const res = await ctx.como('dueno').post('/api/repuestos').send({ nombre: 'x'.repeat(120 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.error).toBe('ARCHIVO_GRANDE');
  });

  test('un CSV de más de 1 MB responde 413', async () => {
    const ctx = crearContexto();
    const csv = `sku,nombre,costo,stockActual\n${'A-1,Tornillo,500,1\n'.repeat(60000)}`;
    const res = await ctx.como('dueno').post('/api/repuestos/importar').set('Content-Type', 'text/csv').send(csv);

    expect(res.status).toBe(413);
  });

  describe('fallo inesperado (la base de datos deja de responder)', () => {
    const entornoOriginal = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = entornoOriginal;
      jest.restoreAllMocks();
    });

    test('responde 500 genérico, sin filtrar el detalle técnico al cliente', async () => {
      const ctx = crearContexto();
      const dueno = ctx.como('dueno');
      ctx.db.close();

      const res = await dueno.get('/api/repuestos');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado', detalles: [] });
      expect(JSON.stringify(res.body)).not.toMatch(/database|sqlite|stack/i);
    });

    test('fuera de las pruebas, el detalle queda en el registro del servidor', async () => {
      const ctx = crearContexto();
      const dueno = ctx.como('dueno');
      ctx.db.close();
      process.env.NODE_ENV = 'production';
      const registro = jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await dueno.get('/api/repuestos');

      expect(res.status).toBe(500);
      expect(registro).toHaveBeenCalledTimes(1);
      expect(registro.mock.calls[0][0].message).toEqual(expect.any(String));
    });
  });

  test('un id que no es entero positivo responde 400 en órdenes', async () => {
    const ctx = crearContexto();
    const mecanico = ctx.como('mecanico');

    expect((await mecanico.get('/api/ordenes/abc')).status).toBe(400);
    expect((await mecanico.get('/api/ordenes/0')).status).toBe(400);
    expect((await mecanico.patch('/api/ordenes/-3/notas').send({ notas: 'x' })).status).toBe(400);
  });
});
