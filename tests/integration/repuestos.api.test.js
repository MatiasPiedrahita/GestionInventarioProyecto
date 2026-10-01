const request = require('supertest');
const { crearApp } = require('../../src/app');
const { crearConexion } = require('../../src/db/connection');

const filtro = {
  sku: 'FIL-ACE-001',
  nombre: 'Filtro de aceite Mann W712',
  costo: 28500,
  stockActual: 14,
  stockMinimo: 5,
  proveedor: 'Autopartes del Valle',
  ubicacion: 'Estante A1',
};

const pastillas = {
  sku: 'PAS-DEL-003',
  nombre: 'Pastillas de freno delanteras',
  costo: 96000,
  stockActual: 3,
  stockMinimo: 4,
  proveedor: 'Frenos y Partes SAS',
};

describe('API /api/repuestos (integración: HTTP + lógica + base de datos)', () => {
  let app;

  beforeEach(() => {
    app = crearApp({ db: crearConexion(':memory:') });
  });

  test('GET /api/salud responde ok', async () => {
    const res = await request(app).get('/api/salud');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: 'ok' });
  });

  test('POST crea el repuesto, responde 201 con Location y registra el movimiento de ALTA', async () => {
    const res = await request(app).post('/api/repuestos').send(filtro);

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/repuestos/${res.body.id}`);
    expect(res.body).toMatchObject({ ...filtro, activo: true, bajoStock: false });

    const historial = await request(app).get(`/api/repuestos/${res.body.id}/movimientos`);
    expect(historial.body).toHaveLength(1);
    expect(historial.body[0]).toMatchObject({ tipo: 'ALTA', cantidad: 14, stockResultante: 14 });
  });

  test('POST con un SKU repetido responde 409 (el SKU es único)', async () => {
    await request(app).post('/api/repuestos').send(filtro);
    const res = await request(app).post('/api/repuestos').send({ ...filtro, sku: 'fil-ace-001' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CONFLICTO');
  });

  test('GET lista ordenado por nombre, filtra por texto y por stock bajo', async () => {
    await request(app).post('/api/repuestos').send(filtro);
    await request(app).post('/api/repuestos').send(pastillas);

    const todos = await request(app).get('/api/repuestos');
    expect(todos.body.map((r) => r.sku)).toEqual(['FIL-ACE-001', 'PAS-DEL-003']);

    const porTexto = await request(app).get('/api/repuestos').query({ q: 'freno' });
    expect(porTexto.body.map((r) => r.sku)).toEqual(['PAS-DEL-003']);

    const bajos = await request(app).get('/api/repuestos').query({ bajoStock: 'true' });
    expect(bajos.body.map((r) => r.sku)).toEqual(['PAS-DEL-003']);
    expect(bajos.body[0].bajoStock).toBe(true);
  });

  test('PUT edita el repuesto y registra un AJUSTE con la diferencia de stock', async () => {
    const { body: creado } = await request(app).post('/api/repuestos').send(filtro);

    const res = await request(app).put(`/api/repuestos/${creado.id}`).send({ ...filtro, costo: 30000, stockActual: 20 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ costo: 30000, stockActual: 20 });
    const historial = await request(app).get(`/api/repuestos/${creado.id}/movimientos`);
    expect(historial.body[0]).toMatchObject({ tipo: 'AJUSTE', cantidad: 6, stockResultante: 20 });
  });

  test('DELETE da de baja (204): desaparece del catálogo pero su historial se conserva en la base', async () => {
    const db = crearConexion(':memory:');
    app = crearApp({ db });
    const { body: creado } = await request(app).post('/api/repuestos').send(filtro);

    const res = await request(app).delete(`/api/repuestos/${creado.id}`);

    expect(res.status).toBe(204);
    expect((await request(app).get(`/api/repuestos/${creado.id}`)).status).toBe(404);
    expect((await request(app).get('/api/repuestos')).body).toHaveLength(0);
    const tipos = db.prepare('SELECT tipo FROM movimientos_inventario WHERE repuesto_id = ? ORDER BY id').all(creado.id);
    expect(tipos.map((t) => t.tipo)).toEqual(['ALTA', 'BAJA']);
  });

  test('responde 404 para ids inexistentes y 400 para ids inválidos', async () => {
    expect((await request(app).get('/api/repuestos/999')).status).toBe(404);
    expect((await request(app).put('/api/repuestos/999').send(filtro)).status).toBe(404);
    expect((await request(app).delete('/api/repuestos/999')).status).toBe(404);
    expect((await request(app).get('/api/repuestos/abc')).status).toBe(400);
  });

  test('responde 400 con un mensaje claro si el cuerpo no es JSON válido', async () => {
    const res = await request(app)
      .post('/api/repuestos')
      .set('Content-Type', 'application/json')
      .send('{"sku": "A1",');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('JSON_INVALIDO');
  });

  describe('POST /api/repuestos/importar (carga masiva por CSV)', () => {
    test('importa todas las filas válidas y registra un movimiento CARGA_CSV por cada una', async () => {
      const csv = 'sku;nombre;costo;stock_actual;stock_minimo\nA-1;Tornillo;500;100;20\nA-2;Arandela;200;50;10\n';

      const res = await request(app).post('/api/repuestos/importar').set('Content-Type', 'text/csv').send(csv);

      expect(res.status).toBe(201);
      expect(res.body.cantidad).toBe(2);
      const historial = await request(app).get(`/api/repuestos/${res.body.creados[0].id}/movimientos`);
      expect(historial.body[0].tipo).toBe('CARGA_CSV');
    });

    test('es "todo o nada": si una fila tiene stock negativo no se guarda ninguna y se indica la fila', async () => {
      const csv = 'sku,nombre,costo,stockActual\nA-1,Tornillo,500,100\nA-2,Arandela,200,-4\nA-1,Tornillo repetido,500,1\n';

      const res = await request(app).post('/api/repuestos/importar').set('Content-Type', 'text/csv').send(csv);

      expect(res.status).toBe(400);
      expect(res.body.detalles).toEqual([
        { fila: 3, campo: 'stockActual', mensaje: 'El stock actual no puede ser negativo' },
        { fila: 4, campo: 'sku', mensaje: 'SKU A-1 repetido dentro del archivo' },
      ]);
      expect((await request(app).get('/api/repuestos')).body).toHaveLength(0);
    });

    test('rechaza un CSV vacío o sin filas de datos', async () => {
      const vacio = await request(app).post('/api/repuestos/importar').set('Content-Type', 'text/csv').send('');
      const soloEncabezado = await request(app).post('/api/repuestos/importar').set('Content-Type', 'text/csv').send('sku,nombre\n');

      expect(vacio.status).toBe(400);
      expect(soloEncabezado.status).toBe(400);
    });
  });
});
