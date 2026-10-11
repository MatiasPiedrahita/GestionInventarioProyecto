const express = require('express');
const { leerId } = require('../ordenes/orden.routes');

/**
 * Endpoints de administración de usuarios. Quién entra lo decide app.js
 * (dueño y administrador); a quién puede modificar cada uno, el servicio.
 */
function crearRutasUsuarios(servicio) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json({ usuarios: servicio.listar(req.usuario), rolesAsignables: servicio.rolesAsignables(req.usuario) });
  });

  router.post('/', (req, res) => {
    const creado = servicio.crear(req.body, req.usuario);
    res.status(201).json(creado);
  });

  router.put('/:id', (req, res) => {
    res.json(servicio.editar(leerId(req), req.body, req.usuario));
  });

  router.patch('/:id/estado', (req, res) => {
    res.json(servicio.cambiarActivo(leerId(req), req.body, req.usuario));
  });

  router.post('/:id/password', (req, res) => {
    res.json(servicio.restablecerPassword(leerId(req), req.usuario));
  });

  router.post('/:id/desbloqueo', (req, res) => {
    res.json(servicio.desbloquear(leerId(req), req.usuario));
  });

  router.delete('/:id/sesiones', (req, res) => {
    res.json(servicio.cerrarSesiones(leerId(req), req.usuario));
  });

  return router;
}

module.exports = { crearRutasUsuarios };
