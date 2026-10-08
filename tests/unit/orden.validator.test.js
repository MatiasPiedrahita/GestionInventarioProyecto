const { validarNuevaOrden, normalizarPlaca } = require('../../src/modules/ordenes/orden.validator');
const { ordenValida } = require('../helpers/datos');

describe('validarNuevaOrden (unitarias)', () => {
  test('acepta una orden completa y normaliza la placa y los textos', () => {
    const { valido, valor } = validarNuevaOrden(ordenValida({ descripcion: '  Cambio de aceite  ' }), { anioActual: 2026 });

    expect(valido).toBe(true);
    expect(valor.vehiculo.placa).toBe('ABC123');
    expect(valor.descripcion).toBe('Cambio de aceite');
    expect(valor.mecanicoId).toBeNull();
  });

  test('normaliza placas de carro y de moto', () => {
    expect(normalizarPlaca(' abc 123 ')).toBe('ABC123');
    expect(normalizarPlaca('xyz-12d')).toBe('XYZ12D');
  });

  test('reporta todos los campos obligatorios vacíos de cliente, vehículo y descripción', () => {
    const { valido, errores } = validarNuevaOrden({});

    expect(valido).toBe(false);
    expect(errores.map((e) => e.campo)).toEqual([
      'cliente.documento', 'cliente.nombre', 'cliente.telefono',
      'vehiculo.placa', 'vehiculo.marca', 'vehiculo.modelo', 'descripcion',
    ]);
  });

  test.each([
    [{ vehiculo: { placa: 'AB123', marca: 'Kia', modelo: 'Picanto' } }, 'vehiculo.placa'],
    [{ vehiculo: { placa: 'ABC123', marca: 'Kia', modelo: 'Picanto', anio: 1900 } }, 'vehiculo.anio'],
    [{ cliente: { documento: '1037654321', nombre: 'Ana', telefono: '3001234567', email: 'no-es-correo' } }, 'cliente.email'],
    [{ cliente: { documento: '12', nombre: 'Ana', telefono: '3001234567' } }, 'cliente.documento'],
    [{ mecanicoId: 'abc' }, 'mecanicoId'],
  ])('rechaza datos con formato inválido (%#)', (cambio, campo) => {
    const { valido, errores } = validarNuevaOrden(ordenValida(cambio), { anioActual: 2026 });

    expect(valido).toBe(false);
    expect(errores.map((e) => e.campo)).toContain(campo);
  });
});
