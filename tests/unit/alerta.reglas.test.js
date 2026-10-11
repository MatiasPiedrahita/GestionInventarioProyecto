const { nivelDeStock, decidir, redactar, redactarCorreo, TIPOS } = require('../../src/modules/alertas/alerta.reglas');
const { crearProgramador } = require('../../src/tareas/programador');

const repuesto = (cambios = {}) => ({
  sku: 'FIL-ACE-001', nombre: 'Filtro de aceite', stockActual: 10, stockMinimo: 3, proveedor: 'Autopartes del Valle', activo: true, ...cambios,
});

describe('nivelDeStock (unitarias)', () => {
  test.each([
    [10, 3, null],
    [4, 3, null],
    [3, 3, 'STOCK_BAJO'],
    [1, 3, 'STOCK_BAJO'],
    [0, 3, 'AGOTADO'],
    [0, 0, 'AGOTADO'],
    [5, 0, null],
  ])('stock %i con mínimo %i → %p', (stockActual, stockMinimo, esperado) => {
    expect(nivelDeStock({ stockActual, stockMinimo })).toBe(esperado);
  });
});

describe('decidir qué hacer con la alerta de un repuesto (unitarias)', () => {
  test.each([
    ['stock sobre el mínimo y sin alerta', repuesto(), null, { accion: 'NADA', tipo: null }],
    ['llega al mínimo y no había alerta', repuesto({ stockActual: 3 }), null, { accion: 'CREAR', tipo: 'STOCK_BAJO' }],
    ['se agota y no había alerta', repuesto({ stockActual: 0 }), null, { accion: 'CREAR', tipo: 'AGOTADO' }],
    ['sigue bajo y ya tenía alerta', repuesto({ stockActual: 2 }), { tipo: 'STOCK_BAJO' }, { accion: 'NADA', tipo: 'STOCK_BAJO' }],
    ['tenía stock bajo y se agotó', repuesto({ stockActual: 0 }), { tipo: 'STOCK_BAJO' }, { accion: 'ESCALAR', tipo: 'AGOTADO' }],
    ['estaba agotado y entró algo, pero sigue bajo', repuesto({ stockActual: 2 }), { tipo: 'AGOTADO' }, { accion: 'REBAJAR', tipo: 'STOCK_BAJO' }],
    ['se recuperó', repuesto({ stockActual: 20 }), { tipo: 'AGOTADO' }, { accion: 'RESOLVER', tipo: null }],
    ['se dio de baja con stock bajo y alerta abierta', repuesto({ stockActual: 1, activo: false }), { tipo: 'STOCK_BAJO' }, { accion: 'RESOLVER', tipo: null }],
    ['se dio de baja sin alerta', repuesto({ stockActual: 0, activo: false }), null, { accion: 'NADA', tipo: null }],
  ])('%s', (_, datos, abierta, esperado) => {
    expect(decidir(datos, abierta)).toEqual(esperado);
  });
});

describe('redacción de los avisos (unitarias)', () => {
  test.each([
    ['STOCK_BAJO', repuesto({ stockActual: 2 }), null, 'Stock bajo: FIL-ACE-001', 'Filtro de aceite: quedan 2 unidades (mínimo 3).'],
    ['STOCK_BAJO', repuesto({ stockActual: 1 }), null, 'Stock bajo: FIL-ACE-001', 'Filtro de aceite: queda 1 unidad (mínimo 3).'],
    ['AGOTADO', repuesto({ stockActual: 0 }), null, 'Agotado: FIL-ACE-001', 'Filtro de aceite se agotó (mínimo 3).'],
    ['FALTANTE_REPORTADO', repuesto(), 'Andrés reportó que falta Filtro de aceite: llegaron dañados', 'Faltante reportado: FIL-ACE-001', 'Andrés reportó que falta Filtro de aceite: llegaron dañados'],
    ['QUIEBRE_PROYECTADO', repuesto(), 'se agotaría en 4 días', 'Se agotará pronto: FIL-ACE-001', 'Filtro de aceite: se agotaría en 4 días'],
  ])('%s', (tipo, datos, detalle, titulo, mensaje) => {
    expect(redactar({ tipo, detalle, repuesto: datos })).toEqual({ titulo, mensaje });
  });

  test('el correo de una sola alerta lleva su título en el asunto y el proveedor en el cuerpo', () => {
    const { asunto, cuerpo } = redactarCorreo([{ tipo: TIPOS.AGOTADO, repuesto: repuesto({ stockActual: 0 }) }], { nombre: 'Jorge' });

    expect(asunto).toBe('[Taller] Agotado: FIL-ACE-001');
    expect(cuerpo).toContain('Hola, Jorge:');
    expect(cuerpo).toContain('- Agotado · FIL-ACE-001 Filtro de aceite se agotó (mínimo 3). Proveedor: Autopartes del Valle.');
    expect(cuerpo).toContain('Revísalos en la sección "Alertas" de la aplicación.');
  });

  test('varias alertas van en un solo correo, con el enlace a la aplicación si está configurado', () => {
    const alertas = [
      { tipo: TIPOS.AGOTADO, repuesto: repuesto({ stockActual: 0 }) },
      { tipo: TIPOS.STOCK_BAJO, repuesto: repuesto({ sku: 'BUJ-1', nombre: 'Bujía', stockActual: 2, proveedor: null }) },
    ];

    const { asunto, cuerpo } = redactarCorreo(alertas, { nombre: 'Jorge', url: 'https://taller.ejemplo/#alertas' });

    expect(asunto).toBe('[Taller] 2 repuestos necesitan atención');
    expect(cuerpo.split('\n').filter((linea) => linea.startsWith('- '))).toHaveLength(2);
    expect(cuerpo).toContain('- Stock bajo · BUJ-1 Bujía: quedan 2 unidades (mínimo 3).');
    expect(cuerpo).toContain('https://taller.ejemplo/#alertas');
  });
});

