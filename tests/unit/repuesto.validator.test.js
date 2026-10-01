const { validarRepuesto } = require('../../src/modules/inventario/repuesto.validator');

const repuestoValido = () => ({
  sku: 'fil-ace-001',
  nombre: '  Filtro de aceite Mann W712 ',
  costo: '28500',
  stockActual: '14',
  stockMinimo: 5,
  proveedor: 'Autopartes del Valle',
  ubicacion: 'Estante A1',
});

describe('validarRepuesto (unitarias)', () => {
  test('acepta un repuesto completo y normaliza los datos (SKU en mayúsculas, textos recortados, números convertidos)', () => {
    const resultado = validarRepuesto(repuestoValido());

    expect(resultado.valido).toBe(true);
    expect(resultado.errores).toEqual([]);
    expect(resultado.valor).toEqual({
      sku: 'FIL-ACE-001',
      nombre: 'Filtro de aceite Mann W712',
      costo: 28500,
      stockActual: 14,
      stockMinimo: 5,
      proveedor: 'Autopartes del Valle',
      ubicacion: 'Estante A1',
    });
  });

  test('usa 0 como stock mínimo y null en proveedor/ubicación cuando no se envían', () => {
    const { valor } = validarRepuesto({ sku: 'A1', nombre: 'Tornillo', costo: 500, stockActual: 0 });

    expect(valor.stockMinimo).toBe(0);
    expect(valor.proveedor).toBeNull();
    expect(valor.ubicacion).toBeNull();
  });

  test.each([
    ['stockActual', -1, 'no puede ser negativo'],
    ['stockMinimo', -5, 'no puede ser negativo'],
    ['costo', -100, 'no puede ser negativo'],
    ['stockActual', 2.5, 'debe ser un número entero'],
    ['costo', 'barato', 'debe ser un número'],
  ])('rechaza %s = %p (%s)', (campo, valor, fragmento) => {
    const resultado = validarRepuesto({ ...repuestoValido(), [campo]: valor });

    expect(resultado.valido).toBe(false);
    const error = resultado.errores.find((e) => e.campo === campo);
    expect(error.mensaje).toContain(fragmento);
  });

  test('reporta TODOS los campos obligatorios vacíos a la vez, no solo el primero', () => {
    const resultado = validarRepuesto({ sku: '', nombre: '   ', costo: null });

    expect(resultado.valido).toBe(false);
    expect(resultado.errores.map((e) => e.campo)).toEqual(['sku', 'nombre', 'costo', 'stockActual']);
  });

  test('rechaza SKU con caracteres no permitidos y textos más largos del límite', () => {
    const resultado = validarRepuesto({ ...repuestoValido(), sku: 'FIL ACE#1', nombre: 'x'.repeat(121) });

    expect(resultado.errores.map((e) => e.campo)).toEqual(['sku', 'nombre']);
  });

  test('rechaza una entrada que no es un objeto', () => {
    expect(validarRepuesto(null).valido).toBe(false);
    expect(validarRepuesto([]).valido).toBe(false);
    expect(validarRepuesto('repuesto').valido).toBe(false);
  });
});
