const path = require('node:path');
const { crearApp } = require('./app');
const { crearConexion } = require('./db/connection');

const PUERTO = Number(process.env.PORT) || 3000;
const RUTA_DB = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'inventario.db');

const db = crearConexion(RUTA_DB);
const { app } = crearApp({ db });

const servidor = app.listen(PUERTO, () => {
  console.log(`Inventario del taller corriendo en http://localhost:${PUERTO}`);
  console.log(`Base de datos: ${RUTA_DB}`);
});

function cerrar() {
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
