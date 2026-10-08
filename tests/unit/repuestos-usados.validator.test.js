const { validarRepuestosUsados } = require('../../src/modules/ordenes/repuestos-usados.validator');

describe('validarRepuestosUsados (unitarias)', () => {
  test('acepta la lista, convierte a números y suma el mismo repuesto repetido', () => {
    const { valido, valor } = validarRepuestosUsados({
      items: [{ repuestoId: '3', cantidad: '2' }, { repuestoId: 5, cantidad: 1 }, { repuestoId: 3, cantidad: 1 }],
    });

    expect(valido).toBe(true);
    expect(valor).toEqual([{ repuestoId: 3, cantidad: 3 }, { repuestoId: 5, cantidad: 1 }]);
  });

  test.each([
    [undefined],
    [{}],
    [{ items: [] }],
  ])('rechaza una entrada sin repuestos (%p)', (entrada) => {
    expect(validarRepuestosUsados(entrada).errores[0].campo).toBe('items');
  });

  test.each([
    [0, 'cantidad'],
    [-2, 'cantidad'],
    [1.5, 'cantidad'],
  ])('rechaza cantidad %p', (cantidad) => {
    const { valido, errores } = validarRepuestosUsados({ items: [{ repuestoId: 1, cantidad }] });
    expect(valido).toBe(false);
    expect(errores[0].campo).toBe('items[0].cantidad');
  });

  test('rechaza un repuesto sin id válido', () => {
    const { errores } = validarRepuestosUsados({ items: [{ repuestoId: 'abc', cantidad: 1 }] });
    expect(errores[0].campo).toBe('items[0].repuestoId');
  });
});
