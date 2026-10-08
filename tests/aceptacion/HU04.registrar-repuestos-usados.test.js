/**
 * PRUEBA DE ACEPTACIÓN — HU-04 Registrar repuestos usados en una reparación (mecánico) · Sprint 2
 *
 * Criterio: seleccionar repuestos y cantidades desde el inventario y
 * asociarlos a la orden, descontando el stock automáticamente.
 *
 * Prueba de funcionalidad del sprint: "registrar el uso de 2 unidades de un
 * repuesto en una orden y verificar que el stock se reduzca en esa cantidad".
 */
const { crearContexto } = require('../helpers/contexto');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('HU-04 · Criterio de aceptación: el stock se descuenta al registrar repuestos en una orden', () => {
  test('Escenario 1 — Dado un filtro con 10 unidades y una orden en proceso, Cuando el mecánico registra 2 unidades en la orden, Entonces el stock queda en 8 y el repuesto aparece asociado a la orden', async () => {
    // Dado
    const ctx = crearContexto();
    const { body: filtro } = await ctx.como('dueno').post('/api/repuestos').send(repuestoValido({ stockActual: 10 }));
    const mecanico = ctx.como('mecanico');
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());

    // Cuando
    const res = await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 2 }] });

    // Entonces
    expect(res.status).toBe(201);
    const stock = ctx.db.prepare('SELECT stock_actual FROM repuestos WHERE id = ?').get(filtro.id).stock_actual;
    expect(stock).toBe(8);
    const detalle = await mecanico.get(`/api/ordenes/${orden.id}`);
    expect(detalle.body.repuestos).toEqual([expect.objectContaining({ repuestoId: filtro.id, cantidad: 2 })]);
  });

  test('Escenario 2 — Dado un filtro con solo 1 unidad, Cuando el mecánico intenta registrar 2, Entonces se rechaza y el stock sigue en 1 (nunca queda negativo)', async () => {
    // Dado
    const ctx = crearContexto();
    const { body: filtro } = await ctx.como('dueno').post('/api/repuestos').send(repuestoValido({ stockActual: 1 }));
    const mecanico = ctx.como('mecanico');
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());

    // Cuando
    const res = await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 2 }] });

    // Entonces
    expect(res.status).toBe(409);
    const stock = ctx.db.prepare('SELECT stock_actual FROM repuestos WHERE id = ?').get(filtro.id).stock_actual;
    expect(stock).toBe(1);
  });
});
