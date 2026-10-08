const path = require('node:path');
const express = require('express');
const { crearConexion } = require('./db/connection');
const { crearRepositorioRepuestos } = require('./modules/inventario/repuesto.repository');
const { crearServicioInventario } = require('./modules/inventario/repuesto.service');
const { crearRutasInventario } = require('./modules/inventario/repuesto.routes');
const { crearRepositorioUsuarios } = require('./modules/auth/usuario.repository');
const { crearServicioAuth } = require('./modules/auth/auth.service');
const { crearAutenticacion, autorizar } = require('./modules/auth/auth.middleware');
const { crearRutasAuth } = require('./modules/auth/auth.routes');
const { ROLES } = require('./modules/auth/roles');
const { manejadorDeErrores } = require('./shared/errorHandler');

/**
 * Construye la aplicación. Recibe sus dependencias por parámetro para que
 * las pruebas usen una base en memoria, aislada y desechable.
 *
 * @param {{ db?: import('node:sqlite').DatabaseSync, ahora?: () => Date }} opciones
 */
function crearApp({ db = crearConexion(':memory:'), ahora } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // --- Composición de módulos (capas) ---------------------------------------
  const servicioAuth = crearServicioAuth(crearRepositorioUsuarios(db), { ahora });
  const servicioInventario = crearServicioInventario(crearRepositorioRepuestos(db));

  const autenticar = crearAutenticacion(servicioAuth);
  const gestionInventario = autorizar(ROLES.DUENO, ROLES.ADMINISTRADOR);

  // --- Rutas públicas ---------------------------------------------------------
  app.get('/api/salud', (req, res) => res.json({ estado: 'ok' }));
  app.use('/api/auth', crearRutasAuth(servicioAuth, autenticar));

  // --- Rutas protegidas: todo lo demás exige sesión ----------------------------
  app.use('/api', autenticar);
  app.use('/api/repuestos', crearRutasInventario(servicioInventario, { soloGestion: gestionInventario }));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'RUTA_NO_ENCONTRADA', mensaje: `No existe ${req.method} ${req.originalUrl}`, detalles: [] });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(manejadorDeErrores);

  return { app, servicios: { auth: servicioAuth, inventario: servicioInventario } };
}

module.exports = { crearApp };
