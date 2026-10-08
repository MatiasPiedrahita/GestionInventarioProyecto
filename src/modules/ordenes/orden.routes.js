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
 * Endpoints de órdenes de trabajo.
 * @param {object} servicio Servicio de órdenes.
 * @param {{ puedenCrear: Function, puedenTrabajar: Function }} permisos Middlewares de autorización por rol.
 */
function crearRutasOrdenes(servicio, { puedenCrear, puedenTrabajar }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(servicio.listar(req.usuario));
  });

  router.post('/', puedenCrear, (req, res) => {
    const orden = servicio.crear(req.body, req.usuario);
    res.status(201).location(`/api/ordenes/${orden.id}`).json(orden);
  });

  router.get('/:id', (req, res) => {
    res.json(servicio.obtener(leerId(req), req.usuario));
  });

  router.post('/:id/repuestos', puedenTrabajar, (req, res) => {
    res.status(201).json(servicio.registrarRepuestos(leerId(req), req.body, req.usuario));
  });

  return router;
}

module.exports = { crearRutasOrdenes, leerId };
