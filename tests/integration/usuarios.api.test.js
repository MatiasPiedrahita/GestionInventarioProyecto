const { crearContexto, CLAVE_DE_PRUEBA } = require('../helpers/contexto');
const { ordenValida } = require('../helpers/datos');

describe('API /api/usuarios · panel de administración (integración)', () => {
  let ctx;
  let dueno;
  let admin;

  beforeEach(() => {
    ctx = crearContexto();
    dueno = ctx.como('dueno');
    admin = ctx.como('administrador');
  });

  const nuevo = (cambios = {}) => ({ usuario: 'luis', nombre: 'Luis Carlos Moreno', rol: 'mecanico', email: 'luis@taller.co', ...cambios });
  const login = (usuario, password) => ctx.anonimo().post('/api/auth/login').send({ usuario, password });
  const auditoria = (accion) => ctx.db.prepare('SELECT usuario_id, entidad_id, detalle FROM auditoria WHERE accion = ? ORDER BY id').all(accion);

  describe('quién entra', () => {
    test.each([['mecanico'], ['recepcionista']])('%s no puede ver ni modificar usuarios, auditoría ni sistema (403)', async (rol) => {
      const cliente = ctx.como(rol);
      const { id } = ctx.usuario('dueno');

      const respuestas = await Promise.all([
        cliente.get('/api/usuarios'),
        cliente.post('/api/usuarios').send(nuevo()),
        cliente.put(`/api/usuarios/${id}`).send({ nombre: 'x', rol: 'mecanico' }),
        cliente.patch(`/api/usuarios/${id}/estado`).send({ activo: false }),
        cliente.post(`/api/usuarios/${id}/password`),
        cliente.post(`/api/usuarios/${id}/desbloqueo`),
        cliente.delete(`/api/usuarios/${id}/sesiones`),
        cliente.get('/api/auditoria'),
        cliente.get('/api/auditoria/acciones'),
        cliente.get('/api/sistema/estado'),
      ]);

      expect(respuestas.map((r) => r.status)).toEqual(Array(10).fill(403));
    });

    test('sin sesión responde 401; todos los roles siguen pudiendo listar los mecánicos', async () => {
      expect((await ctx.anonimo().get('/api/usuarios')).status).toBe(401);
      expect((await ctx.como('recepcionista').get('/api/usuarios/mecanicos')).status).toBe(200);
    });
  });

  describe('listado', () => {
    test('devuelve cada cuenta con su estado, sin el hash de la contraseña, y marca cuáles puede gestionar el actor', async () => {
      ctx.usuario('mecanico');
      const res = await admin.get('/api/usuarios');

      expect(res.status).toBe(200);
      const porRol = Object.fromEntries(res.body.usuarios.map((u) => [u.rol, u]));
      expect(porRol.mecanico).toMatchObject({ nombreRol: 'Mecánico', activo: true, bloqueado: false, sesionesAbiertas: 1, gestionable: true, esYo: false });
      expect(porRol.dueno).toMatchObject({ gestionable: false, esYo: false });
      expect(porRol.administrador).toMatchObject({ gestionable: false, esYo: true });
      expect(JSON.stringify(res.body)).not.toMatch(/password_hash|passwordHash|scrypt/);
      expect(res.body.rolesAsignables.map((r) => r.rol)).toEqual(['mecanico', 'recepcionista']);
    });

    test('el dueño puede gestionar a todos menos a sí mismo y asignar cualquier rol', async () => {
      ctx.usuario('administrador');
      const res = await dueno.get('/api/usuarios');

      expect(res.body.usuarios.map((u) => [u.rol, u.gestionable])).toEqual([['administrador', true], ['dueno', false]]);
      expect(res.body.rolesAsignables.map((r) => r.rol)).toEqual(['dueno', 'mecanico', 'recepcionista', 'administrador']);
    });
  });

  describe('crear', () => {
    test('el administrador crea un mecánico: recibe una contraseña temporal que obliga a cambiarla al entrar', async () => {
      const res = await admin.post('/api/usuarios').send(nuevo());

      expect(res.status).toBe(201);
      expect(res.body.usuario).toMatchObject({ usuario: 'luis', rol: 'mecanico', email: 'luis@taller.co', debeCambiarPassword: true, activo: true });
      expect(res.body.passwordTemporal).toMatch(/^[a-zA-Z0-9]{12}$/);

      const sesion = await login('luis', res.body.passwordTemporal);
      expect(sesion.status).toBe(200);
      expect(sesion.body.usuario.debeCambiarPassword).toBe(true);
      const bloqueada = await ctx.anonimo().get('/api/ordenes').set('Authorization', `Bearer ${sesion.body.token}`);
      expect(bloqueada.body.error).toBe('CAMBIO_DE_PASSWORD_REQUERIDO');
      expect(auditoria('USUARIO_CREADO')).toEqual([
        { usuario_id: ctx.usuario('administrador').id, entidad_id: res.body.usuario.id, detalle: 'luis: rol Mecánico' },
      ]);
      expect(JSON.stringify(ctx.db.prepare('SELECT * FROM auditoria').all())).not.toContain(res.body.passwordTemporal);
    });

    test.each([['dueno'], ['administrador']])('el administrador no puede crear un %s (403); el dueño sí', async (rol) => {
      const porAdmin = await admin.post('/api/usuarios').send(nuevo({ rol }));
      const porDueno = await dueno.post('/api/usuarios').send(nuevo({ rol }));

      expect(porAdmin.status).toBe(403);
      expect(porDueno.status).toBe(201);
      expect(porDueno.body.usuario.rol).toBe(rol);
    });

    test('valida los datos (400) y no admite usuarios repetidos (409)', async () => {
      const invalido = await admin.post('/api/usuarios').send({ usuario: 'x', nombre: '', rol: 'jefe', email: 'malo' });
      await admin.post('/api/usuarios').send(nuevo());
      const repetido = await admin.post('/api/usuarios').send(nuevo({ usuario: 'LUIS' }));

      expect(invalido.status).toBe(400);
      expect(invalido.body.detalles.map((d) => d.campo)).toEqual(['usuario', 'nombre', 'rol', 'email']);
      expect(repetido.status).toBe(409);
      expect((await admin.post('/api/usuarios')).status).toBe(400);
    });
  });

  describe('editar', () => {
    test('cambia nombre, rol y correo; si cambia el rol se cierran las sesiones del usuario', async () => {
      const mecanico = ctx.como('mecanico');
      const { id } = ctx.usuario('mecanico');

      const res = await admin.put(`/api/usuarios/${id}`).send({ nombre: 'Andrés Gómez', rol: 'recepcionista', email: 'andres@taller.co' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nombre: 'Andrés Gómez', rol: 'recepcionista', nombreRol: 'Recepcionista', email: 'andres@taller.co' });
      expect((await mecanico.get('/api/auth/yo')).status).toBe(401);
      expect(auditoria('USUARIO_EDITADO')[0].detalle).toBe('mecanico.prueba: nombre, rol de Mecánico a Recepcionista, correo');
    });

    test('si solo cambia el nombre, la sesión del usuario sigue abierta', async () => {
      const mecanico = ctx.como('mecanico');
      const { id } = ctx.usuario('mecanico');

      await admin.put(`/api/usuarios/${id}`).send({ nombre: 'Otro Nombre', rol: 'mecanico' });

      expect((await mecanico.get('/api/auth/yo')).body.usuario.nombre).toBe('Otro Nombre');
    });

    test('el administrador no puede editar al dueño ni a otro administrador, ni ascender a alguien a administrador', async () => {
      const mecanico = ctx.usuario('mecanico');
      const otroAdmin = ctx.usuario('administrador', 'otro');

      const alDueno = await admin.put(`/api/usuarios/${ctx.usuario('dueno').id}`).send({ nombre: 'Hackeado', rol: 'dueno' });
      const alAdmin = await admin.put(`/api/usuarios/${otroAdmin.id}`).send({ nombre: 'x', rol: 'mecanico' });
      const ascenso = await admin.put(`/api/usuarios/${mecanico.id}`).send({ nombre: mecanico.nombre, rol: 'administrador' });

      expect([alDueno.status, alAdmin.status, ascenso.status]).toEqual([403, 403, 403]);
      expect(alDueno.body.mensaje).toBe('Solo el dueño puede modificar la cuenta de un dueño del taller');
      expect(ctx.db.prepare('SELECT rol FROM usuarios WHERE id = ?').get(mecanico.id).rol).toBe('mecanico');
    });

    test('un mecánico con órdenes en proceso no puede cambiar de rol hasta reasignarlas (409)', async () => {
      await ctx.como('mecanico').post('/api/ordenes').send(ordenValida());
      const { id, nombre } = ctx.usuario('mecanico');

      const res = await admin.put(`/api/usuarios/${id}`).send({ nombre, rol: 'recepcionista' });

      expect(res.status).toBe(409);
      expect(res.body.mensaje).toBe('Mecánico de Prueba tiene 1 orden en proceso. Reasígnalas o ciérralas antes de cambiarle el rol');
    });

    test('nadie cambia su propio rol (409), pero el dueño sí puede corregir su nombre y su correo', async () => {
      const yo = ctx.usuario('dueno');

      const rol = await dueno.put(`/api/usuarios/${yo.id}`).send({ nombre: yo.nombre, rol: 'mecanico' });
      const datos = await dueno.put(`/api/usuarios/${yo.id}`).send({ nombre: 'Jorge Restrepo', rol: 'dueno', email: 'jorge@taller.co' });

      expect(rol.status).toBe(409);
      expect(rol.body.mensaje).toBe('No puedes cambiar tu propio rol');
      expect(datos.status).toBe(200);
      expect(datos.body).toMatchObject({ nombre: 'Jorge Restrepo', rol: 'dueno', email: 'jorge@taller.co', esYo: true });
      expect((await dueno.get('/api/auth/yo')).status).toBe(200);
    });

    test('el único dueño activo no puede dejar de serlo: otro dueño no le puede quitar el rol (409)', async () => {
      const principal = ctx.usuario('dueno');
      const socio = ctx.como('dueno', 'socio');
      const idSocio = ctx.usuario('dueno', 'socio').id;
      // El socio desactiva al principal: ahora el socio es el único dueño activo...
      expect((await socio.patch(`/api/usuarios/${principal.id}/estado`).send({ activo: false })).status).toBe(200);
      // ...y un administrador ascendido a dueño no existe todavía, así que nadie más puede tocarlo.
      const otro = ctx.servicios.auth.crearUsuario({ usuario: 'tercero', nombre: 'Tercer Dueño', rol: 'dueno', password: CLAVE_DE_PRUEBA });
      ctx.db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(otro.id);
      const tercero = ctx.servicios.usuarios;

      expect(() => tercero.editar(idSocio, { nombre: 'Socio', rol: 'mecanico' }, { id: otro.id, rol: 'dueno' }))
        .toThrow('es el único dueño activo');
      expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'dueno' AND activo = 1").get().n).toBe(1);
    });

    test('responde 400 con datos inválidos y 404 si el usuario no existe', async () => {
      const { id } = ctx.usuario('mecanico');

      expect((await admin.put(`/api/usuarios/${id}`).send({ nombre: '', rol: 'mecanico' })).status).toBe(400);
      expect((await admin.put('/api/usuarios/999').send({ nombre: 'x', rol: 'mecanico' })).status).toBe(404);
      expect((await admin.put('/api/usuarios/abc').send({ nombre: 'x', rol: 'mecanico' })).status).toBe(400);
    });
  });

  describe('activar y desactivar', () => {
    test('desactivar cierra las sesiones y el usuario ya no puede entrar; reactivar le devuelve el acceso', async () => {
      const mecanico = ctx.como('mecanico');
      const usuario = ctx.usuario('mecanico');

      const baja = await admin.patch(`/api/usuarios/${usuario.id}/estado`).send({ activo: false });

      expect(baja.status).toBe(200);
      expect(baja.body.activo).toBe(false);
      expect((await mecanico.get('/api/auth/yo')).status).toBe(401);
      expect((await login(usuario.usuario, CLAVE_DE_PRUEBA)).status).toBe(401);

      const alta = await admin.patch(`/api/usuarios/${usuario.id}/estado`).send({ activo: true });
      expect(alta.body.activo).toBe(true);
      expect((await login(usuario.usuario, CLAVE_DE_PRUEBA)).status).toBe(200);
      expect(auditoria('USUARIO_DESACTIVADO')).toHaveLength(1);
      expect(auditoria('USUARIO_ACTIVADO')).toHaveLength(1);
    });

    test('repetir el mismo estado no hace nada ni llena la auditoría', async () => {
      const { id } = ctx.usuario('mecanico');

      const res = await admin.patch(`/api/usuarios/${id}/estado`).send({ activo: true });

      expect(res.status).toBe(200);
      expect(auditoria('USUARIO_ACTIVADO')).toHaveLength(0);
    });

    test('nadie se desactiva a sí mismo (409)', async () => {
      const res = await dueno.patch(`/api/usuarios/${ctx.usuario('dueno').id}/estado`).send({ activo: false });

      expect(res.status).toBe(409);
      expect(res.body.mensaje).toBe('No puedes desactivar tu propia cuenta');
    });

    test('no se puede desactivar al único dueño activo: el taller no puede quedar sin dueño', async () => {
      const principal = ctx.usuario('dueno');
      const idSocio = ctx.usuario('dueno', 'socio').id;
      const socio = ctx.como('dueno', 'socio');

      // Con dos dueños activos, uno puede desactivar al otro.
      const primero = await dueno.patch(`/api/usuarios/${idSocio}/estado`).send({ activo: false });
      // El socio ya no tiene sesión; y aunque la tuviera, el principal es el único dueño que queda.
      const servicio = ctx.servicios.usuarios;

      expect(primero.status).toBe(200);
      expect((await socio.get('/api/auth/yo')).status).toBe(401);
      expect(() => servicio.cambiarActivo(principal.id, { activo: false }, { id: idSocio, rol: 'dueno' }))
        .toThrow('es el único dueño activo');
      expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'dueno' AND activo = 1").get().n).toBe(1);
    });

    test('un mecánico con órdenes en proceso no se puede desactivar hasta reasignarlas (409)', async () => {
      const mecanico = ctx.como('mecanico');
      const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
      const { id } = ctx.usuario('mecanico');

      const conTrabajo = await admin.patch(`/api/usuarios/${id}/estado`).send({ activo: false });
      await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'FINALIZADA' });
      const sinTrabajo = await admin.patch(`/api/usuarios/${id}/estado`).send({ activo: false });

      expect(conTrabajo.status).toBe(409);
      expect(conTrabajo.body.mensaje).toMatch(/tiene 1 orden en proceso/);
      expect(sinTrabajo.status).toBe(200);
    });

    test('el administrador no puede desactivar al dueño (403); valida el cuerpo (400)', async () => {
      const { id } = ctx.usuario('mecanico');

      expect((await admin.patch(`/api/usuarios/${ctx.usuario('dueno').id}/estado`).send({ activo: false })).status).toBe(403);
      expect((await admin.patch(`/api/usuarios/${id}/estado`).send({ activo: 'no' })).status).toBe(400);
      expect((await admin.patch(`/api/usuarios/${id}/estado`)).status).toBe(400);
    });
  });

  describe('contraseñas, sesiones y bloqueos', () => {
    test('restablecer: la contraseña anterior deja de servir, se cierran las sesiones y la temporal obliga a cambiarla', async () => {
      const mecanico = ctx.como('mecanico');
      const usuario = ctx.usuario('mecanico');

      const res = await admin.post(`/api/usuarios/${usuario.id}/password`);

      expect(res.status).toBe(200);
      expect(res.body.usuario.debeCambiarPassword).toBe(true);
      expect((await mecanico.get('/api/auth/yo')).status).toBe(401);
      expect((await login(usuario.usuario, CLAVE_DE_PRUEBA)).status).toBe(401);
      expect((await login(usuario.usuario, res.body.passwordTemporal)).body.usuario.debeCambiarPassword).toBe(true);
      expect(auditoria('PASSWORD_RESTABLECIDA')).toHaveLength(1);
    });

    test('restablecer también quita el bloqueo por intentos fallidos', async () => {
      const usuario = ctx.usuario('mecanico');
      for (let i = 0; i < 5; i += 1) await login(usuario.usuario, 'incorrecta');
      expect((await login(usuario.usuario, CLAVE_DE_PRUEBA)).status).toBe(429);

      const { body } = await admin.post(`/api/usuarios/${usuario.id}/password`);

      expect((await login(usuario.usuario, body.passwordTemporal)).status).toBe(200);
    });

    test('no se restablece la propia desde administración (409) ni la del dueño siendo administrador (403)', async () => {
      expect((await admin.post(`/api/usuarios/${ctx.usuario('administrador').id}/password`)).status).toBe(409);
      expect((await admin.post(`/api/usuarios/${ctx.usuario('dueno').id}/password`)).status).toBe(403);
      expect((await login(ctx.usuario('dueno').usuario, CLAVE_DE_PRUEBA)).status).toBe(200);
    });

    test('desbloquear deja entrar de inmediato y el listado refleja el bloqueo antes y después', async () => {
      const usuario = ctx.usuario('mecanico');
      for (let i = 0; i < 5; i += 1) await login(usuario.usuario, 'incorrecta');
      const bloqueado = (await admin.get('/api/usuarios')).body.usuarios.find((u) => u.id === usuario.id);

      const res = await admin.post(`/api/usuarios/${usuario.id}/desbloqueo`);

      expect(bloqueado.bloqueado).toBe(true);
      expect(res.status).toBe(200);
      expect(res.body.bloqueado).toBeUndefined();
      expect((await admin.get('/api/usuarios')).body.usuarios.find((u) => u.id === usuario.id).bloqueado).toBe(false);
      expect((await login(usuario.usuario, CLAVE_DE_PRUEBA)).status).toBe(200);
      expect(auditoria('USUARIO_DESBLOQUEADO')).toHaveLength(1);
    });

    test('cerrar sesiones saca al usuario de todos sus dispositivos sin tocar su contraseña', async () => {
      const mecanico = ctx.como('mecanico');
      const usuario = ctx.usuario('mecanico');
      await login(usuario.usuario, CLAVE_DE_PRUEBA);

      const res = await admin.delete(`/api/usuarios/${usuario.id}/sesiones`);

      expect(res.body).toEqual({ cerradas: 2 });
      expect((await mecanico.get('/api/auth/yo')).status).toBe(401);
      expect((await login(usuario.usuario, CLAVE_DE_PRUEBA)).status).toBe(200);
      expect((await admin.delete(`/api/usuarios/${ctx.usuario('dueno').id}/sesiones`)).status).toBe(403);
    });
  });

  describe('GET /api/auditoria', () => {
    test('lista de lo más reciente a lo más antiguo, con el nombre de la acción y de quien la hizo', async () => {
      await admin.post('/api/usuarios').send(nuevo());

      const res = await admin.get('/api/auditoria').query({ accion: 'USUARIO_CREADO' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ pagina: 1, tamano: 20, total: 1, totalPaginas: 1 });
      expect(res.body.datos[0]).toMatchObject({
        accion: 'USUARIO_CREADO',
        accionNombre: 'Usuario creado',
        entidad: 'usuario',
        detalle: 'luis: rol Mecánico',
        usuario: { usuario: 'administrador.prueba', nombre: 'Administrador de Prueba' },
      });
    });

    test('filtra por usuario y pagina', async () => {
      const mecanico = ctx.usuario('mecanico');
      for (let i = 0; i < 3; i += 1) await login(mecanico.usuario, 'incorrecta');

      const res = await admin.get('/api/auditoria').query({ usuarioId: mecanico.id, accion: 'LOGIN_FALLIDO', tamano: 2, pagina: 2 });

      expect(res.body).toMatchObject({ total: 3, totalPaginas: 2, pagina: 2 });
      expect(res.body.datos).toHaveLength(1);
      expect(res.body.datos[0].detalle).toBe('Intento 1 de 5');
    });

    test('los intentos con un usuario inexistente aparecen sin autor', async () => {
      await login('fantasma', 'incorrecta');

      const res = await admin.get('/api/auditoria').query({ accion: 'LOGIN_FALLIDO' });

      expect(res.body.datos[0]).toMatchObject({ usuario: null, detalle: 'Usuario inexistente' });
    });

    test('filtra por rango de fechas y rechaza filtros inválidos (400)', async () => {
      const hoy = new Date().toISOString().slice(0, 10);

      const deHoy = await admin.get('/api/auditoria').query({ desde: hoy, hasta: hoy });
      const delPasado = await admin.get('/api/auditoria').query({ hasta: '2020-01-01' });
      const invalido = await admin.get('/api/auditoria').query({ desde: 'ayer', accion: 'x' });

      expect(deHoy.body.total).toBeGreaterThan(0);
      expect(delPasado.body.total).toBe(0);
      expect(invalido.status).toBe(400);
      expect(invalido.body.detalles.map((d) => d.campo)).toEqual(['accion', 'desde']);
    });

    test('GET /api/auditoria/acciones devuelve el catálogo para armar el filtro', async () => {
      const res = await admin.get('/api/auditoria/acciones');

      expect(res.body).toContainEqual({ accion: 'LOGIN_FALLIDO', nombre: 'Intento fallido de inicio de sesión' });
      expect(res.body.every((a) => a.accion && a.nombre)).toBe(true);
    });

    test('la auditoría no se puede modificar ni borrar por la API', async () => {
      expect((await admin.post('/api/auditoria').send({ accion: 'LOGIN_OK' })).status).toBe(404);
      expect((await admin.delete('/api/auditoria/1')).status).toBe(404);
    });
  });

  describe('GET /api/sistema/estado', () => {
    test('informa versiones y tamaño de los datos', async () => {
      await ctx.como('mecanico').post('/api/ordenes').send(ordenValida());

      const res = await admin.get('/api/sistema/estado');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
        versionDelEsquema: expect.any(Number),
        node: process.version,
        minutosEncendido: expect.any(Number),
        datos: { usuariosActivos: 3, usuariosInactivos: 0, sesionesAbiertas: 3, repuestosActivos: 0, ordenes: 1, ordenesEnProceso: 1 },
      });
    });

    test('otros módulos pueden sumar su propia sección al estado', () => {
      ctx.servicios.sistema.registrarSeccion('correo', () => ({ modo: 'simulado' }));

      expect(ctx.servicios.sistema.estado().correo).toEqual({ modo: 'simulado' });
    });
  });
});
