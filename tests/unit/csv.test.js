const { parsearCsv } = require('../../src/modules/inventario/csv');

describe('parsearCsv (unitarias)', () => {
  test('lee CSV separado por punto y coma (formato de Excel en español) y mapea encabezados flexibles', () => {
    const texto = '\uFEFFSKU;Nombre;Costo;Stock Actual;stock_minimo;Proveedor;Ubicación\r\nFIL-1;Filtro;28500;14;5;Valle;A1\r\n';

    const { filas, columnasDesconocidas } = parsearCsv(texto);

    expect(columnasDesconocidas).toEqual([]);
    expect(filas).toEqual([
      {
        numeroFila: 2,
        datos: { sku: 'FIL-1', nombre: 'Filtro', costo: '28500', stockActual: '14', stockMinimo: '5', proveedor: 'Valle', ubicacion: 'A1' },
      },
    ]);
  });

  test('respeta campos entre comillas que contienen el separador y comillas escapadas', () => {
    const texto = 'sku,nombre,costo,stockActual\nCOR-1,"Correa, distribución ""Logan""",185000,2\n';

    const { filas } = parsearCsv(texto);

    expect(filas[0].datos.nombre).toBe('Correa, distribución "Logan"');
  });

  test('ignora líneas vacías, conserva el número de fila real y reporta columnas desconocidas', () => {
    const texto = 'sku,nombre,color\n\nA1,Tornillo,rojo\n';

    const { filas, columnasDesconocidas } = parsearCsv(texto);

    expect(filas).toHaveLength(1);
    expect(filas[0].numeroFila).toBe(3);
    expect(columnasDesconocidas).toEqual(['color']);
  });

  test('lanza un error si el archivo está vacío', () => {
    expect(() => parsearCsv('   ')).toThrow('El archivo CSV está vacío');
  });
});
