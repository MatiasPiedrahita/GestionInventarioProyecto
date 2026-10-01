const express = require('express');
const { ErrorDeValidacion } = require('../../shared/errors');

function leerId(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ErrorDeValidacion([{ campo: 'id', mensaje: 'El id debe ser un entero positivo' }]);
  }
  return id;
}

/**
 * Endpoints REST de la HU-01. El controlador solo traduce HTTP <-> servicio;
 * no contiene reglas de negocio.
 */
function crearRutasInventario(servicio) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const busqueda = typeof req.query.q === 'string' && req.query.q.trim() !== '' ? req.query.q.trim() : null;
    const soloBajoStock = req.query.bajoStock === 'true';
    res.json(servicio.listar({ busqueda, soloBajoStock }));
  });

  router.post('/importar', express.text({ type: ['text/csv', 'text/plain'], limit: '1mb' }), (req, res) => {
    const resultado = servicio.importarCsv(typeof req.body === 'string' ? req.body : '');
    res.status(201).json(resultado);
  });

  router.get('/:id', (req, res) => {
    res.json(servicio.obtener(leerId(req)));
  });

  router.get('/:id/movimientos', (req, res) => {
    res.json(servicio.historial(leerId(req)));
  });

  router.post('/', (req, res) => {
    const creado = servicio.crear(req.body);
    res.status(201).location(`/api/repuestos/${creado.id}`).json(creado);
  });

  router.put('/:id', (req, res) => {
    res.json(servicio.actualizar(leerId(req), req.body));
  });

  router.delete('/:id', (req, res) => {
    servicio.darDeBaja(leerId(req));
    res.status(204).end();
  });

  return router;
}

module.exports = { crearRutasInventario };
