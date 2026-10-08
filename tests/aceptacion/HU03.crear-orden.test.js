/**
 * PRUEBA DE ACEPTACIÓN — HU-03 Crear orden de reparación (mecánico) · Sprint 1
 *
 * Criterio: registrar una nueva orden con datos del cliente, vehículo y
 * descripción del problema, quedando en estado "En proceso".
 *
 * Prueba de funcionalidad del sprint: "crear una orden con todos los campos
 * obligatorios completos y verificar que aparezca en el listado con estado
 * En proceso".
 */
const { crearContexto } = require('../helpers/contexto');
const { ordenValida } = require('../helpers/datos');

describe('HU-03 · Criterio de aceptación: la orden creada aparece en el listado En proceso', () => {
  test('Escenario 1 — Dado un mecánico con sesión y ninguna orden, Cuando crea una orden con todos los campos obligatorios, Entonces aparece en el listado con estado "En proceso"', async () => {
    // Dado
    const ctx = crearContexto();
    const mecanico = ctx.como('mecanico');
    expect((await mecanico.get('/api/ordenes')).body).toHaveLength(0);

    // Cuando
    const creada = await mecanico.post('/api/ordenes').send(ordenValida());

    // Entonces
    expect(creada.status).toBe(201);
    const listado = await mecanico.get('/api/ordenes');
    expect(listado.body).toHaveLength(1);
    expect(listado.body[0]).toMatchObject({
      id: creada.body.id,
      estadoNombre: 'En proceso',
      vehiculo: { placa: 'ABC123' },
      cliente: { nombre: 'Camila Ortiz' },
      descripcion: 'Ruido metálico al frenar y vibración en el timón',
    });
  });

  test('Escenario 2 — Dado un mecánico con sesión, Cuando intenta crear una orden sin placa ni descripción, Entonces se rechaza indicando los campos y el listado sigue vacío', async () => {
    // Dado
    const ctx = crearContexto();
    const mecanico = ctx.como('mecanico');

    // Cuando
    const res = await mecanico.post('/api/ordenes').send(ordenValida({
      vehiculo: { placa: '', marca: 'Chevrolet', modelo: 'Spark' },
      descripcion: '   ',
    }));

    // Entonces
    expect(res.status).toBe(400);
    expect(res.body.detalles.map((d) => d.campo)).toEqual(expect.arrayContaining(['vehiculo.placa', 'descripcion']));
    expect((await mecanico.get('/api/ordenes')).body).toHaveLength(0);
  });
});
