/**
 * PRUEBA DE ACEPTACIÓN — HU-02 Iniciar sesión (usuario) · Sprint 1
 *
 * Criterio: autenticación con usuario y contraseña, redirigiendo a la vista
 * correspondiente según el rol (dueño, mecánico, recepcionista, administrador).
 *
 * Prueba de funcionalidad del sprint: "iniciar sesión con un usuario de rol
 * mecánico y verificar que no pueda acceder a las vistas exclusivas del dueño".
 */
const { crearContexto, CLAVE_DE_PRUEBA } = require('../helpers/contexto');

const repuesto = { sku: 'FIL-ACE-001', nombre: 'Filtro de aceite', costo: 28500, stockActual: 10, stockMinimo: 3 };

describe('HU-02 · Criterio de aceptación: login con redirección por rol y acceso restringido', () => {
  test('Escenario 1 — Dado un mecánico registrado, Cuando inicia sesión con su usuario y contraseña, Entonces entra y es dirigido a la vista de órdenes, no a la de inventario', async () => {
    // Dado
    const ctx = crearContexto();
    const mecanico = ctx.usuario('mecanico');

    // Cuando
    const res = await ctx.anonimo().post('/api/auth/login').send({ usuario: mecanico.usuario, password: CLAVE_DE_PRUEBA });

    // Entonces
    expect(res.status).toBe(200);
    expect(res.body.vistaInicial).toBe('ordenes');
  });

  test('Escenario 2 — Dado un mecánico con sesión iniciada, Cuando intenta usar las funciones exclusivas del dueño (crear, editar, dar de baja, importar, ver historial), Entonces recibe 403 en todas y el inventario no cambia', async () => {
    // Dado
    const ctx = crearContexto();
    const { body: existente } = await ctx.como('dueno').post('/api/repuestos').send(repuesto);
    const mecanico = ctx.como('mecanico');

    // Cuando
    const intentos = await Promise.all([
      mecanico.post('/api/repuestos').send({ ...repuesto, sku: 'NUEVO-1' }),
      mecanico.put(`/api/repuestos/${existente.id}`).send({ ...repuesto, stockActual: 99 }),
      mecanico.delete(`/api/repuestos/${existente.id}`),
      mecanico.post('/api/repuestos/importar').set('Content-Type', 'text/csv').send('sku,nombre,costo,stockActual\nX-1,Tornillo,10,5\n'),
      mecanico.get(`/api/repuestos/${existente.id}/movimientos`),
    ]);

    // Entonces
    intentos.forEach((res) => {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('SIN_PERMISO');
    });
    const catalogo = await ctx.como('dueno').get('/api/repuestos');
    expect(catalogo.body).toHaveLength(1);
    expect(catalogo.body[0].stockActual).toBe(10);
  });

  test('Escenario 3 — Dado el mismo repuesto, Cuando el dueño hace esas operaciones, Entonces sí se le permiten (el bloqueo depende del rol, no es un error general)', async () => {
    // Dado
    const ctx = crearContexto();
    const dueno = ctx.como('dueno');
    const { body: creado } = await dueno.post('/api/repuestos').send(repuesto);

    // Cuando
    const edicion = await dueno.put(`/api/repuestos/${creado.id}`).send({ ...repuesto, stockActual: 12 });
    const historial = await dueno.get(`/api/repuestos/${creado.id}/movimientos`);

    // Entonces
    expect(creado.id).toEqual(expect.any(Number));
    expect(edicion.status).toBe(200);
    expect(historial.status).toBe(200);
  });
});
