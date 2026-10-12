const { crearContexto, CLAVE_DE_PRUEBA } = require('../helpers/contexto');
const { abrirNavegador } = require('../helpers/navegador');

const CLAVE_NUEVA = 'otra-clave-mas-larga';

describe('Interfaz · inicio de sesión, menú por rol y "Mi cuenta"', () => {
  let ctx;
  let nav;

  beforeEach(async () => {
    ctx = crearContexto();
    nav = await abrirNavegador(ctx.app);
  });

  afterEach(async () => {
    await nav.cerrar();
    expect(nav.errores).toEqual([]);
  });

  const vistaActual = () => nav.$$('.vista').filter((v) => !v.hidden).map((v) => v.dataset.vista);
  const login = (password) => ctx.anonimo().post('/api/auth/login').send({ usuario: ctx.usuario('mecanico').usuario, password });

  test.each([
    ['mecanico', ['Órdenes de trabajo'], 'ordenes'],
    ['recepcionista', ['Órdenes de trabajo', 'Clientes'], 'ordenes'],
    ['dueno', ['Panel', 'Órdenes de trabajo', 'Clientes', 'Inventario', 'Alertas', 'Predicción', 'Administración'], 'panel'],
    ['administrador', ['Panel', 'Órdenes de trabajo', 'Clientes', 'Inventario', 'Alertas', 'Predicción', 'Administración'], 'administracion'],
  ])('%s: ve su menú y entra a su vista inicial', async (rol, menu, vista) => {
    await nav.iniciarSesion(ctx.usuario(rol));

    expect(nav.textos('#menu a')).toEqual(menu);
    expect(vistaActual()).toEqual([vista]);
    expect(nav.$('#nombre-usuario').textContent).toBe(ctx.usuario(rol).nombre);
  });

  test('con una contraseña incorrecta muestra el error y no entra', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'), 'incorrecta');

    expect(nav.$('#aviso-login').textContent).toBe('Usuario o contraseña incorrectos');
    expect(nav.visible('#pantalla-app')).toBe(false);
  });

  test('un mecánico que escribe la dirección del inventario vuelve a sus órdenes', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'));

    nav.window.location.hash = '#inventario';
    await nav.esperar(() => nav.window.location.hash === '#ordenes', 'la redirección a órdenes');

    expect(vistaActual()).toEqual(['ordenes']);
  });

  test('cambiar la contraseña desde "Mi cuenta": valida la confirmación y luego la nueva es la que sirve', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'));
    nav.window.location.hash = '#cuenta';
    await nav.esperar(() => vistaActual()[0] === 'cuenta', 'la vista Mi cuenta');
    expect(nav.$('#resumen-cuenta').textContent).toBe('Mecánico de Prueba · usuario mecanico.prueba · Mecánico');
    expect(nav.visible('#aviso-password-temporal')).toBe(false);

    nav.escribir('#password-actual', CLAVE_DE_PRUEBA);
    nav.escribir('#password-nueva', CLAVE_NUEVA);
    nav.escribir('#password-confirmar', 'no-coincide');
    nav.enviar('#formulario-password');
    expect(nav.$('[data-error="confirmar"]').textContent).toBe('No coincide con la contraseña nueva');

    nav.escribir('#password-confirmar', CLAVE_NUEVA);
    nav.enviar('#formulario-password');
    await nav.esperar(() => nav.$('#aviso-password').textContent !== '', 'la respuesta del cambio');

    expect(nav.$('#aviso-password').textContent).toMatch(/Contraseña actualizada/);
    expect((await login(CLAVE_DE_PRUEBA)).status).toBe(401);
    expect((await login(CLAVE_NUEVA)).status).toBe(200);
  });

  test('el error de la API se muestra junto al campo (contraseña actual incorrecta)', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'));
    nav.window.location.hash = '#cuenta';
    await nav.esperar(() => vistaActual()[0] === 'cuenta', 'la vista Mi cuenta');

    nav.escribir('#password-actual', 'no-es-esta');
    nav.escribir('#password-nueva', CLAVE_NUEVA);
    nav.escribir('#password-confirmar', CLAVE_NUEVA);
    nav.enviar('#formulario-password');

    await nav.esperar(() => nav.$('[data-error="actual"]').textContent !== '', 'el error del campo');
    expect(nav.$('[data-error="actual"]').textContent).toBe('La contraseña actual no es correcta');
  });

  test('con contraseña temporal solo se ve "Mi cuenta" sin menú; al cambiarla se abre la aplicación', async () => {
    const TEMPORAL = 'temporal-de-un-solo-uso';
    const nuevo = ctx.servicios.auth.crearUsuario({
      usuario: 'nuevo', nombre: 'Mecánico Nuevo', rol: 'mecanico', password: TEMPORAL, debeCambiarPassword: true,
    });
    await nav.iniciarSesion(nuevo, TEMPORAL);

    expect(vistaActual()).toEqual(['cuenta']);
    expect(nav.textos('#menu a')).toEqual([]);
    expect(nav.visible('#aviso-password-temporal')).toBe(true);
    nav.window.location.hash = '#ordenes';
    await new Promise((resolver) => { setTimeout(resolver, 30); });
    expect(vistaActual()).toEqual(['cuenta']);

    nav.escribir('#password-actual', TEMPORAL);
    nav.escribir('#password-nueva', CLAVE_NUEVA);
    nav.escribir('#password-confirmar', CLAVE_NUEVA);
    nav.enviar('#formulario-password');

    await nav.esperar(() => vistaActual()[0] === 'ordenes', 'la entrada a la aplicación');
    expect(nav.textos('#menu a')).toEqual(['Órdenes de trabajo']);
  });

  test('"Cerrar sesión en todos los dispositivos" vuelve al login y el token deja de servir', async () => {
    await nav.iniciarSesion(ctx.usuario('dueno'));
    const token = nav.window.sessionStorage.getItem('taller.token');
    nav.window.location.hash = '#cuenta';
    await nav.esperar(() => vistaActual()[0] === 'cuenta', 'la vista Mi cuenta');

    nav.clic('#boton-cerrar-todas');
    await nav.esperar(() => nav.visible('#pantalla-login'), 'el regreso al login');

    expect(nav.window.sessionStorage.getItem('taller.token')).toBeNull();
    expect((await ctx.anonimo().get('/api/auth/yo').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  test('si la sesión se cierra desde otro lado, la siguiente acción devuelve al login con un aviso', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'));
    ctx.servicios.auth.cerrarTodasLasSesiones(ctx.usuario('mecanico'));

    nav.clic('.alternador [data-modo="lista"]');
    await nav.esperar(() => nav.visible('#pantalla-login'), 'el regreso al login');

    expect(nav.$('#aviso-login').textContent).toMatch(/sesión/i);
  });
});
