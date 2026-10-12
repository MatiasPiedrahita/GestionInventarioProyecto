const { validarParametros, redactarQuiebre, lunesDe } = require('../../src/modules/prediccion/prediccion.service');
const { crearMotorPython, ErrorDelModelo, explicar } = require('../../src/modules/prediccion/motor-python');
const { validarRepuesto } = require('../../src/modules/inventario/repuesto.validator');
const { parsearCsv } = require('../../src/modules/inventario/csv');
const { repuestoValido } = require('../helpers/datos');

describe('validarParametros de la predicción (unitarias)', () => {
  test('sin parámetros usa 8 semanas y 95 % de nivel de servicio', () => {
    expect(validarParametros({}).valor).toEqual({ horizonteSemanas: 8, nivelDeServicio: 0.95 });
    expect(validarParametros(undefined).valor).toEqual({ horizonteSemanas: 8, nivelDeServicio: 0.95 });
    expect(validarParametros({ horizonteSemanas: '', nivelDeServicio: null }).valido).toBe(true);
  });

  test('acepta los valores como número o como texto', () => {
    expect(validarParametros({ horizonteSemanas: '12', nivelDeServicio: '0.9' }).valor).toEqual({ horizonteSemanas: 12, nivelDeServicio: 0.9 });
  });

  test.each([
    [{ horizonteSemanas: 3 }, 'horizonteSemanas'],
    [{ horizonteSemanas: 27 }, 'horizonteSemanas'],
    [{ horizonteSemanas: 8.5 }, 'horizonteSemanas'],
    [{ horizonteSemanas: 'muchas' }, 'horizonteSemanas'],
    [{ nivelDeServicio: 0.5 }, 'nivelDeServicio'],
    [{ nivelDeServicio: 1 }, 'nivelDeServicio'],
    [{ nivelDeServicio: 'alto' }, 'nivelDeServicio'],
  ])('rechaza %p', (entrada, campo) => {
    expect(validarParametros(entrada).errores.map((e) => e.campo)).toEqual([campo]);
  });
});

describe('redactarQuiebre y lunesDe (unitarias)', () => {
  test.each([
    [{ diasDeCobertura: 3.4, cantidadSugerida: 34 }, 7, 'al ritmo previsto se agota en 3 días y un pedido tarda 7 días. Sugerido: pedir 34.'],
    [{ diasDeCobertura: 1.9, cantidadSugerida: 5 }, 1, 'al ritmo previsto se agota en 1 día y un pedido tarda 1 día. Sugerido: pedir 5.'],
    [{ diasDeCobertura: 0.4, cantidadSugerida: 12 }, 14, 'al ritmo previsto se agota hoy y un pedido tarda 14 días. Sugerido: pedir 12.'],
  ])('%p con reposición de %i días', (prediccion, dias, texto) => {
    expect(redactarQuiebre(prediccion, dias)).toBe(texto);
  });

  test.each([
    ['2026-10-12T00:00:00Z', '2026-10-12'],
    ['2026-10-18T23:59:59Z', '2026-10-12'],
    ['2026-01-01T12:00:00Z', '2025-12-29'],
  ])('lunesDe %s es %s', (fecha, lunes) => {
    expect(lunesDe(new Date(fecha)).toISOString().slice(0, 10)).toBe(lunes);
  });
});

describe('días de reposición del repuesto (unitarias)', () => {
  test('por defecto son 7 y se aceptan como número o texto', () => {
    expect(validarRepuesto(repuestoValido()).valor.diasReposicion).toBe(7);
    expect(validarRepuesto(repuestoValido({ diasReposicion: '21' })).valor.diasReposicion).toBe(21);
    expect(validarRepuesto(repuestoValido({ diasReposicion: '' })).valor.diasReposicion).toBe(7);
  });

  test.each([[0], [181], [-3], [2.5], ['pronto']])('rechaza %p', (diasReposicion) => {
    expect(validarRepuesto(repuestoValido({ diasReposicion })).errores.map((e) => e.campo)).toEqual(['diasReposicion']);
  });

  test('la carga por CSV reconoce la columna de días de reposición', () => {
    const { filas } = parsearCsv('sku;nombre;costo;stock;dias_reposicion\nA-1;Tornillo;500;10;15\n');

    expect(filas[0].datos.diasReposicion).toBe('15');
    expect(validarRepuesto(filas[0].datos).valor.diasReposicion).toBe(15);
  });
});

describe('motor de Python: errores explicados (unitarias)', () => {
  test('si el modelo rechaza los datos, se muestra su mensaje', () => {
    const error = explicar(2, JSON.stringify({ error: { codigo: 'ENTRADA_INVALIDA', mensaje: 'repuestos debe ser una lista' } }), '');

    expect(error).toBeInstanceOf(ErrorDelModelo);
    expect(error.message).toBe('El modelo rechazó los datos: repuestos debe ser una lista');
    expect(error.codigo).toBe('ENTRADA_INVALIDA');
  });

  test('si falta una librería, dice cuál y cómo instalarla', () => {
    const error = explicar(1, '', "Traceback...\nModuleNotFoundError: No module named 'statsmodels'\n");

    expect(error.message).toBe('Al Python que ejecuta el modelo le falta la librería statsmodels. Prepare el entorno con: npm run prediccion:instalar');
    expect(error.codigo).toBe('LIBRERIAS_FALTANTES');
  });

  test('si no encuentra el paquete del modelo, lo dice', () => {
    const error = explicar(1, '', "python: No module named taller_prediccion\n");

    expect(error.codigo).toBe('MODELO_NO_ENCONTRADO');
  });

  test('cualquier otro fallo informa el código de salida y guarda el detalle técnico aparte', () => {
    const error = explicar(1, 'no es json', 'ZeroDivisionError: division by zero');

    expect(error.message).toBe('El modelo terminó con un error (código 1).');
    expect(error.detalle).toContain('ZeroDivisionError');
  });

  test('si Python no existe, el error dice cómo preparar el entorno en lugar de un ENOENT', async () => {
    const motor = crearMotorPython({ interprete: { ejecutable: 'python-que-no-existe-12345', origen: 'prueba' } });

    await expect(motor.predecir({})).rejects.toMatchObject({
      codigo: 'PYTHON_NO_ENCONTRADO',
      message: expect.stringContaining('npm run prediccion:instalar'),
    });
    expect(await motor.comprobar()).toEqual({ disponible: false, motivo: expect.stringContaining('No se encontró Python') });
  });

  test('un programa que termina con error se informa sin tumbar la aplicación', async () => {
    // Node no entiende "-m": termina con código de error, como lo haría un Python mal instalado.
    const motor = crearMotorPython({ interprete: { ejecutable: process.execPath, origen: 'prueba' } });

    await expect(motor.predecir({})).rejects.toMatchObject({ message: expect.stringMatching(/^El modelo terminó con un error \(código \d+\)\.$/) });
    expect(motor.descripcion).toBe('Python: prueba');
  });
});
