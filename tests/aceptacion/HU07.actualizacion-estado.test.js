/**
 * PRUEBA DE ACEPTACIÓN — HU-07 Actualización del estado de órdenes (mecánico) · Sprint 2
 *
 * Criterio: el mecánico cambia el estado de la orden (En proceso, Finalizada,
 * Cancelada) y el inventario refleja los repuestos consumidos.
 *
 * Prueba de funcionalidad del sprint: "cambiar a Finalizada una orden con 2
 * filtros consumidos y confirmar el descuento de 2 unidades en la base".
 *
 * Nota de diseño (ADR-10 y ADR-12): el stock se descuenta cuando el mecánico
 * registra el repuesto, no al finalizar. Por eso la prueba confirma que al
 * finalizar el descuento en la base es de exactamente 2 unidades: ni cero
 * (se perdió el consumo) ni cuatro (se descontó dos veces).
 */
const { crearContexto } = require('../helpers/contexto');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('HU-07 · Criterio de aceptación: al finalizar una orden, el inventario refleja exactamente lo consumido', () => {
  const stockEnBase = (ctx, id) => ctx.db.prepare('SELECT stock_actual FROM repuestos WHERE id = ?').get(id).stock_actual;

  test('Escenario 1 — Dada una orden en proceso con 2 filtros consumidos (stock inicial 10), Cuando el mecánico la cambia a Finalizada, Entonces la orden queda Finalizada y en la base el stock del filtro es 8 (se descontaron 2 unidades, una sola vez)', async () => {
    // Dado
    const ctx = crearContexto();
    const { body: filtro } = await ctx.como('dueno').post('/api/repuestos').send(repuestoValido({ stockActual: 10 }));
    const mecanico = ctx.como('mecanico');
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 2 }] });

    // Cuando
    const res = await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'FINALIZADA' });

    // Entonces
    expect(res.status).toBe(200);
    expect(res.body.estadoNombre).toBe('Finalizada');
    expect(ctx.db.prepare('SELECT estado FROM ordenes WHERE id = ?').get(orden.id).estado).toBe('FINALIZADA');
    expect(stockEnBase(ctx, filtro.id)).toBe(8);
    const consumo = ctx.db
      .prepare("SELECT COALESCE(SUM(-cantidad), 0) AS unidades FROM movimientos_inventario WHERE repuesto_id = ? AND tipo = 'USO_EN_ORDEN'")
      .get(filtro.id);
    expect(consumo.unidades).toBe(2);
  });

  test('Escenario 2 — Dada una orden en proceso con 2 filtros consumidos, Cuando el mecánico la cancela indicando el motivo, Entonces los 2 filtros vuelven al inventario y el stock regresa a 10', async () => {
    // Dado
    const ctx = crearContexto();
    const { body: filtro } = await ctx.como('dueno').post('/api/repuestos').send(repuestoValido({ stockActual: 10 }));
    const mecanico = ctx.como('mecanico');
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad: 2 }] });

    // Cuando
    const res = await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'CANCELADA', motivo: 'El cliente no aprobó la reparación' });

    // Entonces
    expect(res.status).toBe(200);
    expect(res.body.estadoNombre).toBe('Cancelada');
    expect(stockEnBase(ctx, filtro.id)).toBe(10);
  });

  test('Escenario 3 — Dada una orden finalizada, Cuando el mecánico intenta devolverla a En proceso, Entonces se rechaza (403) y solo el dueño puede reabrirla', async () => {
    // Dado
    const ctx = crearContexto();
    const mecanico = ctx.como('mecanico');
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'FINALIZADA' });
    const reabrir = { estado: 'EN_PROCESO', motivo: 'Quedó pendiente la alineación' };

    // Cuando
    const porMecanico = await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send(reabrir);
    const porDueno = await ctx.como('dueno').patch(`/api/ordenes/${orden.id}/estado`).send(reabrir);

    // Entonces
    expect(porMecanico.status).toBe(403);
    expect(porDueno.status).toBe(200);
    expect(porDueno.body.estadoNombre).toBe('En proceso');
  });
});
