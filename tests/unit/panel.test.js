const { aFechaSql, lunesDe, ultimasSemanas, ultimosMeses, haceDias } = require('../../src/modules/panel/periodos');
const { validarEntrada } = require('../../src/modules/inventario/entrada.validator');

describe('periodos del panel (unitarias)', () => {
  test('aFechaSql usa el formato de fecha de la base de datos, en UTC', () => {
    expect(aFechaSql(new Date('2026-10-12T08:30:05.123Z'))).toBe('2026-10-12 08:30:05');
  });

  test.each([
    ['un lunes', '2026-10-12T00:00:00Z', '2026-10-12'],
    ['un miércoles', '2026-10-14T15:00:00Z', '2026-10-12'],
    ['un domingo a última hora', '2026-10-18T23:59:59Z', '2026-10-12'],
    ['el 1 de enero (jueves): la semana empezó el año anterior', '2026-01-01T12:00:00Z', '2025-12-29'],
  ])('lunesDe %s', (_, fecha, lunes) => {
    expect(lunesDe(new Date(fecha)).toISOString().slice(0, 10)).toBe(lunes);
  });

  test('ultimasSemanas devuelve los lunes en orden, con la semana actual al final', () => {
    expect(ultimasSemanas(new Date('2026-10-14T15:00:00Z'), 4)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
  });

  test('ultimosMeses cruza el cambio de año', () => {
    expect(ultimosMeses(new Date('2026-02-10T00:00:00Z'), 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  test('ultimosMeses no se salta meses al final de un mes de 31 días', () => {
    expect(ultimosMeses(new Date('2026-03-31T23:00:00Z'), 3)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  test('haceDias resta días completos', () => {
    expect(haceDias(new Date('2026-10-12T08:00:00Z'), 30).toISOString()).toBe('2026-09-12T08:00:00.000Z');
  });
});

describe('validarEntrada de mercancía (unitarias)', () => {
  test('acepta la cantidad como número o como texto y recorta el detalle', () => {
    expect(validarEntrada({ cantidad: '12', detalle: '  Factura 4471 ' }).valor).toEqual({ cantidad: 12, detalle: 'Factura 4471' });
    expect(validarEntrada({ cantidad: 3 }).valor).toEqual({ cantidad: 3, detalle: null });
    expect(validarEntrada({ cantidad: 3, detalle: '   ' }).valor.detalle).toBeNull();
  });

  test.each([
    ['cero', { cantidad: 0 }, 'cantidad', 'La cantidad debe ser un número entero mayor que cero'],
    ['negativa', { cantidad: -5 }, 'cantidad', 'La cantidad debe ser un número entero mayor que cero'],
    ['con decimales', { cantidad: 2.5 }, 'cantidad', 'La cantidad debe ser un número entero mayor que cero'],
    ['vacía', { cantidad: '' }, 'cantidad', 'La cantidad debe ser un número entero mayor que cero'],
    ['booleana', { cantidad: true }, 'cantidad', 'La cantidad debe ser un número entero mayor que cero'],
    ['desmedida', { cantidad: 100001 }, 'cantidad', 'La cantidad máxima por entrada es 100000'],
    ['con detalle que no es texto', { cantidad: 1, detalle: 5 }, 'detalle', 'El detalle debe ser texto'],
    ['con detalle de 201 caracteres', { cantidad: 1, detalle: 'a'.repeat(201) }, 'detalle', 'El detalle admite máximo 200 caracteres'],
  ])('rechaza una entrada %s', (_, entrada, campo, mensaje) => {
    expect(validarEntrada(entrada).errores).toEqual([{ campo, mensaje }]);
  });

  test.each([[null], [undefined], ['10'], [[10]]])('con %p como entrada pide la cantidad', (entrada) => {
    expect(validarEntrada(entrada).errores.map((e) => e.campo)).toEqual(['cantidad']);
  });
});
