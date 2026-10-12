const {
  comprasSugeridas, clasificacionAbc, sinMovimiento, precisionDelModelo, comprasEnCsv, celdaCsv,
} = require('../../src/modules/prediccion/reportes');

let siguienteId = 0;

/** Una predicción con valores razonables; cada prueba cambia solo lo que le interesa. */
function prediccion({ repuesto = {}, metricas = {}, historia = {}, ...cambios } = {}) {
  siguienteId += 1;
  return {
    repuesto: { id: siguienteId, sku: `REP-${String(siguienteId).padStart(3, '0')}`, nombre: `Repuesto ${siguienteId}`, proveedor: 'Autopartes del Valle', costo: 10000, stockActual: 5, stockMinimo: 2, activo: true, ...repuesto },
    patron: 'SUAVE',
    modelo: 'MEDIA_MOVIL',
    modeloNombre: 'Media móvil de 8 semanas',
    metricas: { rmsse: 0.8, wape: 0.3, sesgo: 0.05, mejoraSobreIngenuo: 0.2, semanasDePrueba: 52, ...metricas },
    historia: { semanas: 100, semanasSinConsumo: 0, consumoUltimoAnio: 100, ...historia },
    valorConsumoAnual: 1000000,
    claseAbc: 'A',
    puntoDeReorden: 8,
    cantidadSugerida: 10,
    debePedir: true,
    diasDeCobertura: 5,
    fechaDeQuiebre: '2026-10-17',
    quiebreAntesDeReponer: false,
    aviso: null,
    ...cambios,
  };
}

beforeEach(() => { siguienteId = 0; });

describe('comprasSugeridas (unitarias)', () => {
  test('agrupa por proveedor lo que hay que pedir, con subtotales y totales', () => {
    const compras = comprasSugeridas([
      prediccion({ repuesto: { sku: 'FIL-1', proveedor: 'Autopartes del Valle', costo: 28500 }, cantidadSugerida: 40 }),
      prediccion({ repuesto: { sku: 'PAS-1', proveedor: 'Frenos y Partes SAS', costo: 96000 }, cantidadSugerida: 10 }),
      prediccion({ repuesto: { sku: 'FIL-2', proveedor: 'Autopartes del Valle', costo: 41000 }, cantidadSugerida: 5 }),
    ]);

    expect(compras.proveedores.map((p) => [p.proveedor, p.items.map((i) => i.sku), p.unidades, p.total])).toEqual([
      ['Autopartes del Valle', ['FIL-1', 'FIL-2'], 45, 1345000],
      ['Frenos y Partes SAS', ['PAS-1'], 10, 960000],
    ]);
    expect(compras).toMatchObject({ repuestos: 3, unidades: 55, total: 2305000, urgentes: 0 });
    expect(compras.proveedores[0].items[0]).toMatchObject({ cantidad: 40, costoUnitario: 28500, subtotal: 1140000 });
  });

  test('solo incluye lo que hay que pedir hoy', () => {
    const compras = comprasSugeridas([
      prediccion({ debePedir: false, cantidadSugerida: 12 }),
      prediccion({ debePedir: true, cantidadSugerida: 0 }),
    ]);

    expect(compras).toEqual({ proveedores: [], repuestos: 0, unidades: 0, urgentes: 0, total: 0 });
  });

  test('dentro de cada proveedor va primero lo que se agota antes, y cuenta los urgentes', () => {
    const compras = comprasSugeridas([
      prediccion({ repuesto: { sku: 'TARDE' }, diasDeCobertura: 20 }),
      prediccion({ repuesto: { sku: 'YA' }, diasDeCobertura: 0, quiebreAntesDeReponer: true }),
      prediccion({ repuesto: { sku: 'SIN-FECHA' }, diasDeCobertura: null }),
      prediccion({ repuesto: { sku: 'PRONTO' }, diasDeCobertura: 3, quiebreAntesDeReponer: true }),
    ]);

    expect(compras.proveedores[0].items.map((i) => i.sku)).toEqual(['YA', 'PRONTO', 'TARDE', 'SIN-FECHA']);
    expect(compras.urgentes).toBe(2);
  });

  test('los repuestos sin proveedor van en su propio grupo, al final', () => {
    const compras = comprasSugeridas([
      prediccion({ repuesto: { proveedor: null } }),
      prediccion({ repuesto: { proveedor: 'Zeta Repuestos' } }),
      prediccion({ repuesto: { proveedor: 'Álvarez e Hijos' } }),
    ]);

    expect(compras.proveedores.map((p) => p.proveedor)).toEqual(['Álvarez e Hijos', 'Zeta Repuestos', 'Sin proveedor registrado']);
  });
});

