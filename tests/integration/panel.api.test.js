const { crearContexto } = require('../helpers/contexto');
const { ordenValida, repuestoValido } = require('../helpers/datos');

/** Reloj fijo: miércoles 14 de octubre de 2026. La semana empezó el lunes 12. */
const AHORA = new Date('2026-10-14T15:00:00Z');

describe('Panel del dueño (integración)', () => {
  let ctx;
  let dueno;
  let mecanico;

  beforeEach(() => {
    ctx = crearContexto({ ahora: () => AHORA });
    dueno = ctx.como('dueno');
    mecanico = ctx.como('mecanico');
  });

  /** Crea una orden con repuestos y la deja con las fechas indicadas (como si hubiera pasado ese día). */
  async function ordenHistorica({ cliente = mecanico, creada, cerrada = null, items = [], placa = 'ABC123' }) {
    const { body: orden } = await cliente.post('/api/ordenes').send(ordenValida({ vehiculo: { placa, marca: 'Renault', modelo: 'Logan' } }));
    if (items.length) await cliente.post(`/api/ordenes/${orden.id}/repuestos`).send({ items });
    if (cerrada) await cliente.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'FINALIZADA' });
    ctx.db.prepare('UPDATE ordenes SET creado_en = ? WHERE id = ?').run(creada, orden.id);
    ctx.db.prepare('UPDATE detalle_repuestos SET creado_en = ? WHERE orden_id = ?').run(creada, orden.id);
    if (cerrada) ctx.db.prepare("UPDATE historial_estados_orden SET fecha = ? WHERE orden_id = ? AND estado_nuevo = 'FINALIZADA'").run(cerrada, orden.id);
    return orden;
  }

  describe('GET /api/panel/resumen', () => {
    test.each([['mecanico'], ['recepcionista']])('%s no puede verlo (403); sin sesión, 401', async (rol) => {
      expect((await ctx.como(rol).get('/api/panel/resumen')).status).toBe(403);
      expect((await ctx.anonimo().get('/api/panel/resumen')).status).toBe(401);
    });

    test('con el taller vacío devuelve ceros y todos los periodos, sin fallar', async () => {
      const res = await dueno.get('/api/panel/resumen');

      expect(res.status).toBe(200);
      expect(res.body.inventario).toEqual({ repuestos: 0, unidades: 0, valor: 0, bajoMinimo: 0, agotados: 0 });
      expect(res.body.ordenes).toEqual({ enProceso: 0, finalizadas: 0, canceladas: 0, finalizadasUltimos30Dias: 0 });
      expect(res.body.ordenesPorSemana).toHaveLength(8);
      expect(res.body.ordenesPorSemana[7]).toEqual({ semana: '2026-10-12', creadas: 0, finalizadas: 0 });
      expect(res.body.gastoPorMes.map((m) => m.mes)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
      expect(res.body.repuestosMasUsados).toEqual([]);
      expect(res.body.mecanicos).toEqual([expect.objectContaining({ nombre: 'Mecánico de Prueba', enProceso: 0, finalizadas: 0, horasPromedio: null })]);
    });

    test('inventario: valor a costo, unidades, repuestos en el mínimo y agotados (sin contar los dados de baja)', async () => {
      await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'A-1', costo: 1000, stockActual: 10, stockMinimo: 3 }));
      await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'A-2', costo: 500.5, stockActual: 3, stockMinimo: 3 }));
      await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'A-3', costo: 9000, stockActual: 0, stockMinimo: 1 }));
      const { body: retirado } = await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'A-4', costo: 99999, stockActual: 50 }));
      await dueno.delete(`/api/repuestos/${retirado.id}`);

      const { body } = await dueno.get('/api/panel/resumen');

      expect(body.inventario).toEqual({ repuestos: 3, unidades: 13, valor: 11502, bajoMinimo: 2, agotados: 1 });
    });

    test('órdenes por semana: cuenta las creadas y las finalizadas en su semana, y deja en cero las demás', async () => {
      await ordenHistorica({ creada: '2026-10-13 09:00:00', cerrada: '2026-10-13 17:00:00' });
      await ordenHistorica({ creada: '2026-09-30 09:00:00', cerrada: '2026-10-06 10:00:00', placa: 'DEF456' });
      await ordenHistorica({ creada: '2026-10-05 09:00:00', placa: 'GHI789' });
      // Demasiado antigua para las 8 semanas del gráfico.
      await ordenHistorica({ creada: '2026-07-01 09:00:00', cerrada: '2026-07-02 09:00:00', placa: 'JKL012' });

      const { body } = await dueno.get('/api/panel/resumen');

      const porSemana = Object.fromEntries(body.ordenesPorSemana.map((s) => [s.semana, [s.creadas, s.finalizadas]]));
      expect(porSemana['2026-10-12']).toEqual([1, 1]);
      expect(porSemana['2026-10-05']).toEqual([1, 1]);
      expect(porSemana['2026-09-28']).toEqual([1, 0]);
      expect(porSemana['2026-09-21']).toEqual([0, 0]);
      expect(body.ordenes).toEqual({ enProceso: 1, finalizadas: 3, canceladas: 0, finalizadasUltimos30Dias: 2 });
    });

    test('una orden reabierta y vuelta a cerrar cuenta una sola vez, en la fecha del cierre definitivo', async () => {
      const orden = await ordenHistorica({ creada: '2026-09-29 09:00:00', cerrada: '2026-09-30 09:00:00' });
      await dueno.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'EN_PROCESO', motivo: 'Garantía' });
      await dueno.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'FINALIZADA' });
      const cierres = ctx.db.prepare("SELECT id FROM historial_estados_orden WHERE orden_id = ? AND estado_nuevo = 'FINALIZADA' ORDER BY id").all(orden.id);
      ctx.db.prepare('UPDATE historial_estados_orden SET fecha = ? WHERE id = ?').run('2026-10-13 12:00:00', cierres[1].id);

      const { body } = await dueno.get('/api/panel/resumen');

      const finalizadas = Object.fromEntries(body.ordenesPorSemana.map((s) => [s.semana, s.finalizadas]));
      expect(finalizadas['2026-09-28']).toBe(0);
      expect(finalizadas['2026-10-12']).toBe(1);
    });

    test('costo de repuestos por mes y repuestos más usados: no cuentan los devueltos por órdenes canceladas', async () => {
      const { body: filtro } = await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'FIL-1', nombre: 'Filtro', costo: 20000, stockActual: 50 }));
      const { body: bujia } = await dueno.post('/api/repuestos').send(repuestoValido({ sku: 'BUJ-1', nombre: 'Bujía', costo: 10000, stockActual: 50 }));
      await ordenHistorica({ creada: '2026-10-02 09:00:00', items: [{ repuestoId: filtro.id, cantidad: 2 }, { repuestoId: bujia.id, cantidad: 4 }] });
      await ordenHistorica({ creada: '2026-09-10 09:00:00', items: [{ repuestoId: bujia.id, cantidad: 3 }], placa: 'DEF456' });
      const cancelada = await ordenHistorica({ creada: '2026-10-03 09:00:00', items: [{ repuestoId: filtro.id, cantidad: 9 }], placa: 'GHI789' });
      await mecanico.patch(`/api/ordenes/${cancelada.id}/estado`).send({ estado: 'CANCELADA', motivo: 'El cliente desistió' });

      const { body } = await dueno.get('/api/panel/resumen');

      const gasto = Object.fromEntries(body.gastoPorMes.map((m) => [m.mes, [m.valor, m.unidades]]));
      expect(gasto['2026-10']).toEqual([80000, 6]);
      expect(gasto['2026-09']).toEqual([30000, 3]);
      expect(gasto['2026-08']).toEqual([0, 0]);
      expect(body.repuestosMasUsados).toEqual([
        { id: bujia.id, sku: 'BUJ-1', nombre: 'Bujía', unidades: 7, valor: 70000 },
        { id: filtro.id, sku: 'FIL-1', nombre: 'Filtro', unidades: 2, valor: 40000 },
      ]);
    });

    test('trabajo por mecánico: órdenes abiertas, cerradas en 30 días y tiempo medio de cierre en horas', async () => {
      const felipe = ctx.como('mecanico', 'felipe');
      await ordenHistorica({ creada: '2026-10-12 08:00:00', cerrada: '2026-10-12 12:00:00' });
      await ordenHistorica({ creada: '2026-10-10 08:00:00', cerrada: '2026-10-11 08:00:00', placa: 'DEF456' });
      await ordenHistorica({ creada: '2026-10-13 08:00:00', placa: 'GHI789' });
      await ordenHistorica({ cliente: felipe, creada: '2026-08-01 08:00:00', cerrada: '2026-08-02 08:00:00', placa: 'JKL012' });

      const { body } = await dueno.get('/api/panel/resumen');

      const porNombre = Object.fromEntries(body.mecanicos.map((m) => [m.nombre, m]));
      expect(porNombre['Mecánico de Prueba']).toMatchObject({ enProceso: 1, finalizadas: 2, horasPromedio: 14, activo: true });
      // Su única orden se cerró hace más de 30 días: no entra en el periodo.
      expect(porNombre['Mecánico de Prueba (felipe)']).toMatchObject({ enProceso: 0, finalizadas: 0, horasPromedio: null });
    });

    test('un mecánico inactivo solo aparece si todavía tiene órdenes en proceso', async () => {
      const inactivo = ctx.servicios.auth.crearUsuario({ usuario: 'viejo', nombre: 'Mecánico Retirado', rol: 'mecanico', password: 'clave-solo-para-pruebas' });
      ctx.db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(inactivo.id);

      expect((await dueno.get('/api/panel/resumen')).body.mecanicos.map((m) => m.nombre)).toEqual(['Mecánico de Prueba']);

      ctx.db.prepare(`
        INSERT INTO clientes (documento, nombre, telefono) VALUES ('1', 'Cliente', '3000000000');
      `).run();
      ctx.db.prepare("INSERT INTO vehiculos (placa, marca, modelo, cliente_id) VALUES ('ZZZ999', 'Kia', 'Rio', 1)").run();
      ctx.db.prepare("INSERT INTO ordenes (cliente_id, vehiculo_id, mecanico_id, creado_por, descripcion) VALUES (1, 1, ?, ?, 'Pendiente')").run(inactivo.id, inactivo.id);

      const conTrabajo = (await dueno.get('/api/panel/resumen')).body.mecanicos.find((m) => m.id === inactivo.id);
      expect(conTrabajo).toMatchObject({ activo: false, enProceso: 1 });
    });
  });

  describe('PATCH /api/ordenes/:id/mecanico (reasignar)', () => {
    let orden;
    let felipe;

    beforeEach(async () => {
      orden = (await mecanico.post('/api/ordenes').send(ordenValida())).body;
      felipe = ctx.usuario('mecanico', 'felipe');
    });

    const reasignar = (cliente, mecanicoId, id = orden.id) => cliente.patch(`/api/ordenes/${id}/mecanico`).send({ mecanicoId });

    test('el dueño pasa la orden a otro mecánico: el nuevo la ve, el anterior ya no, y queda en la auditoría', async () => {
      const res = await reasignar(dueno, felipe.id);

      expect(res.status).toBe(200);
      expect(res.body.mecanico).toEqual({ id: felipe.id, nombre: felipe.nombre });
      expect((await ctx.como('mecanico', 'felipe').get(`/api/ordenes/${orden.id}`)).status).toBe(200);
      expect((await mecanico.get(`/api/ordenes/${orden.id}`)).status).toBe(403);
      expect(ctx.db.prepare("SELECT usuario_id, entidad_id, detalle FROM auditoria WHERE accion = 'ORDEN_REASIGNADA'").get()).toEqual({
        usuario_id: ctx.usuario('dueno').id, entidad_id: orden.id, detalle: 'De Mecánico de Prueba a Mecánico de Prueba (felipe)',
      });
    });

    test('el administrador también puede; el mecánico y la recepcionista no (403)', async () => {
      expect((await reasignar(mecanico, felipe.id)).status).toBe(403);
      expect((await reasignar(ctx.como('recepcionista'), felipe.id)).status).toBe(403);
      expect((await reasignar(ctx.como('administrador'), felipe.id)).status).toBe(200);
    });

    test('el destino debe ser un mecánico activo distinto del actual', async () => {
      const inactivo = ctx.usuario('mecanico', 'retirado');
      ctx.db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(inactivo.id);

      expect((await reasignar(dueno, ctx.usuario('recepcionista').id)).status).toBe(400);
      expect((await reasignar(dueno, inactivo.id)).status).toBe(400);
      expect((await reasignar(dueno, 9999)).status).toBe(400);
      expect((await reasignar(dueno, 'abc')).status).toBe(400);
      expect((await dueno.patch(`/api/ordenes/${orden.id}/mecanico`)).status).toBe(400);
      const mismo = await reasignar(dueno, ctx.usuario('mecanico').id);
      expect(mismo.status).toBe(409);
      expect(mismo.body.mensaje).toBe(`La orden #${orden.id} ya está asignada a Mecánico de Prueba`);
    });

    test('solo se reasignan órdenes en proceso (409) y existentes (404)', async () => {
      await mecanico.patch(`/api/ordenes/${orden.id}/estado`).send({ estado: 'FINALIZADA' });

      expect((await reasignar(dueno, felipe.id)).status).toBe(409);
      expect((await reasignar(dueno, felipe.id, 999)).status).toBe(404);
    });

    test('reasignar las órdenes permite desactivar al mecánico que las tenía', async () => {
      const admin = ctx.como('administrador');
      const { id } = ctx.usuario('mecanico');
      expect((await admin.patch(`/api/usuarios/${id}/estado`).send({ activo: false })).status).toBe(409);

      await reasignar(admin, felipe.id);

      expect((await admin.patch(`/api/usuarios/${id}/estado`).send({ activo: false })).status).toBe(200);
    });
  });

  describe('POST /api/repuestos/:id/entradas (entrada de mercancía)', () => {
    let filtro;

    beforeEach(async () => {
      filtro = (await dueno.post('/api/repuestos').send(repuestoValido({ stockActual: 2, stockMinimo: 5 }))).body;
    });

    test('suma las unidades, registra el movimiento ENTRADA con su detalle y lo deja en la auditoría', async () => {
      const res = await dueno.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 24, detalle: 'Factura 4471 de Autopartes del Valle' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ stockActual: 26, bajoStock: false });
      const [movimiento] = (await dueno.get(`/api/repuestos/${filtro.id}/movimientos`)).body;
      expect(movimiento).toMatchObject({ tipo: 'ENTRADA', cantidad: 24, stockResultante: 26, detalle: 'Factura 4471 de Autopartes del Valle' });
      expect(ctx.db.prepare("SELECT detalle FROM auditoria WHERE accion = 'REPUESTO_ENTRADA'").get().detalle).toBe('FIL-ACE-001: +24 (de 2 a 26)');
    });

    test('sin detalle usa un texto por defecto', async () => {
      await ctx.como('administrador').post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 1 });

      expect((await dueno.get(`/api/repuestos/${filtro.id}/movimientos`)).body[0].detalle).toBe('Entrada de mercancía');
    });

    test('valida la cantidad (400), el permiso (403) y que el repuesto exista (404)', async () => {
      const invalida = await dueno.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: -3 });

      expect(invalida.status).toBe(400);
      expect(invalida.body.detalles).toEqual([{ campo: 'cantidad', mensaje: 'La cantidad debe ser un número entero mayor que cero' }]);
      expect((await mecanico.post(`/api/repuestos/${filtro.id}/entradas`).send({ cantidad: 5 })).status).toBe(403);
      expect((await dueno.post('/api/repuestos/999/entradas').send({ cantidad: 5 })).status).toBe(404);
      expect(ctx.db.prepare('SELECT stock_actual FROM repuestos WHERE id = ?').get(filtro.id).stock_actual).toBe(2);
    });
  });
});
