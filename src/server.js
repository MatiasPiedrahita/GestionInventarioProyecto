const path = require('node:path');
const { crearApp } = require('./app');
const { crearConexion } = require('./db/connection');
const { crearProgramador } = require('./tareas/programador');

const PUERTO = Number(process.env.PORT) || 3000;
const RUTA_DB = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'inventario.db');

const db = crearConexion(RUTA_DB);
const { app, servicios } = crearApp({ db });

// Tarea programada: revisa todo el inventario cada cierto tiempo, por si algún
// cambio de stock no pasó por la aplicación (por ejemplo, una carga directa a la base).
const MINUTOS_ENTRE_REVISIONES = Math.max(1, Number(process.env.ALERTAS_INTERVALO_MIN) || 15);
const programador = crearProgramador();
programador.programar('Revisión de stock bajo', MINUTOS_ENTRE_REVISIONES, () => servicios.alertas.revisar(), { alIniciar: true });

// Tarea programada: cada pocos minutos pregunta si hay que recalcular la predicción de demanda.
// Solo ejecuta el modelo si la vigente ya venció (PREDICCION_INTERVALO_HORAS) o si el catálogo
// cambió (un repuesto nuevo, otro tiempo de reposición), y si Python está disponible.
const MINUTOS_ENTRE_COMPROBACIONES = 10;
programador.programar('Predicción de demanda', MINUTOS_ENTRE_COMPROBACIONES, () => servicios.prediccion.ejecutarSiHaceFalta(), { alIniciar: true });
servicios.sistema.registrarSeccion('tareas', () => programador.estado());

const servidor = app.listen(PUERTO, () => {
  console.log(`Inventario del taller corriendo en http://localhost:${PUERTO}`);
  console.log(`Base de datos: ${RUTA_DB}`);
});

function cerrar() {
  programador.detener();
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