describe('clasificacionAbc (unitarias)', () => {
  test('ordena por valor de consumo y calcula la participación de cada repuesto y de cada clase', () => {
    const abc = clasificacionAbc([
      prediccion({ repuesto: { sku: 'C-1' }, valorConsumoAnual: 50, claseAbc: 'C' }),
      prediccion({ repuesto: { sku: 'A-1' }, valorConsumoAnual: 800, claseAbc: 'A' }),
      prediccion({ repuesto: { sku: 'B-1' }, valorConsumoAnual: 150, claseAbc: 'B' }),
    ]);

    expect(abc.items.map((i) => [i.sku, i.clase, i.participacion, i.acumulado])).toEqual([
      ['A-1', 'A', 0.8, 0.8], ['B-1', 'B', 0.15, 0.95], ['C-1', 'C', 0.05, 1],
    ]);
    expect(abc.clases).toEqual([
      { clase: 'A', repuestos: 1, valor: 800, participacion: 0.8 },
      { clase: 'B', repuestos: 1, valor: 150, participacion: 0.15 },
      { clase: 'C', repuestos: 1, valor: 50, participacion: 0.05 },
    ]);
    expect(abc.total).toBe(1000);
  });

  test('sin consumo en todo el catálogo no divide por cero', () => {
    const abc = clasificacionAbc([prediccion({ valorConsumoAnual: 0, claseAbc: 'C' })]);

    expect(abc.items[0]).toMatchObject({ participacion: 0, acumulado: 0 });
    expect(abc.clases.map((c) => c.repuestos)).toEqual([0, 0, 1]);
    expect(clasificacionAbc([])).toMatchObject({ items: [], total: 0 });
  });
});

describe('sinMovimiento (unitarias)', () => {
  test('lista los repuestos con stock que llevan 12 semanas o más sin usarse, o que nunca se han usado', () => {
    const reporte = sinMovimiento([
      prediccion({ repuesto: { sku: 'ACTIVO', stockActual: 9 }, historia: { semanasSinConsumo: 2 } }),
      prediccion({ repuesto: { sku: 'JUSTO', stockActual: 1, costo: 5000 }, historia: { semanasSinConsumo: 12 } }),
      prediccion({ repuesto: { sku: 'PARADO', stockActual: 8, costo: 46000 }, historia: { semanasSinConsumo: 53 } }),
      prediccion({ repuesto: { sku: 'NUNCA', stockActual: 2, costo: 100000 }, historia: { semanasSinConsumo: null } }),
      prediccion({ repuesto: { sku: 'AGOTADO', stockActual: 0 }, historia: { semanasSinConsumo: 80 } }),
    ]);

    // Primero lo que más plata tiene quieta. Lo que ya no tiene stock no cuenta: no hay nada inmovilizado.
    expect(reporte.items.map((i) => [i.sku, i.valorInmovilizado])).toEqual([['PARADO', 368000], ['NUNCA', 200000], ['JUSTO', 5000]]);
    expect(reporte.valorInmovilizado).toBe(573000);
    expect(reporte.semanasDeCorte).toBe(12);
  });
});

