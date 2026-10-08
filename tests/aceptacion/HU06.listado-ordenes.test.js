/**
 * PRUEBA DE ACEPTACIÓN — HU-06 Ver listado de órdenes de trabajo (recepcionista) · Sprint 2
 *
 * Criterio: vista global de órdenes activas e históricas con filtros por
 * cliente, placa, mecánico y estado.
 *
 * Prueba de funcionalidad del sprint: "filtrar por una placa específica y
 * comprobar que la tabla devuelva únicamente las coincidencias exactas".
 */
const { crearContexto } = require('../helpers/contexto');
const { ordenValida } = require('../helpers/datos');

describe('HU-06 · Criterio de aceptación: el filtro por placa devuelve solo coincidencias exactas', () => {
  test('Escenario 1 — Dadas órdenes de los vehículos ABC123, ABC12D, ABC124 y XABC12 (placas parecidas), Cuando la recepcionista filtra por la placa ABC123, Entonces solo obtiene las órdenes de ABC123', async () => {
    // Dado
    const ctx = crearContexto();
    const mecanico = ctx.como('mecanico');
    for (const placa of ['ABC123', 'ABC12D', 'ABC124', 'XAB123', 'ABC123']) {
      await mecanico.post('/api/ordenes').send(ordenValida({ vehiculo: { placa, marca: 'Renault', modelo: 'Logan' } }));
    }

    // Cuando
    const res = await ctx.como('recepcionista').get('/api/ordenes').query({ placa: 'ABC123' });

    // Entonces
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.datos.map((o) => o.vehiculo.placa)).toEqual(['ABC123', 'ABC123']);
  });

  test('Escenario 2 — Dada una orden activa y una histórica, Cuando la recepcionista consulta sin filtros y luego por estado, Entonces ve ambas en la vista global y cada una en su grupo', async () => {
    // Dado
    const ctx = crearContexto();
    const mecanico = ctx.como('mecanico');
    const activa = (await mecanico.post('/api/ordenes').send(ordenValida())).body;
    const historica = (await mecanico.post('/api/ordenes').send(ordenValida({ vehiculo: { placa: 'QWE456', marca: 'Kia', modelo: 'Rio' } }))).body;
    ctx.db.prepare("UPDATE ordenes SET estado = 'FINALIZADA' WHERE id = ?").run(historica.id);
    const recepcion = ctx.como('recepcionista');

    // Cuando
    const todas = await recepcion.get('/api/ordenes');
    const activas = await recepcion.get('/api/ordenes').query({ estado: 'ACTIVAS' });
    const historicas = await recepcion.get('/api/ordenes').query({ estado: 'HISTORICAS' });

    // Entonces
    expect(todas.body.total).toBe(2);
    expect(activas.body.datos.map((o) => o.id)).toEqual([activa.id]);
    expect(historicas.body.datos.map((o) => o.id)).toEqual([historica.id]);
  });
});
