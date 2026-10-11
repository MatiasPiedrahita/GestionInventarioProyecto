/**
 * PRUEBA DE ACEPTACIÓN — HU-08 Alertas de stock bajo (dueño) · Sprint 3
 *
 * Criterio: el dueño recibe una notificación (en el panel de la aplicación
 * y, si lo pide, por correo) cuando el stock de un repuesto llega a su
 * mínimo o baja de él (stock <= mínimo).
 *
 * Prueba de funcionalidad del sprint: "reducir el stock de un repuesto hasta
 * su mínimo y verificar que se genere la alerta y la notificación".
 *
 * El correo se simula: sin servidor SMTP configurado, el mensaje queda en la
 * bandeja de salida (tabla correos_salientes), que es lo que revisa la prueba.
 */
const { crearContexto } = require('../helpers/contexto');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('HU-08 · Criterio de aceptación: el dueño es notificado cuando un repuesto llega a su stock mínimo', () => {
  async function tallerConFiltro({ stockActual, stockMinimo }) {
    const ctx = crearContexto();
    const dueno = ctx.como('dueno');
    const mecanico = ctx.como('mecanico');
    const { body: filtro } = await dueno.post('/api/repuestos').send(repuestoValido({ stockActual, stockMinimo }));
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
    const usar = (cantidad) => mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: filtro.id, cantidad }] });
    return { ctx, dueno, mecanico, filtro, usar };
  }

  test('Escenario 1 — Dado un filtro con 5 unidades y mínimo 3, y un dueño que pidió los avisos por correo, Cuando el mecánico usa 2 unidades y el stock queda en 3 (igual al mínimo), Entonces se genera la alerta, el dueño la ve en su campana y se le envía el correo', async () => {
    // Dado
    const { ctx, dueno, usar } = await tallerConFiltro({ stockActual: 5, stockMinimo: 3 });
    await dueno.put('/api/notificaciones/preferencias').send({ email: 'jorge@taller.co', notificarPorCorreo: true });

    // Cuando
    const res = await usar(2);

    // Entonces
    expect(res.status).toBe(201);
    const alertas = await dueno.get('/api/alertas');
    expect(alertas.body.datos).toEqual([
      expect.objectContaining({ tipo: 'STOCK_BAJO', estado: 'ACTIVA', repuesto: expect.objectContaining({ sku: 'FIL-ACE-001', stockActual: 3, stockMinimo: 3 }) }),
    ]);
    const campana = await dueno.get('/api/notificaciones');
    expect(campana.body.noLeidas).toBe(1);
    expect(campana.body.datos[0]).toMatchObject({ titulo: 'Stock bajo: FIL-ACE-001', leida: false, vista: 'alertas' });
    const correo = ctx.db.prepare('SELECT destinatario, asunto, estado FROM correos_salientes').get();
    expect(correo).toEqual({ destinatario: 'jorge@taller.co', asunto: '[Taller] Stock bajo: FIL-ACE-001', estado: 'SIMULADO' });
  });

  test('Escenario 2 — Dado un filtro con 5 unidades y mínimo 3, Cuando el mecánico usa 1 unidad y el stock queda en 4 (por encima del mínimo), Entonces no se genera ninguna alerta ni notificación', async () => {
    // Dado
    const { ctx, dueno, usar } = await tallerConFiltro({ stockActual: 5, stockMinimo: 3 });

    // Cuando
    await usar(1);

    // Entonces
    expect((await dueno.get('/api/alertas')).body.datos).toEqual([]);
    expect((await dueno.get('/api/notificaciones')).body.noLeidas).toBe(0);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM correos_salientes').get().n).toBe(0);
  });

  test('Escenario 3 — Dado un dueño que no pidió avisos por correo, Cuando el stock llega al mínimo, Entonces recibe la notificación en la aplicación pero no se le envía correo', async () => {
    // Dado
    const { ctx, dueno, usar } = await tallerConFiltro({ stockActual: 5, stockMinimo: 3 });

    // Cuando
    await usar(2);

    // Entonces
    expect((await dueno.get('/api/notificaciones')).body.noLeidas).toBe(1);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM correos_salientes').get().n).toBe(0);
  });

  test('Escenario 4 — Dada una alerta de stock bajo, Cuando el dueño registra la entrada de mercancía y el stock supera el mínimo, Entonces la alerta se resuelve sola', async () => {
    // Dado
    const { dueno, filtro, usar } = await tallerConFiltro({ stockActual: 5, stockMinimo: 3 });
    await usar(4);
    expect((await dueno.get('/api/alertas')).body.datos).toHaveLength(1);

    // Cuando
    await dueno.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 12, detalle: 'Factura 4471' });

    // Entonces
    expect((await dueno.get('/api/alertas')).body.datos).toEqual([]);
    expect((await dueno.get('/api/alertas').query({ estado: 'RESUELTAS' })).body.total).toBe(1);
  });

  test('Escenario 5 — Dado un mecánico, Cuando un repuesto llega a su mínimo, Entonces el mecánico no recibe la alerta ni puede consultarla: es información del dueño', async () => {
    // Dado
    const { mecanico, usar } = await tallerConFiltro({ stockActual: 5, stockMinimo: 3 });

    // Cuando
    await usar(5);

    // Entonces
    expect((await mecanico.get('/api/notificaciones')).body.noLeidas).toBe(0);
    expect((await mecanico.get('/api/alertas')).status).toBe(403);
  });
});