describe('precisionDelModelo (unitarias)', () => {
  test('resume cuántos repuestos se evaluaron, cuántos superan al ingenuo y la mejora mediana', () => {
    const precision = precisionDelModelo([
      prediccion({ metricas: { mejoraSobreIngenuo: 0.4 } }),
      prediccion({ metricas: { mejoraSobreIngenuo: 0.1 } }),
      prediccion({ metricas: { mejoraSobreIngenuo: -0.2 }, aviso: 'Ningún modelo pronostica mejor' }),
      prediccion({ modelo: 'SIN_HISTORIA', modeloNombre: 'Sin modelo', metricas: { rmsse: null, wape: null, sesgo: null, mejoraSobreIngenuo: null, semanasDePrueba: 0 } }),
    ]);

    expect(precision).toMatchObject({ evaluados: 3, sinEvaluar: 1, superanAlIngenuo: 2, mejoraMediana: 0.1 });
    expect(precision.porModelo).toEqual([{ modelo: 'Media móvil de 8 semanas', repuestos: 3 }, { modelo: 'Sin modelo', repuestos: 1 }]);
    expect(precision.items).toHaveLength(4);
    expect(precision.items[2].aviso).toBe('Ningún modelo pronostica mejor');
  });

  test('con cantidad par de repuestos, la mediana es el promedio de los dos del medio; sin evaluados, queda vacía', () => {
    const par = precisionDelModelo([0.1, 0.2, 0.4, 0.9].map((m) => prediccion({ metricas: { mejoraSobreIngenuo: m } })));

    expect(par.mejoraMediana).toBe(0.3);
    expect(precisionDelModelo([])).toMatchObject({ evaluados: 0, superanAlIngenuo: 0, mejoraMediana: null, porModelo: [] });
  });
});

describe('exportación a CSV (unitarias)', () => {
  test.each([
    ['texto normal', 'Filtro de aceite', 'Filtro de aceite'],
    ['número', 28500, '28500'],
    ['vacío', null, ''],
    ['con punto y coma', 'Filtro; grande', '"Filtro; grande"'],
    ['con comillas', 'Llanta 15"', '"Llanta 15"""'],
    ['con salto de línea', 'uno\ndos', '"uno\ndos"'],
  ])('celdaCsv con %s', (_, valor, esperado) => {
    expect(celdaCsv(valor)).toBe(esperado);
  });

  test.each([
    ['=HYPERLINK("http://malo.example","clic")'],
    ['+34 600 000 000'],
    ['-2+3'],
    ['@SUM(A1:A9)'],
    ['\t=1+1'],
  ])('neutraliza la inyección de fórmulas: %s no queda como fórmula', (peligroso) => {
    const celda = celdaCsv(peligroso);
    const contenido = celda.startsWith('"') ? celda.slice(1) : celda;

    expect(contenido.startsWith("'")).toBe(true);
  });

  test('el archivo lleva marca de UTF-8, encabezados, una fila por repuesto y el total', () => {
    const csv = comprasEnCsv(comprasSugeridas([
      prediccion({ repuesto: { sku: 'FIL-1', nombre: 'Filtro de aceite', proveedor: 'Autopartes del Valle', costo: 28500, stockActual: 2 }, cantidadSugerida: 40 }),
      prediccion({ repuesto: { sku: 'COR-1', nombre: 'Correa "Renault"', proveedor: '=cmd|calc', costo: 185000 }, cantidadSugerida: 2, fechaDeQuiebre: null }),
    ]));
    const lineas = csv.replace('﻿', '').trimEnd().split('\r\n');

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(lineas[0]).toBe('Proveedor;SKU;Repuesto;Stock actual;Se agota el;Cantidad sugerida;Costo unitario;Subtotal');
    expect(lineas[1]).toBe("'=cmd|calc;COR-1;\"Correa \"\"Renault\"\"\";5;;2;185000;370000");
    expect(lineas[2]).toBe('Autopartes del Valle;FIL-1;Filtro de aceite;2;2026-10-17;40;28500;1140000');
    expect(lineas[3]).toBe('Total;;;;;42;;1510000');
  });
});
