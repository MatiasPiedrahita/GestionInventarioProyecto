const { crearContexto, CLAVE_DE_PRUEBA } = require('../helpers/contexto');
const { crearApp } = require('../../src/app');
const { ordenValida, repuestoValido } = require('../helpers/datos');

const CLAVE_NUEVA = 'otra-clave-mas-larga';

describe('Seguridad de la API (integración)', () => {
  describe('cabeceras', () => {
    test('toda respuesta lleva las cabeceras de seguridad y no revela la tecnología del servidor', async () => {
      const ctx = crearContexto();
      const res = await ctx.anonimo().get('/');

      expect(res.status).toBe(200);
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    });

    test('la política de contenido solo permite scripts propios y las fuentes de Google', async () => {
      const ctx = crearContexto();
      const csp = (await ctx.anonimo().get('/')).headers['content-security-policy'];

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self' https://fonts.googleapis.com");
      expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
      expect(csp).not.toContain('upgrade-insecure-requests');
    });

    test('la interfaz cumple su propia política: sin scripts ni estilos en línea, ni manejadores en el HTML', async () => {
      const ctx = crearContexto();
      const html = (await ctx.anonimo().get('/')).text;

      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
      expect(html).not.toMatch(/<style[\s>]/i);
      expect(html).not.toMatch(/\sstyle\s*=/i);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    });

    test('las respuestas de la API no se guardan en caché', async () => {
      const ctx = crearContexto();

      expect((await ctx.como('dueno').get('/api/repuestos')).headers['cache-control']).toBe('no-store');
      expect((await ctx.anonimo().get('/api/repuestos')).headers['cache-control']).toBe('no-store');
    });
  });

  describe('límite de intentos de inicio de sesión', () => {
    let reloj;
    let ctx;
    const login = (usuario, password) => ctx.anonimo().post('/api/auth/login').send({ usuario, password });
    const fallar = async (usuario, veces) => {
      const respuestas = [];
      for (let i = 0; i < veces; i += 1) respuestas.push(await login(usuario, 'incorrecta'));
      return respuestas;
    };

    beforeEach(() => {
      reloj = new Date('2026-10-12T08:00:00Z');
      ctx = crearContexto({ ahora: () => reloj });
    });

    test('tras 5 contraseñas incorrectas la cuenta queda bloqueada 15 minutos, incluso con la contraseña correcta', async () => {
      const { usuario } = ctx.usuario('mecanico');

      const fallos = await fallar(usuario, 5);
      const bloqueado = await login(usuario, CLAVE_DE_PRUEBA);

      expect(fallos.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
      expect(bloqueado.status).toBe(429);
      expect(bloqueado.body).toEqual({
        error: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos fallidos. Intenta de nuevo en 15 minutos', detalles: [],
      });
      expect(bloqueado.headers['retry-after']).toBe('900');

      reloj = new Date('2026-10-12T08:15:01Z');
      expect((await login(usuario, CLAVE_DE_PRUEBA)).status).toBe(200);
    });

    test('un usuario que no existe se bloquea igual: la respuesta no revela qué usuarios existen', async () => {
      const { usuario } = ctx.usuario('mecanico');

      const existente = [...await fallar(usuario, 5), await login(usuario, 'incorrecta')];
      const inexistente = [...await fallar('fantasma', 5), await login('fantasma', 'incorrecta')];

      const resumen = (respuestas) => respuestas.map((r) => [r.status, r.body.error, r.body.mensaje]);
      expect(resumen(inexistente)).toEqual(resumen(existente));
    });

    test('iniciar sesión bien antes del quinto fallo reinicia la cuenta de intentos', async () => {
      const { usuario } = ctx.usuario('mecanico');

      await fallar(usuario, 4);
      expect((await login(usuario, CLAVE_DE_PRUEBA)).status).toBe(200);
      const despues = await fallar(usuario, 4);

      expect(despues.map((r) => r.status)).toEqual([401, 401, 401, 401]);
      expect((await login(usuario, CLAVE_DE_PRUEBA)).status).toBe(200);
    });

    test('el bloqueo de un usuario no afecta a los demás', async () => {
      const mecanico = ctx.usuario('mecanico');
      const dueno = ctx.usuario('dueno');
      await fallar(mecanico.usuario, 5);

      expect((await login(mecanico.usuario, CLAVE_DE_PRUEBA)).status).toBe(429);
      expect((await login(dueno.usuario, CLAVE_DE_PRUEBA)).status).toBe(200);
    });

    test('el bloqueo se guarda en la base: sigue vigente aunque el servidor se reinicie', async () => {
      const { usuario } = ctx.usuario('mecanico');
      await fallar(usuario, 5);
      const fila = ctx.db.prepare('SELECT intentos_fallidos, bloqueado_hasta FROM usuarios WHERE usuario = ?').get(usuario);
      expect(fila).toEqual({ intentos_fallidos: 5, bloqueado_hasta: '2026-10-12T08:15:00.000Z' });

      const reiniciada = crearApp({ db: ctx.db, ahora: () => reloj });

      expect(() => reiniciada.servicios.auth.iniciarSesion(usuario, CLAVE_DE_PRUEBA)).toThrow(/Demasiados intentos/);
    });

    test('una misma dirección que falla con muchos usuarios distintos queda bloqueada (rociado de contraseñas)', async () => {
      const { usuario } = ctx.usuario('dueno');
      const { auth } = ctx.servicios;
      for (let i = 0; i < 30; i += 1) {
        expect(() => auth.iniciarSesion(`usuario${i}`, 'incorrecta', { ip: '203.0.113.9' })).toThrow('Usuario o contraseña incorrectos');
      }

      expect(() => auth.iniciarSesion(usuario, CLAVE_DE_PRUEBA, { ip: '203.0.113.9' })).toThrow(/Demasiados intentos/);
      expect(auth.iniciarSesion(usuario, CLAVE_DE_PRUEBA, { ip: '198.51.100.4' }).token).toEqual(expect.any(String));
    });

    test('una contraseña desmedida (más de 128 caracteres) se rechaza sin calcular su hash', async () => {
      const { usuario } = ctx.usuario('dueno');

      expect((await login(usuario, 'x'.repeat(5000))).status).toBe(401);
    });

    test('la auditoría registra los fallos, el bloqueo y el ingreso, sin guardar el texto escrito como usuario', async () => {
      const mecanico = ctx.usuario('mecanico');
      await fallar(mecanico.usuario, 5);
      await login('mi-clave-secreta-123', 'x');
      reloj = new Date('2026-10-12T09:00:00Z');
      await login(mecanico.usuario, CLAVE_DE_PRUEBA);

      const filas = ctx.db.prepare('SELECT usuario_id, accion, detalle FROM auditoria WHERE accion <> ? ORDER BY id').all('LOGIN_OK');
      expect(filas.map((f) => f.accion)).toEqual([
        'LOGIN_FALLIDO', 'LOGIN_FALLIDO', 'LOGIN_FALLIDO', 'LOGIN_FALLIDO', 'CUENTA_BLOQUEADA', 'LOGIN_FALLIDO',
      ]);
      expect(filas[4]).toMatchObject({ usuario_id: mecanico.id, detalle: 'Intento 5 de 5' });
      expect(filas[5]).toEqual({ usuario_id: null, accion: 'LOGIN_FALLIDO', detalle: 'Usuario inexistente' });
      expect(JSON.stringify(ctx.db.prepare('SELECT * FROM auditoria').all())).not.toContain('mi-clave-secreta-123');
      const ingresos = ctx.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'LOGIN_OK' AND usuario_id = ?").get(mecanico.id);
      expect(ingresos.n).toBeGreaterThanOrEqual(1);
    });
  });

  describe('cambio de contraseña', () => {
    let ctx;
    let mecanico;
    const cambiar = (cuerpo) => mecanico.post('/api/auth/password').send(cuerpo);
    const login = (password) => ctx.anonimo().post('/api/auth/login').send({ usuario: ctx.usuario('mecanico').usuario, password });

    beforeEach(() => {
      ctx = crearContexto();
      mecanico = ctx.como('mecanico');
    });

    test('con la contraseña actual correcta se cambia: la anterior deja de servir y la nueva funciona', async () => {
      const res = await cambiar({ actual: CLAVE_DE_PRUEBA, nueva: CLAVE_NUEVA });

      expect(res.status).toBe(200);
      expect(res.body.usuario).toMatchObject({ rol: 'mecanico', debeCambiarPassword: false });
      expect(res.body.usuario).not.toHaveProperty('passwordHash');
      expect((await login(CLAVE_DE_PRUEBA)).status).toBe(401);
      expect((await login(CLAVE_NUEVA)).status).toBe(200);
    });

    test('cierra las sesiones abiertas en otros dispositivos y conserva la actual', async () => {
      const otraSesion = (await login(CLAVE_DE_PRUEBA)).body.token;

      await cambiar({ actual: CLAVE_DE_PRUEBA, nueva: CLAVE_NUEVA });

      expect((await ctx.anonimo().get('/api/auth/yo').set('Authorization', `Bearer ${otraSesion}`)).status).toBe(401);
      expect((await mecanico.get('/api/auth/yo')).status).toBe(200);
    });

    test.each([
      ['la contraseña actual es incorrecta', { actual: 'no-es-esta', nueva: CLAVE_NUEVA }, 'actual', 'La contraseña actual no es correcta'],
      ['falta la contraseña actual', { nueva: CLAVE_NUEVA }, 'actual', 'Escribe tu contraseña actual'],
      ['la nueva es muy corta', { actual: CLAVE_DE_PRUEBA, nueva: 'corta' }, 'nueva', 'La contraseña debe tener al menos 8 caracteres'],
      ['la nueva es igual a la actual', { actual: CLAVE_DE_PRUEBA, nueva: CLAVE_DE_PRUEBA }, 'nueva', 'La contraseña nueva debe ser distinta de la actual'],
      ['la nueva es el nombre de usuario', { actual: CLAVE_DE_PRUEBA, nueva: 'mecanico.prueba' }, 'nueva', 'La contraseña no puede ser igual al nombre de usuario'],
    ])('rechaza con 400 si %s', async (_, cuerpo, campo, mensaje) => {
      const res = await cambiar(cuerpo);

      expect(res.status).toBe(400);
      expect(res.body.detalles).toContainEqual({ campo, mensaje });
      expect((await login(CLAVE_DE_PRUEBA)).status).toBe(200);
    });

    test('exige sesión (401) y tolera un cuerpo vacío (400)', async () => {
      expect((await ctx.anonimo().post('/api/auth/password').send({ actual: 'a', nueva: CLAVE_NUEVA })).status).toBe(401);
      expect((await mecanico.post('/api/auth/password')).status).toBe(400);
    });

    test('adivinar la contraseña actual con la sesión abierta también tiene límite de intentos', async () => {
      for (let i = 0; i < 5; i += 1) await cambiar({ actual: `intento-${i}`, nueva: CLAVE_NUEVA });

      const res = await cambiar({ actual: CLAVE_DE_PRUEBA, nueva: CLAVE_NUEVA });

      expect(res.status).toBe(429);
      expect((await login(CLAVE_DE_PRUEBA)).status).toBe(200);
    });

    test('queda en la auditoría', async () => {
      await cambiar({ actual: CLAVE_DE_PRUEBA, nueva: CLAVE_NUEVA });

      const fila = ctx.db.prepare("SELECT usuario_id, detalle FROM auditoria WHERE accion = 'PASSWORD_CAMBIADA'").get();
      expect(fila.usuario_id).toBe(ctx.usuario('mecanico').id);
      expect(fila.detalle).not.toContain(CLAVE_NUEVA);
    });
  });

  describe('contraseña temporal (debe cambiarse antes de usar el sistema)', () => {
    const TEMPORAL = 'temporal-de-un-solo-uso';
    let ctx;
    let token;
    const conToken = (peticion) => peticion.set('Authorization', `Bearer ${token}`);

    beforeEach(async () => {
      ctx = crearContexto();
      ctx.servicios.auth.crearUsuario({ usuario: 'nuevo', nombre: 'Mecánico Nuevo', rol: 'mecanico', password: TEMPORAL, debeCambiarPassword: true });
      const res = await ctx.anonimo().post('/api/auth/login').send({ usuario: 'nuevo', password: TEMPORAL });
      token = res.body.token;
      expect(res.body.usuario.debeCambiarPassword).toBe(true);
    });

    test('la API responde 403 CAMBIO_DE_PASSWORD_REQUERIDO en todo menos en su propia sesión', async () => {
      const ordenes = await conToken(ctx.anonimo().get('/api/ordenes'));
      const crear = await conToken(ctx.anonimo().post('/api/ordenes')).send(ordenValida());
      const yo = await conToken(ctx.anonimo().get('/api/auth/yo'));

      expect(ordenes.status).toBe(403);
      expect(ordenes.body.error).toBe('CAMBIO_DE_PASSWORD_REQUERIDO');
      expect(crear.status).toBe(403);
      expect(yo.status).toBe(200);
      expect(yo.body.usuario.debeCambiarPassword).toBe(true);
    });

    test('al cambiarla, el bloqueo se levanta', async () => {
      const cambio = await conToken(ctx.anonimo().post('/api/auth/password')).send({ actual: TEMPORAL, nueva: CLAVE_NUEVA });

      expect(cambio.status).toBe(200);
      expect(cambio.body.usuario.debeCambiarPassword).toBe(false);
      expect((await conToken(ctx.anonimo().get('/api/ordenes'))).status).toBe(200);
    });
  });

  describe('creación de usuarios', () => {
    const base = { usuario: 'laura', nombre: 'Laura Mejía', rol: 'recepcionista', password: CLAVE_DE_PRUEBA };

    test('guarda el correo en minúsculas y lo deja vacío si no se envía', () => {
      const { auth } = crearContexto().servicios;

      expect(auth.crearUsuario({ ...base, email: '  Laura@Taller.CO ' }).email).toBe('laura@taller.co');
      expect(auth.crearUsuario({ ...base, usuario: 'laura2', email: '' }).email).toBeNull();
      expect(auth.crearUsuario({ ...base, usuario: 'laura3' })).toMatchObject({ email: null, debeCambiarPassword: false });
    });

    test.each([
      ['un correo mal escrito', { email: 'laura@' }, 'El correo no es válido'],
      ['un correo que no es texto', { email: 42 }, 'El correo no es válido'],
      ['una contraseña igual al usuario', { password: 'LauraMejia', usuario: 'lauramejia' }, 'La contraseña no puede ser igual al nombre de usuario'],
    ])('rechaza %s', (_, cambios, mensaje) => {
      const { auth } = crearContexto().servicios;

      expect.assertions(1);
      try {
        auth.crearUsuario({ ...base, ...cambios });
      } catch (error) {
        expect(error.detalles.map((d) => d.mensaje)).toEqual([mensaje]);
      }
    });

    test('desbloquear quita el bloqueo por intentos fallidos sin esperar los 15 minutos', async () => {
      const ctx = crearContexto();
      const usuario = ctx.usuario('mecanico');
      const login = (password) => ctx.anonimo().post('/api/auth/login').send({ usuario: usuario.usuario, password });
      for (let i = 0; i < 5; i += 1) await login('incorrecta');
      expect((await login(CLAVE_DE_PRUEBA)).status).toBe(429);

      ctx.servicios.auth.desbloquear(usuario);

      expect((await login(CLAVE_DE_PRUEBA)).status).toBe(200);
    });
  });

  describe('cierre de sesiones', () => {
    test('POST /api/auth/logout-todas invalida todas las sesiones del usuario, no las de otros', async () => {
      const ctx = crearContexto();
      const dueno = ctx.como('dueno');
      const mecanico = ctx.como('mecanico');
      const otra = (await ctx.anonimo().post('/api/auth/login').send({ usuario: ctx.usuario('dueno').usuario, password: CLAVE_DE_PRUEBA })).body.token;

      const res = await dueno.post('/api/auth/logout-todas');

      expect(res.status).toBe(204);
      expect((await dueno.get('/api/auth/yo')).status).toBe(401);
      expect((await ctx.anonimo().get('/api/auth/yo').set('Authorization', `Bearer ${otra}`)).status).toBe(401);
      expect((await mecanico.get('/api/auth/yo')).status).toBe(200);
      expect(ctx.db.prepare("SELECT detalle FROM auditoria WHERE accion = 'SESIONES_CERRADAS'").get().detalle).toBe('2 sesión(es)');
    });
  });

  describe('auditoría de acciones sensibles', () => {
    test('quedan registrados el cambio de estado, el ajuste de stock, la baja y la carga por CSV, con su autor', async () => {
      const ctx = crearContexto();
      const dueno = ctx.como('dueno');
      const mecanico = ctx.como('mecanico');
      const { body: filtro } = await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 10 }));
      const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());

      await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'CANCELADA', motivo: 'El cliente desistió' });
      await dueno.put(`/api/repuestos/${filtro.id}`).send(repuestoValido({ stockActual: 25 }));
      await dueno.put(`/api/repuestos/${filtro.id}`).send(repuestoValido({ stockActual: 25, costo: 30000 }));
      await dueno.delete(`/api/repuestos/${filtro.id}`);
      await dueno.post('/api/repuestos/importar').set('Content-Type', 'text/csv').send('sku,nombre,costo,stockActual\nA-1,Tornillo,500,100\n');

      const filas = ctx.db
        .prepare("SELECT usuario_id, accion, entidad, entidad_id, detalle FROM auditoria WHERE accion NOT LIKE 'LOGIN%' ORDER BY id")
        .all();
      const idDueno = ctx.usuario('dueno').id;
      expect(filas).toEqual([
        { usuario_id: ctx.usuario('mecanico').id, accion: 'ORDEN_ESTADO', entidad: 'orden', entidad_id: orden.id, detalle: 'En proceso → Cancelada: El cliente desistió' },
        { usuario_id: idDueno, accion: 'REPUESTO_AJUSTE', entidad: 'repuesto', entidad_id: filtro.id, detalle: 'FIL-ACE-001: de 10 a 25 unidades' },
        { usuario_id: idDueno, accion: 'REPUESTO_BAJA', entidad: 'repuesto', entidad_id: filtro.id, detalle: 'FIL-ACE-001 (Filtro de aceite Mann W712), con 25 unidades' },
        { usuario_id: idDueno, accion: 'REPUESTO_IMPORTACION', entidad: 'repuesto', entidad_id: null, detalle: '1 repuesto(s) cargados por CSV' },
      ]);
    });

    test('si la operación falla, no queda rastro falso en la auditoría', async () => {
      const ctx = crearContexto();
      const mecanico = ctx.como('mecanico');
      const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());

      await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'CANCELADA' });

      expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'ORDEN_ESTADO'").get().n).toBe(0);
    });
  });
});
