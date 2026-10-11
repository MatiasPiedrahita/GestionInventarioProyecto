const express = require('express');
const { leerId } = require('../ordenes/orden.routes');

/** Endpoints de las notificaciones del usuario de la sesión: cada quien ve y marca solo las suyas. */
function crearRutasNotificaciones(servicio) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(servicio.listar(req.usuario, req.query));
  });

  router.get('/resumen', (req, res) => {
    res.json(servicio.resumen(req.usuario));
  });

  router.get('/preferencias', (req, res) => {
    res.json(servicio.preferencias(req.usuario));
  });

  router.put('/preferencias', (req, res) => {
    res.json(servicio.guardarPreferencias(req.usuario, req.body));
  });

  router.post('/leer-todas', (req, res) => {
    res.json(servicio.marcarTodasLeidas(req.usuario));
  });

  router.patch('/:id/leida', (req, res) => {
    res.json(servicio.marcarLeida(leerId(req), req.usuario));
  });

  return router;
}

module.exports = { crearRutasNotificaciones };
