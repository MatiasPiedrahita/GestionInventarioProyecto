const { crearContexto } = require('../helpers/contexto');
const { abrirNavegador } = require('../helpers/navegador');
const { ordenValida } = require('../helpers/datos');

describe('Interfaz · recepción (clientes, vehículos, recibir un vehículo) y resumen del mecánico', () => {
  let ctx;
  let nav;
  let mecanico;

  beforeEach(async () => {
    ctx = crearContexto();
    mecanico = ctx.como('mecanico');
    await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.post('/api/ordenes').send(ordenValida({
      cliente: { documento: '71555444', nombre: 'Juan Pérez', telefono: '3012223344' },
      vehiculo: { placa: 'DEF456', marca: 'Renault', modelo: 'Logan', anio: 2020 },
    }));
    nav = await abrirNavegador(ctx.app);
  });

  afterEach(async () => {
    await nav.cerrar();
    expect(nav.errores).toEqual([]);
  });

  const nombres = () => nav.textos('#cuerpo-clientes tr td:first-child').map((t) => t.replace(/CC .*/, ''));

  async function abrirClientes(rol = 'recepcionista') {
    await nav.iniciarSesion(ctx.usuario(rol));
    nav.clic('#menu a[data-vista="clientes"]');
    await nav.esperar(() => nav.$$('#cuerpo-clientes button[data-cliente]').length === 2, 'el directorio de clientes');
  }

  test('la recepcionista ve el directorio y lo filtra por placa', async () => {
    await abrirClientes();
    expect(nombres()).toEqual(['Camila Ortiz', 'Juan Pérez']);
    expect(nav.$('#resumen-clientes').textContent).toBe('2 clientes');
    expect(nav.visible('#paginacion-clientes')).toBe(false);

    nav.escribir('#busqueda-clientes', 'def-456');
    await nav.esperar(() => nombres().length === 1, 'el filtro por placa', 3000);
    expect(nombres()).toEqual(['Juan Pérez']);

    nav.escribir('#busqueda-clientes', 'nadie con este nombre');
    await nav.esperar(() => nav.$('#cuerpo-clientes .vacio'), 'el mensaje de búsqueda vacía', 3000);
    expect(nav.$('#cuerpo-clientes .vacio').textContent).toMatch(/Ningún cliente coincide/);
  });

  test('la ficha muestra contacto, vehículos e historial, y permite corregir el teléfono', async () => {
    await abrirClientes();

    nav.clic(nav.$$('#cuerpo-clientes button[data-cliente]')[0]);
    await nav.esperar(() => nav.visible('#dialogo-cliente'), 'la ficha del cliente');
    expect(nav.$('#titulo-cliente').textContent).toBe('Camila Ortiz');
    expect(nav.$('#documento-cliente').textContent).toBe('CC 1037654321');
    expect(nav.textos('#vehiculos-cliente .placa')).toEqual(['ABC123']);
    expect(nav.textos('#cuerpo-historial-cliente .estado')).toEqual(['En proceso']);

    nav.escribir('#cliente-telefono', 'no tengo');
    nav.enviar('#formulario-cliente');
    await nav.esperar(() => nav.$('#formulario-cliente [data-error="telefono"]').textContent !== '', 'el error del teléfono');
    expect(nav.$('#formulario-cliente [data-error="telefono"]').textContent).toBe('El teléfono no es válido');

    nav.escribir('#cliente-telefono', '3119998877');
    nav.enviar('#formulario-cliente');
    await nav.esperar(() => nav.$('#aviso-contacto').textContent === 'Datos de contacto guardados.', 'la confirmación');
    await nav.esperar(() => nav.textos('#cuerpo-clientes tr:first-child td')[1].startsWith('3119998877'), 'el teléfono nuevo en la tabla');
  });

  test('al recibir un vehículo conocido, el documento y la placa completan el formulario sin pisar lo ya escrito', async () => {
    await nav.iniciarSesion(ctx.usuario('recepcionista'));
    await nav.esperar(() => nav.$$('#orden-mecanico option').length === 2, 'la lista de mecánicos');

    nav.escribir('#orden-telefono', '3200000000');
    nav.escribir('#orden-documento', '1037654321');
    await nav.esperar(() => nav.$('#pista-cliente').textContent !== '', 'la pista del cliente');
    expect(nav.$('#pista-cliente').textContent).toBe('Cliente registrado: Camila Ortiz, con 1 orden anterior.');
    expect(nav.$('#orden-cliente').value).toBe('Camila Ortiz');
    expect(nav.$('#orden-email').value).toBe('camila@ejemplo.com');
    // El teléfono ya estaba escrito: se respeta.
    expect(nav.$('#orden-telefono').value).toBe('3200000000');

    nav.escribir('#orden-placa', 'abc123');
    await nav.esperar(() => nav.$('#pista-vehiculo').textContent !== '', 'la pista del vehículo');
    expect(nav.$('#pista-vehiculo').textContent).toBe('Vehículo registrado a nombre de Camila Ortiz: 1 orden anterior, 1 todavía en proceso.');
    expect([nav.$('#orden-marca').value, nav.$('#orden-modelo').value, nav.$('#orden-anio').value]).toEqual(['Chevrolet', 'Spark GT', '2018']);
  });

  test('la recepcionista crea la orden eligiendo el mecánico y la ve en el listado', async () => {
    await nav.iniciarSesion(ctx.usuario('recepcionista'));
    await nav.esperar(() => nav.$$('#orden-mecanico option').length === 2, 'la lista de mecánicos');
    const escribir = (campos) => Object.entries(campos).forEach(([selector, valor]) => nav.escribir(selector, valor));

    escribir({
      '#orden-documento': '43999888', '#orden-telefono': '3105556677', '#orden-cliente': 'Sara Gómez',
      '#orden-placa': 'GHI78D', '#orden-marca': 'Yamaha', '#orden-modelo': 'NMAX', '#orden-descripcion': 'Revisión de frenos',
    });
    nav.enviar('#formulario-orden');
    await nav.esperar(() => nav.$('[data-error="mecanicoId"]').textContent !== '', 'el error por no elegir mecánico');
    expect(nav.$('[data-error="mecanicoId"]').textContent).toBe('Selecciona el mecánico que atenderá la orden');

    nav.escribir('#orden-mecanico', String(ctx.usuario('mecanico').id));
    nav.enviar('#formulario-orden');
    await nav.esperar(() => /Orden #\d+ creada para GHI78D/.test(nav.$('#aviso-orden').textContent), 'la confirmación');

    await nav.esperar(() => nav.$$('#cuerpo-ordenes button[data-orden]').length === 3, 'la orden nueva en el listado');
    expect(nav.$('#pista-cliente').textContent).toBe('');
  });

  test('una placa o un documento que no existen no muestran pista ni error', async () => {
    await nav.iniciarSesion(ctx.usuario('recepcionista'));

    nav.escribir('#orden-documento', '99999999');
    nav.escribir('#orden-placa', 'ZZZ999');
    await nav.reposo();

    expect(nav.$('#pista-cliente').textContent).toBe('');
    expect(nav.$('#pista-vehiculo').textContent).toBe('');
    expect(nav.$('#aviso-orden').textContent).toBe('');
  });

  test('el mecánico no consulta el directorio: no tiene el menú, ni se le completan datos de otros clientes', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'));
    expect(nav.textos('#menu a')).toEqual(['Órdenes de trabajo']);
    const antes = nav.peticiones.length;

    nav.escribir('#orden-documento', '71555444');
    nav.escribir('#orden-placa', 'DEF456');
    await nav.reposo();

    expect(nav.peticiones.slice(antes).filter((p) => /clientes|vehiculos/.test(p))).toEqual([]);
    expect(nav.$('#orden-cliente').value).toBe('');
  });

  test('"Mi resumen" del mecánico muestra su carga y se actualiza al finalizar una orden', async () => {
    await nav.iniciarSesion(ctx.usuario('mecanico'));
    await nav.esperar(() => nav.$$('#mi-resumen .indicador').length === 3, 'el resumen del mecánico');
    const valores = () => nav.textos('#mi-resumen .indicador__valor');
    expect(nav.textos('#mi-resumen .indicador__titulo')).toEqual(['Mis órdenes en proceso', 'Finalizadas', 'Repuestos que usé']);
    expect(valores()).toEqual(['2', '0', '0']);
    expect(nav.textos('#mi-resumen .indicador__nota')[0]).toBe('La más antigua es de hoy');

    await nav.esperar(() => nav.$$('[data-tarjetas="EN_PROCESO"] .tarjeta').length === 2, 'el tablero');
    nav.clic(nav.$('[data-tarjetas="EN_PROCESO"] .tarjeta [data-destino="FINALIZADA"]'));
    await nav.esperar(() => nav.visible('#dialogo-estado'), 'el diálogo');
    nav.enviar('#formulario-estado');

    await nav.esperar(() => valores().join() === '1,1,0', 'el resumen actualizado');
  });
});
