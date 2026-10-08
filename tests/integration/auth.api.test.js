const { crearContexto, CLAVE_DE_PRUEBA } = require('../helpers/contexto');

describe('API /api/auth (integración)', () => {
  test.each([
    ['dueno', 'inventario'],
    ['administrador', 'inventario'],
    ['mecanico', 'ordenes'],
    ['recepcionista', 'ordenes'],
  ])('login de %s: entrega token, datos públicos y la vista "%s"', async (rol, vista) => {
    const ctx = crearContexto();
    const usuario = ctx.usuario(rol);

    const res = await ctx.anonimo().post('/api/auth/login').send({ usuario: usuario.usuario, password: CLAVE_DE_PRUEBA });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.vistaInicial).toBe(vista);
    expect(res.body.usuario).toMatchObject({ usuario: usuario.usuario, rol });
    expect(res.body.usuario).not.toHaveProperty('passwordHash');
  });

  test('responde el mismo 401 genérico si el usuario no existe o la contraseña es incorrecta', async () => {
    const ctx = crearContexto();
    const { usuario } = ctx.usuario('dueno');

    const malaClave = await ctx.anonimo().post('/api/auth/login').send({ usuario, password: 'incorrecta' });
    const noExiste = await ctx.anonimo().post('/api/auth/login').send({ usuario: 'nadie', password: 'incorrecta' });

    expect(malaClave.status).toBe(401);
    expect(noExiste.status).toBe(401);
    expect(malaClave.body.mensaje).toBe('Usuario o contraseña incorrectos');
    expect(noExiste.body.mensaje).toBe(malaClave.body.mensaje);
  });

  test('responde 400 si faltan usuario o contraseña', async () => {
    const ctx = crearContexto();
    const res = await ctx.anonimo().post('/api/auth/login').send({ usuario: '' });
    expect(res.status).toBe(400);
  });

  test('sin token o con token inventado, las rutas protegidas responden 401', async () => {
    const ctx = crearContexto();
    const sinToken = await ctx.anonimo().get('/api/repuestos');
    const tokenFalso = await ctx.anonimo().get('/api/repuestos').set('Authorization', 'Bearer inventado');

    expect(sinToken.status).toBe(401);
    expect(tokenFalso.status).toBe(401);
    expect(sinToken.body.error).toBe('NO_AUTENTICADO');
  });

  test('GET /api/auth/yo devuelve el usuario de la sesión', async () => {
    const ctx = crearContexto();
    const res = await ctx.como('mecanico').get('/api/auth/yo');

    expect(res.status).toBe(200);
    expect(res.body.usuario).toMatchObject({ rol: 'mecanico', nombreRol: 'Mecánico' });
  });

  test('logout invalida el token de inmediato', async () => {
    const ctx = crearContexto();
    const dueno = ctx.como('dueno');

    expect((await dueno.post('/api/auth/logout')).status).toBe(204);
    expect((await dueno.get('/api/repuestos')).status).toBe(401);
  });

  test('la sesión expira a las 8 horas', async () => {
    let reloj = new Date('2026-10-07T08:00:00Z');
    const ctx = crearContexto({ ahora: () => reloj });
    const dueno = ctx.como('dueno');

    expect((await dueno.get('/api/repuestos')).status).toBe(200);
    reloj = new Date('2026-10-07T16:01:00Z');
    const vencida = await dueno.get('/api/repuestos');
    expect(vencida.status).toBe(401);
    expect(vencida.body.mensaje).toMatch(/expiró/);
  });

  test('crear usuario valida datos y no permite usuarios repetidos', () => {
    const ctx = crearContexto();
    const { auth } = ctx.servicios;

    expect(() => auth.crearUsuario({ usuario: 'x', nombre: '', rol: 'jefe', password: '123' })).toThrow('no son válidos');
    auth.crearUsuario({ usuario: 'Luis.M', nombre: 'Luis', rol: 'mecanico', password: CLAVE_DE_PRUEBA });
    expect(() => auth.crearUsuario({ usuario: 'luis.m', nombre: 'Otro', rol: 'mecanico', password: CLAVE_DE_PRUEBA })).toThrow('ya existe');
  });
});
