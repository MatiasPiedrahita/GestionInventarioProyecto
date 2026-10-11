/**
 * Casos límite de los validadores que no cubrían las pruebas de cada historia:
 * tipos de dato inesperados, longitudes máximas y entradas vacías.
 */
const { validarRepuesto } = require('../../src/modules/inventario/repuesto.validator');
const { validarNuevaOrden, normalizarPlaca } = require('../../src/modules/ordenes/orden.validator');
const { validarFiltros } = require('../../src/modules/ordenes/filtros.validator');
const { validarRepuestosUsados } = require('../../src/modules/ordenes/repuestos-usados.validator');
const { parsearCsv } = require('../../src/modules/inventario/csv');
const { ordenValida, repuestoValido } = require('../helpers/datos');

const camposConError = (resultado) => resultado.errores.map((e) => e.campo);

describe('validarRepuesto · casos límite', () => {
  test.each([
    ['costo booleano', { costo: true }, 'costo', 'El costo debe ser un número'],
    ['costo como lista', { costo: [100] }, 'costo', 'El costo debe ser un número'],
    ['stock booleano', { stockActual: false }, 'stockActual', 'El stock actual debe ser un número entero'],
    ['stock con decimales', { stockActual: 2.5 }, 'stockActual', 'El stock actual debe ser un número entero'],
    ['nombre numérico', { nombre: 12345 }, 'nombre', 'El nombre debe ser texto'],
    ['proveedor como objeto', { proveedor: { nombre: 'x' } }, 'proveedor', 'El proveedor debe ser texto'],
    ['nombre de 121 caracteres', { nombre: 'a'.repeat(121) }, 'nombre', 'El nombre admite máximo 120 caracteres'],
    ['ubicación de 61 caracteres', { ubicacion: 'a'.repeat(61) }, 'ubicacion', 'La ubicación admite máximo 60 caracteres'],
    ['SKU con espacios', { sku: 'FIL ACE' }, 'sku', 'El SKU solo admite letras, números, guion, guion bajo y punto'],
  ])('rechaza %s', (_, cambios, campo, mensaje) => {
    const resultado = validarRepuesto(repuestoValido(cambios));

    expect(resultado.valido).toBe(false);
    expect(resultado.errores).toContainEqual({ campo, mensaje });
  });

  test.each([[null], [undefined], ['texto'], [[1, 2]], [42]])('rechaza %p como entrada', (entrada) => {
    expect(camposConError(validarRepuesto(entrada))).toEqual(['_']);
  });

  test('redondea el costo a dos decimales', () => {
    expect(validarRepuesto(repuestoValido({ costo: '1234.5678' })).valor.costo).toBe(1234.57);
  });
});

describe('validarNuevaOrden · casos límite', () => {
  test.each([
    ['teléfono con letras', { cliente: { ...ordenValida().cliente, telefono: 'no-tengo' } }, 'cliente.telefono'],
    ['documento con símbolos', { cliente: { ...ordenValida().cliente, documento: '12#45%78' } }, 'cliente.documento'],
    ['nombre de 121 caracteres', { cliente: { ...ordenValida().cliente, nombre: 'a'.repeat(121) } }, 'cliente.nombre'],
    ['correo sin dominio', { cliente: { ...ordenValida().cliente, email: 'camila@' } }, 'cliente.email'],
    ['año anterior a 1950', { vehiculo: { ...ordenValida().vehiculo, anio: 1949 } }, 'vehiculo.anio'],
    ['descripción de 1001 caracteres', { descripcion: 'a'.repeat(1001) }, 'descripcion'],
    ['mecánico con id negativo', { mecanicoId: -1 }, 'mecanicoId'],
  ])('rechaza %s', (_, cambios, campo) => {
    const resultado = validarNuevaOrden(ordenValida(cambios));

    expect(resultado.valido).toBe(false);
    expect(camposConError(resultado)).toEqual([campo]);
  });

  test('acepta el año siguiente al actual (modelo nuevo) y rechaza dos años adelante', () => {
    const conAnio = (anio) => validarNuevaOrden(ordenValida({ vehiculo: { ...ordenValida().vehiculo, anio } }), { anioActual: 2026 });

    expect(conAnio(2027).valido).toBe(true);
    expect(conAnio(2028).valido).toBe(false);
  });

  test.each([[null], [undefined], ['texto'], [7]])('con %p como entrada informa todos los campos obligatorios', (entrada) => {
    expect(camposConError(validarNuevaOrden(entrada))).toEqual([
      'cliente.documento', 'cliente.nombre', 'cliente.telefono', 'vehiculo.placa', 'vehiculo.marca', 'vehiculo.modelo', 'descripcion',
    ]);
  });

  test('normalizarPlaca tolera valores que no son texto', () => {
    expect(normalizarPlaca(undefined)).toBe('');
    expect(normalizarPlaca(123456)).toBe('');
    expect(normalizarPlaca(' abc 12d ')).toBe('ABC12D');
  });
});

