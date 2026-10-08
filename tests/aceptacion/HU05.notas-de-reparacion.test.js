/**
 * PRUEBA DE ACEPTACIÓN — HU-05 Agregar notas o detalles de la reparación (mecánico) · Sprint 2
 *
 * Criterio: permitir añadir texto libre a una orden existente para
 * documentar observaciones del servicio.
 *
 * Prueba de funcionalidad del sprint: "agregar una nota a una orden y
 * verificar que se guarde y se muestre correctamente al recargar la vista".
 */
const { crearContexto } = require('../helpers/contexto');
const { ordenValida } = require('../helpers/datos');

const NOTA = 'Se cambiaron pastillas delanteras.\nDiscos dentro de tolerancia; revisar en 10.000 km.';

describe('HU-05 · Criterio de aceptación: la nota se guarda y se ve al recargar', () => {
  test('Escenario 1 — Dada una orden existente sin notas, Cuando el mecánico agrega una nota, Entonces al volver a consultar la orden (recargar) la nota aparece igual, con saltos de línea', async () => {
    // Dado
    const ctx = crearContexto();
    const mecanico = ctx.como('mecanico');
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());

    // Cuando
    const guardado = await mecanico.patch(`/api/ordenes/${orden.id}/notas`).send({ notas: NOTA });

    // Entonces
    expect(guardado.status).toBe(200);
    const recargada = await mecanico.get(`/api/ordenes/${orden.id}`);
    expect(recargada.body.notas).toBe(NOTA);
  });

  test('Escenario 2 — Dada una orden con una nota, Cuando otra persona autorizada (el dueño) la consulta, Entonces ve la misma nota y quién la escribió', async () => {
    // Dado
    const ctx = crearContexto();
    const mecanico = ctx.como('mecanico');
    const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
    await mecanico.patch(`/api/ordenes/${orden.id}/notas`).send({ notas: NOTA });

    // Cuando
    const vista = await ctx.como('dueno').get(`/api/ordenes/${orden.id}`);

    // Entonces
    expect(vista.body.notas).toBe(NOTA);
    expect(vista.body.notasActualizadasPor).toBe(ctx.usuario('mecanico').nombre);
  });
});
