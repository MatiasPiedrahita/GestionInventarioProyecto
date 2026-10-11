const express = require('express');
const { leerId } = require('../ordenes/orden.routes');

/** Endpoints del directorio de clientes. Los permisos por rol los aplica app.js. */
function crearRutasClientes(servicio) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(servicio.listar(req.query));
  });

  router.get('/:id', (req, res) => {
    res.json(servicio.obtener(leerId(req)));
  });

  router.put('/:id', (req, res) => {
    res.json(servicio.actualizarContacto(leerId(req), req.body, req.usuario));
  });

  return router;
}

module.exports = { crearRutasClientes };