describe('validarFiltros · casos límite', () => {
  test('rechaza una búsqueda de cliente de más de 120 caracteres', () => {
    expect(camposConError(validarFiltros({ cliente: 'a'.repeat(121) }))).toEqual(['cliente']);
  });

  test('sin argumentos usa los valores por defecto', () => {
    expect(validarFiltros().valor).toMatchObject({ pagina: 1, tamano: 10 });
  });

  test('ignora parámetros repetidos (?placa=a&placa=b llega como lista)', () => {
    expect(validarFiltros({ placa: ['ABC123', 'DEF456'], estado: ['ACTIVAS', 'x'] }).valor).toMatchObject({ placa: null, estado: null });
  });

  test('acumula todos los errores en una sola respuesta', () => {
    expect(camposConError(validarFiltros({ estado: 'x', pagina: '-1', tamano: '51', mecanicoId: '1.5' }))).toEqual([
      'mecanicoId', 'estado', 'pagina', 'tamano',
    ]);
  });
});

describe('validarRepuestosUsados · casos límite', () => {
  test('rechaza más de 50 repuestos en un solo registro', () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ repuestoId: i + 1, cantidad: 1 }));

    expect(validarRepuestosUsados({ items }).errores).toEqual([{ campo: 'items', mensaje: 'Máximo 50 repuestos por registro' }]);
  });

  test.each([[null], [{}], [{ items: 'no es lista' }], [{ items: [] }]])('rechaza %p', (entrada) => {
    expect(camposConError(validarRepuestosUsados(entrada))).toEqual(['items']);
  });

  test('un elemento nulo dentro de la lista se informa sin romper la validación', () => {
    expect(camposConError(validarRepuestosUsados({ items: [null] }))).toEqual(['items[0].repuestoId', 'items[0].cantidad']);
  });
});

describe('parsearCsv · casos límite', () => {
  test('una fila con menos columnas deja vacíos los campos que faltan', () => {
    const { filas } = parsearCsv('sku,nombre,costo,stockActual\nA-1,Tornillo\n');

    expect(filas[0].datos).toEqual({ sku: 'A-1', nombre: 'Tornillo', costo: '', stockActual: '' });
  });

  test('informa las columnas que no reconoce y las ignora', () => {
    const { filas, columnasDesconocidas } = parsearCsv('sku,color,nombre\nA-1,rojo,Tornillo\n');

    expect(columnasDesconocidas).toEqual(['color']);
    expect(filas[0].datos).toEqual({ sku: 'A-1', nombre: 'Tornillo' });
  });

  test.each([[undefined], [null], [''], ['   \n  ']])('rechaza %p como archivo vacío', (texto) => {
    expect(() => parsearCsv(texto)).toThrow('El archivo CSV está vacío');
  });
});
