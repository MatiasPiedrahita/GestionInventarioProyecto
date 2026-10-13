const { crearContexto } = require('../helpers/contexto');
const { crearMotorSimulado } = require('../helpers/motor-simulado');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('Reportes de la predicción (integración, motor simulado)', () => {
  let ctx;
  let admin;
  let dueno;
  let mecanico;
  let filtro;
  let correa;
  let quieto;

  /** Consumo de la semana pasada, para que entre en la predicción. */
  async function consumir(repuesto, cantidad) {
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: repuesto.id, cantidad }] });
    ctx.db.prepare("UPDATE detalle_repuestos SET creado_en = datetime('now', '-7 days') WHERE orden_id = ?").run(orden.id);
  }

  async function predecir() {
    await admin.post('/api/prediccion/ejecuciones').send({});
    await ctx.servicios.prediccion.esperar();
  }

  beforeEach(async () => {
    // El motor simulado informa cuántas semanas lleva sin usarse cada repuesto según su consumo.
    const motor = crearMotorSimulado({
      ajustar: (prediccion, repuesto) => ({ ...prediccion, historia: { ...prediccion.historia, semanasSinConsumo: repuesto.consumo.length ? 0 : 40 } }),
    });
    ctx = crearContexto({ motorDePrediccion: motor });
    admin = ctx.como('administrador');
    dueno = ctx.como('dueno');
    mecanico = ctx.como('mecanico');
    filtro = (await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 10, stockMinimo: 1, proveedor: 'Autopartes del Valle' }))).body;
    correa = (await dueno.post('/api/repuestos').send(repuestoValido({
      sku: 'COR-DIS-006', nombre: 'Correa de distribución', costo: 185000, stockActual: 60, stockMinimo: 1, proveedor: 'Repuestos Renault Itagüí',
    }))).body;
    quieto = (await dueno.post('/api/repuestos').send(repuestoValido({
      sku: 'REF-VER-012', nombre: 'Refrigerante descontinuado', costo: 46000, stockActual: 8, stockMinimo: 0, proveedor: '=HYPERLINK("http://malo.example")',
    }))).body;
    await consumir(filtro, 7);
    await consumir(correa, 2);
  });

  describe('GET /api/prediccion/reportes', () => {
    test('sin predicción calculada responde 404 con una explicación', async () => {
      const res = await admin.get('/api/prediccion/reportes');

      expect(res.status).toBe(404);
      expect(res.body.mensaje).toBe('Todavía no se ha ejecutado la predicción de demanda');
    });

    test('compras sugeridas: solo lo que hay que pedir, agrupado por proveedor y con su costo', async () => {
      await predecir();

      const { compras, ejecucion } = (await admin.get('/api/prediccion/reportes')).body;

      expect(ejecucion.estado).toBe('COMPLETADA');
      // La correa tiene 58 en stock: no hay que pedirla. El filtro (3 en stock, 7 por semana) sí.
      expect(compras.proveedores).toEqual([{
        proveedor: 'Autopartes del Valle',
        unidades: 35,
        total: 997500,
        items: [expect.objectContaining({ sku: 'FIL-ACE-001', stockActual: 3, cantidad: 35, costoUnitario: 28500, subtotal: 997500, urgente: true })],
      }]);
      expect(compras).toMatchObject({ repuestos: 1, unidades: 35, urgentes: 1, total: 997500 });
    });

    test('clasificación ABC, repuestos sin movimiento y precisión del modelo', async () => {
      await predecir();

      const { abc, sinMovimiento, precision } = (await dueno.get('/api/prediccion/reportes')).body;

      expect(abc.items.map((i) => i.sku)).toEqual(['COR-DIS-006', 'FIL-ACE-001', 'REF-VER-012']);
      expect(abc.items[0].valorConsumoAnual).toBe(2 * 52 * 185000);
      expect(abc.clases.map((c) => c.clase)).toEqual(['A', 'B', 'C']);
      expect(sinMovimiento.items).toEqual([expect.objectContaining({ sku: 'REF-VER-012', stockActual: 8, semanasSinConsumo: 40, valorInmovilizado: 368000 })]);
      expect(sinMovimiento.valorInmovilizado).toBe(368000);
      expect(precision).toMatchObject({ evaluados: 2, sinEvaluar: 1, superanAlIngenuo: 2, mejoraMediana: 0.2 });
      expect(precision.items.map((i) => i.sku)).toEqual(['COR-DIS-006', 'FIL-ACE-001', 'REF-VER-012']);
    });

    test('los reportes usan el stock de ahora: si llega mercancía, el repuesto sin movimiento sigue ahí pero con su valor actual', async () => {
      await predecir();
      await dueno.post(`/api/repuestos/${quieto.id}/entradas`).send({ cantidad: 2 });

      const { sinMovimiento } = (await admin.get('/api/prediccion/reportes')).body;

      expect(sinMovimiento.items[0]).toMatchObject({ stockActual: 10, valorInmovilizado: 460000 });
    });

    test('un repuesto dado de baja sale de todos los reportes', async () => {
      await predecir();
      await dueno.delete(`/api/repuestos/${filtro.id}`);

      const { compras, abc, precision } = (await admin.get('/api/prediccion/reportes')).body;

      expect(compras.repuestos).toBe(0);
      expect(abc.items.map((i) => i.sku)).not.toContain('FIL-ACE-001');
      expect(precision.items).toHaveLength(2);
    });

    test.each([['mecanico'], ['recepcionista']])('%s no puede consultar los reportes ni exportarlos (403)', async (rol) => {
      await predecir();

      expect((await ctx.como(rol).get('/api/prediccion/reportes')).status).toBe(403);
      expect((await ctx.como(rol).get('/api/prediccion/reportes/compras.csv')).status).toBe(403);
      expect((await ctx.anonimo().get('/api/prediccion/reportes/compras.csv')).status).toBe(401);
    });
  });

  describe('GET /api/prediccion/reportes/compras.csv', () => {
    test('descarga un archivo CSV para Excel con una fila por repuesto y el total', async () => {
      await predecir();

      const res = await admin.get('/api/prediccion/reportes/compras.csv');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="compras-sugeridas-\d{4}-\d{2}-\d{2}\.csv"$/);
      expect(res.headers['cache-control']).toBe('no-store');
      const lineas = res.text.replace('﻿', '').trimEnd().split('\r\n');
      expect(res.text.charCodeAt(0)).toBe(0xfeff);
      expect(lineas[0]).toBe('Proveedor;SKU;Repuesto;Stock actual;Se agota el;Cantidad sugerida;Costo unitario;Subtotal');
      expect(lineas[1]).toMatch(/^Autopartes del Valle;FIL-ACE-001;Filtro de aceite Mann W712;3;\d{4}-\d{2}-\d{2};35;28500;997500$/);
      expect(lineas[2]).toBe('Total;;;;;35;;997500');
    });

    test('un nombre de proveedor que parece una fórmula no llega a Excel como fórmula', async () => {
      await consumir(quieto, 7);
      await predecir();

      const res = await admin.get('/api/prediccion/reportes/compras.csv');
      const lineaDelMalicioso = res.text.split('\r\n').find((linea) => linea.includes('REF-VER-012'));

      expect(lineaDelMalicioso.startsWith('"\'=HYPERLINK(')).toBe(true);
      expect(res.text).not.toMatch(/(^|\r\n|;)=HYPERLINK/);
    });

    test('sin predicción responde 404, no un archivo vacío', async () => {
      expect((await admin.get('/api/prediccion/reportes/compras.csv')).status).toBe(404);
    });
  });
});
