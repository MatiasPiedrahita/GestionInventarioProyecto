const express = require('express');
const { leerId } = require('../ordenes/orden.routes');

/** Endpoints de la predicción de demanda (dueño y administrador; el permiso lo aplica app.js). */
function crearRutasPrediccion(servicio) {
  const router = express.Router();

  // 202: la ejecución quedó aceptada y sigue calculando; el cliente consulta /estado hasta que termine.
  router.post('/ejecuciones', (req, res) => {
    const ejecucion = servicio.iniciar({ usuario: req.usuario, origen: 'MANUAL', parametros: req.body });
    res.status(202).location(`/api/prediccion/ejecuciones/${ejecucion.id}`).json(ejecucion);
  });

  router.get('/ejecuciones', (req, res) => {
    res.json(servicio.ejecuciones());
  });

  router.get('/ejecuciones/:id', (req, res) => {
    res.json(servicio.ejecucion(leerId(req)));
  });

  router.get('/estado', (req, res) => {
    res.json(servicio.estado());
  });

  router.get('/resumen', (req, res) => {
    res.json(servicio.resumen());
  });

  router.get('/reportes', (req, res) => {
    res.json(servicio.reportes());
  });

  router.get('/reportes/compras.csv', (req, res) => {
    const { nombre, contenido } = servicio.comprasCsv();
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  });

  router.get('/repuestos/:id', (req, res) => {
    res.json(servicio.detalle(leerId(req)));
  });

  return router;
}

module.exports = { crearRutasPrediccion };
