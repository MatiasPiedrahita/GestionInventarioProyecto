const { validarFiltros } = require('../../src/modules/ordenes/filtros.validator');

describe('validarFiltros del listado de órdenes (unitarias)', () => {
  test('sin parámetros: sin filtros, página 1 y 10 por página', () => {
    expect(validarFiltros({}).valor).toEqual({
      placa: null, cliente: null, mecanicoId: null, estado: null, pagina: 1, tamano: 10,
    });
  });

  test('normaliza la placa y el estado, y convierte números', () => {
    const { valor } = validarFiltros({ placa: ' abc-123 ', estado: 'historicas', mecanicoId: '4', pagina: '2', tamano: '25' });
    expect(valor).toMatchObject({ placa: 'ABC123', estado: 'HISTORICAS', mecanicoId: 4, pagina: 2, tamano: 25 });
  });

  test.each([
    [{ estado: 'PERDIDA' }, 'estado'],
    [{ pagina: '0' }, 'pagina'],
    [{ tamano: '500' }, 'tamano'],
    [{ mecanicoId: 'abc' }, 'mecanicoId'],
  ])('rechaza %p', (query, campo) => {
    const { valido, errores } = validarFiltros(query);
    expect(valido).toBe(false);
    expect(errores[0].campo).toBe(campo);
  });
});
