const { validarContacto, validarBusquedaDeClientes } = require('../../src/modules/clientes/cliente.validator');

describe('validarContacto del cliente (unitarias)', () => {
  test('acepta y normaliza nombre, teléfono y correo', () => {
    expect(validarContacto({ nombre: ' Camila Ortiz ', telefono: ' 300 123 4567 ', email: 'Camila@Correo.com' })).toEqual({
      valido: true, errores: [], valor: { nombre: 'Camila Ortiz', telefono: '300 123 4567', email: 'camila@correo.com' },
    });
  });

  test('el correo es opcional', () => {
    expect(validarContacto({ nombre: 'Camila', telefono: '3001234567' }).valor.email).toBeNull();
  });

  test.each([
    ['sin nombre', { telefono: '3001234567' }, 'nombre', 'El nombre del cliente es obligatorio'],
    ['nombre de 121 caracteres', { nombre: 'a'.repeat(121), telefono: '3001234567' }, 'nombre', 'El nombre admite máximo 120 caracteres'],
    ['sin teléfono', { nombre: 'Camila' }, 'telefono', 'El teléfono del cliente es obligatorio'],
    ['teléfono con letras', { nombre: 'Camila', telefono: 'no tiene' }, 'telefono', 'El teléfono no es válido'],
    ['teléfono muy corto', { nombre: 'Camila', telefono: '12345' }, 'telefono', 'El teléfono no es válido'],
    ['correo inválido', { nombre: 'Camila', telefono: '3001234567', email: 'camila@' }, 'email', 'El correo no es válido'],
  ])('rechaza %s', (_, entrada, campo, mensaje) => {
    expect(validarContacto(entrada).errores).toEqual([{ campo, mensaje }]);
  });

  test.each([[null], [undefined], ['texto'], [[]]])('con %p como entrada pide nombre y teléfono', (entrada) => {
    expect(validarContacto(entrada).errores.map((e) => e.campo)).toEqual(['nombre', 'telefono']);
  });
});

describe('validarBusquedaDeClientes (unitarias)', () => {
  test('sin parámetros: sin filtros, página 1 y 15 por página', () => {
    expect(validarBusquedaDeClientes({}).valor).toEqual({ q: null, documento: null, pagina: 1, tamano: 15 });
    expect(validarBusquedaDeClientes().valido).toBe(true);
  });

  test('recorta los textos y convierte los números', () => {
    expect(validarBusquedaDeClientes({ q: '  camila ', documento: ' 1037 ', pagina: '3', tamano: '50' }).valor)
      .toEqual({ q: 'camila', documento: '1037', pagina: 3, tamano: 50 });
  });

  test.each([
    [{ q: 'a'.repeat(61) }, 'q'],
    [{ documento: '1'.repeat(21) }, 'documento'],
    [{ pagina: '0' }, 'pagina'],
    [{ tamano: '51' }, 'tamano'],
    [{ tamano: 'muchos' }, 'tamano'],
  ])('rechaza %p', (query, campo) => {
    expect(validarBusquedaDeClientes(query).errores.map((e) => e.campo)).toEqual([campo]);
  });

  test('ignora parámetros repetidos que llegan como lista', () => {
    expect(validarBusquedaDeClientes({ q: ['a', 'b'] }).valor.q).toBeNull();
  });
});
