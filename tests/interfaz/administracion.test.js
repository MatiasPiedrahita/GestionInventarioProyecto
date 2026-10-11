const { crearContexto, CLAVE_DE_PRUEBA } = require('../helpers/contexto');
const { abrirNavegador } = require('../helpers/navegador');
const { ordenValida } = require('../helpers/datos');

describe('Interfaz · panel de administración', () => {
  let ctx;
  let nav;

  beforeEach(async () => {
    ctx = crearContexto();
    ctx.usuario('dueno');
    ctx.usuario('mecanico');
    nav = await abrirNavegador(ctx.app);
  });

  afterEach(async () => {
    await nav.cerrar();
    expect(nav.errores).toEqual([]);
  });

  const fila = (usuario) => nav.$(`#cuerpo-usuarios tr[data-usuario="${usuario}"]`);
  const acciones = (usuario) => [...fila(usuario).querySelectorAll('button')].map((b) => b.textContent);
  const celdas = (usuario) => [...fila(usuario).querySelectorAll('td')].map((td) => td.firstChild.textContent);
  const login = (usuario, password) => ctx.anonimo().post('/api/auth/login').send({ usuario, password });

  async function entrar(rol = 'administrador') {
    await nav.iniciarSesion(ctx.usuario(rol));
    if (!nav.visible('#panel-usuarios')) nav.clic('#menu a[data-vista="administracion"]');
    await nav.esperar(() => nav.$$('#cuerpo-usuarios tr').length > 0, 'la tabla de usuarios');
  }

  test('el administrador entra directo a Administración y solo ve acciones sobre mecánicos y recepcionistas', async () => {
    await entrar('administrador');

    expect(nav.$('#resumen-administracion').textContent).toBe('3 usuarios, 3 activos.');
    // "Cerrar sesiones" solo aparece si la cuenta tiene sesiones abiertas.
    expect(acciones('mecanico.prueba')).toEqual(['Editar', 'Nueva contraseña', 'Cerrar sesiones', 'Desactivar']);
    expect(acciones('dueno.prueba')).toEqual([]);
    expect(acciones('administrador.prueba')).toEqual([]);
    expect(celdas('administrador.prueba')[2]).toBe('Administrador (tú)');
    expect(nav.textos('#usuario-rol option')).toEqual(['Mecánico', 'Recepcionista']);
  });

  test('el dueño puede asignar cualquier rol y gestionar al administrador', async () => {
    ctx.usuario('administrador');
    await entrar('dueno');

    expect(nav.textos('#usuario-rol option')).toEqual(['Dueño del taller', 'Mecánico', 'Recepcionista', 'Administrador']);
    expect(acciones('administrador.prueba')).toEqual(['Editar', 'Nueva contraseña', 'Cerrar sesiones', 'Desactivar']);
    expect(acciones('dueno.prueba')).toEqual([]);
  });

  test('crear un usuario muestra la contraseña temporal una sola vez, y esa contraseña sirve para entrar', async () => {
    await entrar();

    nav.escribir('#usuario-usuario', 'luis');
    nav.escribir('#usuario-nombre', 'Luis Carlos Moreno');
    nav.escribir('#usuario-rol', 'recepcionista');
    nav.escribir('#usuario-email', 'luis@taller.co');
    nav.enviar('#formulario-usuario');
    await nav.esperar(() => nav.visible('#credencial-temporal'), 'la contraseña temporal');

    const temporal = nav.$('#credencial-valor').textContent;
    expect(temporal).toMatch(/^[a-zA-Z0-9]{12}$/);
    expect(nav.$('#credencial-usuario').textContent).toBe('luis');
    await nav.esperar(() => fila('luis'), 'la fila del usuario nuevo');
    expect(celdas('luis').slice(0, 5)).toEqual(['luis', 'Luis Carlos Moreno', 'Recepcionista', 'Contraseña temporal', '0']);
    expect(acciones('luis')).toEqual(['Editar', 'Nueva contraseña', 'Desactivar']);
    expect((await login('luis', temporal)).body.usuario.debeCambiarPassword).toBe(true);

    nav.clic('#boton-ocultar-credencial');
    expect(nav.visible('#credencial-temporal')).toBe(false);
    expect(nav.$('#credencial-valor').textContent).toBe('');
  });

  test('los errores de validación se muestran junto a cada campo', async () => {
    await entrar();

    nav.escribir('#usuario-usuario', 'x');
    nav.escribir('#usuario-email', 'malo');
    nav.enviar('#formulario-usuario');

    await nav.esperar(() => nav.$('[data-error="usuario"]').textContent !== '', 'los errores del formulario');
    expect(nav.$('#formulario-usuario [data-error="nombre"]').textContent).toBe('El nombre es obligatorio');
    expect(nav.$('#formulario-usuario [data-error="email"]').textContent).toBe('El correo no es válido');
    expect(nav.visible('#credencial-temporal')).toBe(false);
  });

  test('editar carga los datos en el formulario, no deja cambiar el nombre de usuario y guarda los cambios', async () => {
    await entrar();

    nav.clic(fila('mecanico.prueba').querySelector('[data-accion="editar"]'));
    expect(nav.$('#titulo-formulario-usuario').textContent).toBe('Editar mecanico.prueba');
    expect(nav.$('#usuario-usuario').readOnly).toBe(true);
    expect(nav.$('#usuario-nombre').value).toBe('Mecánico de Prueba');

    nav.escribir('#usuario-nombre', 'Andrés Gómez');
    nav.enviar('#formulario-usuario');
    await nav.esperar(() => celdas('mecanico.prueba')[1] === 'Andrés Gómez', 'el nombre actualizado en la tabla');

    expect(nav.$('#titulo-formulario-usuario').textContent).toBe('Nuevo usuario');
    expect(nav.$('#usuario-usuario').readOnly).toBe(false);
  });

  test('desactivar pide confirmación: si se cancela no pasa nada; si se acepta la cuenta queda inactiva', async () => {
    await entrar();
    const { usuario } = ctx.usuario('mecanico');

    nav.window.confirm = () => false;
    nav.clic(fila(usuario).querySelector('[data-accion="desactivar"]'));
    await nav.reposo();
    expect(celdas(usuario)[3]).toBe('Activo');

    nav.window.confirm = () => true;
    nav.clic(fila(usuario).querySelector('[data-accion="desactivar"]'));
    await nav.esperar(() => celdas(usuario)[3] === 'Inactivo', 'el estado inactivo');

    expect(acciones(usuario)).toEqual(['Editar', 'Nueva contraseña', 'Activar']);
    expect(nav.$('#aviso-usuarios').textContent).toBe('mecanico.prueba quedó inactivo.');
    expect((await login(usuario, CLAVE_DE_PRUEBA)).status).toBe(401);
  });

  test('una cuenta bloqueada por intentos fallidos se ve como "Bloqueado" y se puede desbloquear', async () => {
    const { usuario } = ctx.usuario('mecanico');
    for (let i = 0; i < 5; i += 1) await login(usuario, 'incorrecta');
    await entrar();

    expect(celdas(usuario)[3]).toBe('Bloqueado');
    nav.clic(fila(usuario).querySelector('[data-accion="desbloquear"]'));
    await nav.esperar(() => celdas(usuario)[3] === 'Activo', 'el estado activo');

    expect((await login(usuario, CLAVE_DE_PRUEBA)).status).toBe(200);
  });

  test('"Nueva contraseña" muestra la temporal y cierra las sesiones del usuario', async () => {
    const mecanico = ctx.como('mecanico');
    const { usuario } = ctx.usuario('mecanico');
    await entrar();
    expect(acciones(usuario)).toContain('Cerrar sesiones');

    nav.clic(fila(usuario).querySelector('[data-accion="password"]'));
    await nav.esperar(() => nav.visible('#credencial-temporal'), 'la contraseña temporal');

    expect((await mecanico.get('/api/auth/yo')).status).toBe(401);
    expect((await login(usuario, nav.$('#credencial-valor').textContent)).status).toBe(200);
  });

  test('si la API rechaza la acción, el motivo se muestra sobre la tabla', async () => {
    await ctx.como('mecanico').post('/api/ordenes').send(ordenValida());
    await entrar();

    nav.clic(fila('mecanico.prueba').querySelector('[data-accion="desactivar"]'));
    await nav.esperar(() => nav.$('#aviso-usuarios').textContent !== '', 'el aviso de error');

    expect(nav.$('#aviso-usuarios').textContent).toMatch(/tiene 1 orden en proceso/);
    expect(celdas('mecanico.prueba')[3]).toBe('Activo');
  });

  test('la pestaña Auditoría lista los registros y filtra por acción', async () => {
    await login('mecanico.prueba', 'incorrecta');
    await entrar();

    nav.clic('#pestana-auditoria');
    await nav.esperar(() => nav.$$('#cuerpo-auditoria tr').length > 1, 'los registros de auditoría');
    expect(nav.visible('#panel-usuarios')).toBe(false);
    expect(nav.$('#pestana-auditoria').getAttribute('aria-selected')).toBe('true');

    nav.escribir('#auditoria-accion', 'LOGIN_FALLIDO');
    await nav.esperar(() => nav.$('#info-auditoria').textContent === '1 registro', 'el filtro aplicado');
    expect(nav.textos('#cuerpo-auditoria tr td:nth-child(3)')).toEqual(['Intento fallido de inicio de sesión']);
    expect(nav.$('#auditoria-pagina').textContent).toBe('Página 1 de 1');
  });

  test('la pestaña Sistema muestra versiones y conteos', async () => {
    await entrar();

    nav.clic('#pestana-sistema');
    await nav.esperar(() => nav.$$('#ficha-sistema dt').length > 0, 'el estado del sistema');

    const ficha = Object.fromEntries(nav.textos('#ficha-sistema dt').map((dt, i) => [dt, nav.textos('#ficha-sistema dd')[i]]));
    expect(ficha['Usuarios']).toBe('3 activos, 0 inactivos');
    expect(ficha['Versión de la base de datos']).toMatch(/^Migración \d+$/);
  });

  test('un mecánico no tiene la sección en el menú y la dirección directa lo devuelve a sus órdenes', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'));

    nav.window.location.hash = '#administracion';
    await nav.esperar(() => nav.window.location.hash === '#ordenes', 'la redirección');

    expect(nav.textos('#menu a')).toEqual(['Órdenes de trabajo']);
    expect(nav.visible('#panel-usuarios')).toBe(false);
  });
});
