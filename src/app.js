const path = require('node:path');
const express = require('express');
const { crearConexion } = require('./db/connection');
const { crearRepositorioRepuestos } = require('./modules/inventario/repuesto.repository');
const { crearServicioInventario } = require('./modules/inventario/repuesto.service');
const { crearRutasInventario } = require('./modules/inventario/repuesto.routes');
const { manejadorDeErrores } = require('./shared/errorHandler');

/**
 * Construye la aplicación. Recibe la conexión por parámetro para que las
 * pruebas usen una base en memoria, aislada y desechable.
 * @param {{ db?: import('node:sqlite').DatabaseSync }} opciones
 */
function crearApp({ db = crearConexion(':memory:') } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  const repositorio = crearRepositorioRepuestos(db);
  const servicio = crearServicioInventario(repositorio);

  app.get('/api/salud', (req, res) => res.json({ estado: 'ok' }));
  app.use('/api/repuestos', crearRutasInventario(servicio));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'RUTA_NO_ENCONTRADA', mensaje: `No existe ${req.method} ${req.originalUrl}`, detalles: [] });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(manejadorDeErrores);

  return app;
}

module.exports = { crearApp };