describe('crearProgramador · tareas programadas (unitarias)', () => {
  let reloj;
  let intervalos;
  let programador;

  beforeEach(() => {
    reloj = new Date('2026-10-12T08:00:00Z');
    intervalos = [];
    const temporizador = {
      setInterval: (funcion, ms) => { intervalos.push({ funcion, ms, activo: true }); return intervalos.length - 1; },
      clearInterval: (id) => { intervalos[id].activo = false; },
    };
    programador = crearProgramador({ ahora: () => reloj, temporizador });
  });

  test('programa la tarea con su intervalo y no la ejecuta hasta que toque', () => {
    const tarea = jest.fn();
    programador.programar('revisión', 15, tarea);

    expect(intervalos[0].ms).toBe(15 * 60 * 1000);
    expect(tarea).not.toHaveBeenCalled();
    expect(programador.estado()).toEqual([
      { nombre: 'revisión', cadaMinutos: 15, ejecuciones: 0, ultimaEjecucion: null, ultimoResultado: null, ultimoError: null },
    ]);
  });

  test('cada disparo ejecuta la tarea y guarda cuándo corrió y qué devolvió', async () => {
    programador.programar('revisión', 15, () => ({ creadas: 2 }));

    await intervalos[0].funcion();

    expect(programador.estado()[0]).toMatchObject({ ejecuciones: 1, ultimaEjecucion: '2026-10-12T08:00:00.000Z', ultimoResultado: { creadas: 2 }, ultimoError: null });
  });

  test('alIniciar la ejecuta una vez de inmediato', async () => {
    const tarea = jest.fn();
    await programador.programar('revisión', 15, tarea, { alIniciar: true });

    expect(tarea).toHaveBeenCalledTimes(1);
  });

  test('si la tarea falla, guarda el error y sigue viva para la próxima vez', async () => {
    let falla = true;
    programador.programar('revisión', 15, () => { if (falla) throw new Error('base ocupada'); return 'ok'; });

    await intervalos[0].funcion();
    expect(programador.estado()[0]).toMatchObject({ ejecuciones: 1, ultimoError: 'base ocupada' });

    falla = false;
    await intervalos[0].funcion();
    expect(programador.estado()[0]).toMatchObject({ ejecuciones: 2, ultimoError: null, ultimoResultado: 'ok' });
  });

  test('no arranca una segunda ejecución si la anterior no ha terminado', async () => {
    let terminar;
    const tarea = jest.fn(() => new Promise((resolver) => { terminar = resolver; }));
    programador.programar('lenta', 1, tarea);

    const primera = intervalos[0].funcion();
    await intervalos[0].funcion();
    terminar();
    await primera;

    expect(tarea).toHaveBeenCalledTimes(1);
  });

  test('no admite dos tareas con el mismo nombre, y detener las cancela todas', () => {
    programador.programar('revisión', 15, () => {});

    expect(() => programador.programar('revisión', 5, () => {})).toThrow('Ya existe una tarea programada');
    programador.detener();
    expect(intervalos[0].activo).toBe(false);
    expect(programador.estado()).toEqual([]);
  });
});
