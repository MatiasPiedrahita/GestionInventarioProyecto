const { crearContexto } = require('../helpers/contexto');
const { ordenValida } = require('../helpers/datos');

/**
 * Escenario común: 5 órdenes con placas parecidas a propósito
 * (ABC123, ABC12D, ABC124), dos mecánicos y estados distintos.
 */
async function prepararTaller() {
  const ctx = crearContexto();
  const andres = ctx.como('mecanico', 'andres');
  const felipe = ctx.como('mecanico', 'felipe');
  const crear = (cliente, placa, documento, mecanico) => mecanico.post('/api/ordenes').send(ordenValida({
    cliente: { documento, nombre: cliente, telefono: '3001234567' },
    vehiculo: { placa, marca: 'Mazda', modelo: '2' },
  }));

  const o1 = (await crear('Camila Ortiz', 'ABC123', '1037000001', andres)).body;
  await crear('Juan Pérez', 'ABC12D', '1037000002', andres);
  await crear('Camilo Ruiz', 'ABC124', '1037000003', felipe);
  const o4 = (await crear('Camila Ortiz', 'ABC123', '1037000001', felipe)).body;
  const o5 = (await crear('Sara Gómez', 'XYZ987', '1037000005', felipe)).body;

  // Órdenes históricas de ejemplo (el cambio de estado desde la app es otra historia del sprint).
  ctx.db.prepare("UPDATE ordenes SET estado = 'FINALIZADA' WHERE id IN (?, ?)").run(o1.id, o5.id);
  ctx.db.prepare("UPDATE ordenes SET estado = 'CANCELADA' WHERE id = ?").run(o4.id);

  return { ctx, andres, felipe, recepcion: ctx.como('recepcionista') };
}

const placas = (res) => res.body.datos.map((o) => o.vehiculo.placa);

describe('API GET /api/ordenes con filtros y paginación (integración)', () => {
  test('sin filtros devuelve todas, de la más reciente a la más antigua, con datos de paginación', async () => {
    const { recepcion } = await prepararTaller();
    const res = await recepcion.get('/api/ordenes');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pagina: 1, tamano: 10, total: 5, totalPaginas: 1 });
    expect(placas(res)).toEqual(['XYZ987', 'ABC123', 'ABC124', 'ABC12D', 'ABC123']);
  });

  test('placa: coincidencia exacta, aunque se escriba en minúsculas o con guion', async () => {
    const { recepcion } = await prepararTaller();
    const res = await recepcion.get('/api/ordenes').query({ placa: 'abc-123' });

    expect(placas(res)).toEqual(['ABC123', 'ABC123']);
  });

  test('cliente: búsqueda parcial por nombre o exacta por documento', async () => {
    const { recepcion } = await prepararTaller();

    const porNombre = await recepcion.get('/api/ordenes').query({ cliente: 'camil' });
    const porDocumento = await recepcion.get('/api/ordenes').query({ cliente: '1037000002' });

    expect(porNombre.body.datos.map((o) => o.cliente.nombre).sort()).toEqual(['Camila Ortiz', 'Camila Ortiz', 'Camilo Ruiz']);
    expect(placas(porDocumento)).toEqual(['ABC12D']);
  });

  test('mecánico y estado (activas, históricas o uno puntual)', async () => {
    const { ctx, recepcion } = await prepararTaller();
    const felipe = ctx.usuario('mecanico', 'felipe');

    const deFelipe = await recepcion.get('/api/ordenes').query({ mecanicoId: felipe.id });
    const activas = await recepcion.get('/api/ordenes').query({ estado: 'ACTIVAS' });
    const historicas = await recepcion.get('/api/ordenes').query({ estado: 'HISTORICAS' });
    const canceladas = await recepcion.get('/api/ordenes').query({ estado: 'CANCELADA' });

    expect(deFelipe.body.total).toBe(3);
    expect(activas.body.datos.every((o) => o.estado === 'EN_PROCESO')).toBe(true);
    expect(activas.body.total).toBe(2);
    expect(historicas.body.total).toBe(3);
    expect(canceladas.body.datos.map((o) => o.estadoNombre)).toEqual(['Cancelada']);
  });

  test('los filtros se combinan (Y lógico)', async () => {
    const { recepcion } = await prepararTaller();
    const res = await recepcion.get('/api/ordenes').query({ placa: 'ABC123', estado: 'HISTORICAS' });

    expect(res.body.total).toBe(2);
    expect(res.body.datos.map((o) => o.estado).sort()).toEqual(['CANCELADA', 'FINALIZADA']);
  });

  test('paginación: tamaño 2 reparte 5 órdenes en 3 páginas sin repetir ninguna', async () => {
    const { recepcion } = await prepararTaller();
    const paginas = await Promise.all([1, 2, 3].map((pagina) => recepcion.get('/api/ordenes').query({ tamano: 2, pagina })));

    expect(paginas.map((p) => p.body.datos.length)).toEqual([2, 2, 1]);
    expect(paginas[0].body).toMatchObject({ total: 5, totalPaginas: 3 });
    const ids = paginas.flatMap((p) => p.body.datos.map((o) => o.id));
    expect(new Set(ids).size).toBe(5);
  });

  test('el mecánico solo ve sus órdenes aunque pida las de otro', async () => {
    const { ctx, andres } = await prepararTaller();
    const felipe = ctx.usuario('mecanico', 'felipe');

    const res = await andres.get('/api/ordenes').query({ mecanicoId: felipe.id });

    expect(res.body.total).toBe(2);
    expect(res.body.datos.every((o) => o.mecanico.id === ctx.usuario('mecanico', 'andres').id)).toBe(true);
  });

  test('parámetros inválidos responden 400', async () => {
    const { recepcion } = await prepararTaller();
    const res = await recepcion.get('/api/ordenes').query({ estado: 'PERDIDA', tamano: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.detalles.map((d) => d.campo)).toEqual(['estado', 'tamano']);
  });

  test('la base de datos usa índices para filtrar por placa, estado y mecánico (no recorre toda la tabla)', () => {
    const { db } = crearContexto();
    const base = 'SELECT o.id FROM ordenes o JOIN clientes c ON c.id = o.cliente_id JOIN vehiculos v ON v.id = o.vehiculo_id';
    const plan = (sql, p) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(p).map((r) => r.detail).join(' | ');

    expect(plan(`${base} WHERE v.placa = @placa`, { placa: 'ABC123' })).toMatch(/USING (COVERING )?INDEX sqlite_autoindex_vehiculos/);
    expect(plan(`${base} WHERE o.estado = @estado ORDER BY o.id DESC`, { estado: 'EN_PROCESO' })).toMatch(/USING INDEX idx_ordenes_estado/);
    expect(plan(`${base} WHERE o.mecanico_id = @m ORDER BY o.id DESC`, { m: 1 })).toMatch(/USING INDEX idx_ordenes_mecanico/);
  });
});
