const express = require('express');
const { NOMBRE_ROL, VISTA_INICIAL } = require('./roles');

function conNombreDeRol(usuario) {
  return { ...usuario, nombreRol: NOMBRE_ROL[usuario.rol] };
}

/** Rutas públicas de autenticación (login) y de la sesión actual. */
function crearRutasAuth(servicioAuth, autenticar) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const { usuario, password } = req.body || {};
    const sesion = servicioAuth.iniciarSesion(usuario, password);
    res.json({ ...sesion, usuario: conNombreDeRol(sesion.usuario) });
  });

  router.post('/logout', autenticar, (req, res) => {
    servicioAuth.cerrarSesion(req.token);
    res.status(204).end();
  });

  router.get('/yo', autenticar, (req, res) => {
    res.json({ usuario: conNombreDeRol(req.usuario), vistaInicial: VISTA_INICIAL[req.usuario.rol] });
  });

  return router;
}

module.exports = { crearRutasAuth };
