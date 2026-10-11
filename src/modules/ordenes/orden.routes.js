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
 * @param {{ puedenCrear: Function, puedenTrabajar: Function, puedenReasignar: Function }} permisos Middlewares de autorización por rol.
 */
function crearRutasOrdenes(servicio, { puedenCrear, puedenTrabajar, puedenReasignar, soloMecanicos }) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(servicio.listar(req.query, req.usuario));
  });

  router.post('/', puedenCrear, (req, res) => {
    const orden = servicio.crear(req.body, req.usuario);
    res.status(201).location(`/api/ordenes/${orden.id}`).json(orden);
  });

  // Va antes de "/:id" para que "mi-resumen" no se tome como un id.
  router.get('/mi-resumen', soloMecanicos, (req, res) => {
    res.json(servicio.resumenPropio(req.usuario));
  });

  router.get('/:id', (req, res) => {
    res.json(servicio.obtener(leerId(req), req.usuario));
  });

  router.post('/:id/repuestos', puedenTrabajar, (req, res) => {
    res.status(201).json(servicio.registrarRepuestos(leerId(req), req.body, req.usuario));
  });

  router.patch('/:id/notas', puedenTrabajar, (req, res) => {
    res.json(servicio.actualizarNotas(leerId(req), req.body, req.usuario));
  });

  router.patch('/:id/estado', puedenTrabajar, (req, res) => {
    res.json(servicio.cambiarEstado(leerId(req), req.body, req.usuario));
  });

  router.patch('/:id/mecanico', puedenReasignar, (req, res) => {
    res.json(servicio.reasignarMecanico(leerId(req), req.body, req.usuario));
  });

  router.get('/:id/historial', (req, res) => {
    res.json(servicio.historialDeEstados(leerId(req), req.usuario));
  });

  return router;
}

module.exports = { crearRutasOrdenes, leerId };
