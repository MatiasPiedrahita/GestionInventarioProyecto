const express = require('express');
const { NOMBRE_ROL, VISTA_INICIAL } = require('./roles');
const { ACCIONES } = require('../auditoria/acciones');
const { SIN_AUDITORIA } = require('../auditoria/auditoria.service');

function conNombreDeRol(usuario) {
  return { ...usuario, nombreRol: NOMBRE_ROL[usuario.rol] };
}

/** Rutas públicas de autenticación (login) y de la sesión actual. */
function crearRutasAuth(servicioAuth, autenticar, { auditoria = SIN_AUDITORIA } = {}) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const { usuario, password } = req.body || {};
    const sesion = servicioAuth.iniciarSesion(usuario, password, { ip: req.ip });
    res.json({ ...sesion, usuario: conNombreDeRol(sesion.usuario) });
  });

  router.post('/logout', autenticar, (req, res) => {
    servicioAuth.cerrarSesion(req.token);
    auditoria.registrar({ usuarioId: req.usuario.id, accion: ACCIONES.LOGOUT, ip: req.ip });
    res.status(204).end();
  });

  router.post('/logout-todas', autenticar, (req, res) => {
    servicioAuth.cerrarTodasLasSesiones(req.usuario);
    res.status(204).end();
  });

  router.post('/password', autenticar, (req, res) => {
    const usuario = servicioAuth.cambiarPassword(req.usuario, req.body, req.token);
    res.json({ usuario: conNombreDeRol(usuario) });
  });

  router.get('/yo', autenticar, (req, res) => {
    res.json({ usuario: conNombreDeRol(req.usuario), vistaInicial: VISTA_INICIAL[req.usuario.rol] });
  });

  return router;
}

module.exports = { crearRutasAuth };
