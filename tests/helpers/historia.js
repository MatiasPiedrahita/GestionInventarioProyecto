const { ordenValida, repuestoValido } = require('./datos');

/**
 * Crea historia de consumo para las pruebas de predicción: una orden por
 * semana, hecha con la API (así pasa por todas las reglas), y luego fechada
 * en el pasado directamente en la base de datos de la prueba.
 *
 * @param {object} ctx Contexto de la prueba (crearContexto).
 * @param {object} repuesto Repuesto creado con la API.
 * @param {number[]} unidadesPorSemana Consumo de cada semana, de la más antigua a la más reciente (la semana pasada).
 */
async function consumirPorSemanas(ctx, repuesto, unidadesPorSemana) {
  const mecanico = ctx.como('mecanico');
  const fechar = ctx.db.prepare("UPDATE detalle_repuestos SET creado_en = datetime('now', ?) WHERE orden_id = ?");
  const fecharOrden = ctx.db.prepare("UPDATE ordenes SET creado_en = datetime('now', ?) WHERE id = ?");

  for (let i = 0; i < unidadesPorSemana.length; i += 1) {
    const unidades = unidadesPorSemana[i];
    if (unidades > 0) {
      const { body: orden } = await mecanico.post('/api/ordenes').send(ordenValida());
      await mecanico.post(`/api/ordenes/${orden.id}/repuestos`).send({ items: [{ repuestoId: repuesto.id, cantidad: unidades }] });
      await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'FINALIZADA' });
      const haceSemanas = `-${(unidadesPorSemana.length - i) * 7} days`;
      fechar.run(haceSemanas, orden.id);
      fecharOrden.run(haceSemanas, orden.id);
    }
  }
  // El repuesto "existe" desde antes de su primera semana de consumo.
  ctx.db.prepare("UPDATE movimientos_inventario SET fecha = datetime('now', ?) WHERE repuesto_id = ? AND tipo = 'ALTA'")
    .run(`-${(unidadesPorSemana.length + 1) * 7} days`, repuesto.id);
}

/** Crea un repuesto con stock de sobra para generar historia y lo deja después con el stock indicado. */
async function repuestoConHistoria(ctx, { unidadesPorSemana, stockFinal, ...datos }) {
  const dueno = ctx.como('dueno');
  const consumoTotal = unidadesPorSemana.reduce((suma, u) => suma + u, 0);
  const base = repuestoValido({ stockActual: consumoTotal + stockFinal, ...datos });
  const { body: repuesto } = await dueno.post('/api/repuestos').send(base);
  await consumirPorSemanas(ctx, repuesto, unidadesPorSemana);
  return (await dueno.get(`/api/repuestos/${repuesto.id}`)).body;
}

module.exports = { consumirPorSemanas, repuestoConHistoria };
