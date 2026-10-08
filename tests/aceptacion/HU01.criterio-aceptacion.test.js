/**
 * PRUEBA DE ACEPTACIÓN — HU-01 Gestión de inventario de repuestos (Must)
 *
 * Historia: Como dueño del taller, quiero gestionar el inventario de
 * repuestos, para controlar el stock.
 *
 * Criterio de aceptación (Entrega 1, tarjeta de Trello):
 *   "Validar que no permita stock negativo ni campos obligatorios vacíos
 *    al guardar".
 *
 * Cada escenario se escribe literalmente como Dado / Cuando / Entonces.
 */
const { crearContexto } = require('../helpers/contexto');

describe('HU-01 · Criterio de aceptación: no se guarda stock negativo ni campos obligatorios vacíos', () => {
  let ctx;
  let dueno;

  beforeEach(() => {
    ctx = crearContexto();
    dueno = ctx.como('dueno');
  });

  test('Escenario 1 — Dado un inventario vacío, Cuando el dueño intenta guardar un repuesto con stock negativo, Entonces el sistema lo rechaza y el inventario sigue vacío', async () => {
    // Dado
    const antes = await dueno.get('/api/repuestos');
    expect(antes.body).toHaveLength(0);

    // Cuando
    const respuesta = await dueno.post('/api/repuestos').send({
      sku: 'FIL-ACE-001',
      nombre: 'Filtro de aceite',
      costo: 28500,
      stockActual: -3,
      stockMinimo: 5,
    });

    // Entonces
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.error).toBe('VALIDACION');
    expect(respuesta.body.detalles).toContainEqual({
      campo: 'stockActual',
      mensaje: 'El stock actual no puede ser negativo',
    });
    const despues = await dueno.get('/api/repuestos');
    expect(despues.body).toHaveLength(0);
  });

  test('Escenario 2 — Dado un inventario vacío, Cuando el dueño intenta guardar un repuesto sin SKU ni nombre, Entonces el sistema indica cada campo obligatorio faltante y no guarda nada', async () => {
    // Dado
    const antes = await dueno.get('/api/repuestos');
    expect(antes.body).toHaveLength(0);

    // Cuando
    const respuesta = await dueno.post('/api/repuestos').send({
      sku: '   ',
      nombre: '',
      costo: 15000,
      stockActual: 4,
    });

    // Entonces
    expect(respuesta.status).toBe(400);
    const camposConError = respuesta.body.detalles.map((d) => d.campo);
    expect(camposConError).toEqual(expect.arrayContaining(['sku', 'nombre']));
    const despues = await dueno.get('/api/repuestos');
    expect(despues.body).toHaveLength(0);
  });

  test('Escenario 3 — Dado un repuesto existente con 10 unidades, Cuando el dueño intenta editarlo dejando el stock en -1, Entonces se rechaza el cambio y el stock sigue en 10', async () => {
    // Dado
    const creado = await dueno.post('/api/repuestos').send({
      sku: 'BUJ-NGK-004',
      nombre: 'Bujía NGK BKR6E',
      costo: 14500,
      stockActual: 10,
      stockMinimo: 4,
    });
    expect(creado.status).toBe(201);

    // Cuando
    const edicion = await dueno
      .put(`/api/repuestos/${creado.body.id}`)
      .send({ ...creado.body, stockActual: -1 });

    // Entonces
    expect(edicion.status).toBe(400);
    const consulta = await dueno.get(`/api/repuestos/${creado.body.id}`);
    expect(consulta.body.stockActual).toBe(10);
  });
});
