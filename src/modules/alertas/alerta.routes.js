const express = require('express');
const { leerId } = require('../ordenes/orden.routes');

/** Endpoints de las alertas de stock (dueño y administrador; el permiso lo aplica app.js). */
function crearRutasAlertas(servicio) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(servicio.listar(req.query));
  });

  // Revisión manual: hace lo mismo que la tarea programada, cuando el usuario lo pide.
  router.post('/revisar', (req, res) => {
    res.json(servicio.revisar());
  });

  router.patch('/:id/atender', (req, res) => {
    res.json(servicio.atender(leerId(req), req.body, req.usuario));
  });

  return router;
}

module.exports = { crearRutasAlertas };
