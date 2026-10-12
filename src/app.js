const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { crearConexion } = require('./db/connection');
const { crearRepositorioRepuestos } = require('./modules/inventario/repuesto.repository');
const { crearServicioInventario } = require('./modules/inventario/repuesto.service');
const { crearRutasInventario } = require('./modules/inventario/repuesto.routes');
const { crearRepositorioUsuarios } = require('./modules/auth/usuario.repository');
const { crearServicioAuth } = require('./modules/auth/auth.service');
const { crearAutenticacion, autorizar, exigirPasswordPropia } = require('./modules/auth/auth.middleware');
const { crearRutasAuth } = require('./modules/auth/auth.routes');
const { ROLES } = require('./modules/auth/roles');
const { crearRepositorioOrdenes } = require('./modules/ordenes/orden.repository');
const { crearServicioOrdenes } = require('./modules/ordenes/orden.service');
const { crearRutasOrdenes, leerId } = require('./modules/ordenes/orden.routes');
const { crearRepositorioAuditoria } = require('./modules/auditoria/auditoria.repository');
const { crearServicioAuditoria } = require('./modules/auditoria/auditoria.service');
const { crearServicioUsuarios } = require('./modules/usuarios/usuario.service');
const { crearRutasUsuarios } = require('./modules/usuarios/usuario.routes');
const { crearRepositorioSistema } = require('./modules/sistema/sistema.repository');
const { crearServicioSistema } = require('./modules/sistema/sistema.service');
const { crearRepositorioPanel } = require('./modules/panel/panel.repository');
const { crearServicioPanel } = require('./modules/panel/panel.service');
const { crearRepositorioClientes } = require('./modules/clientes/cliente.repository');
const { crearServicioClientes } = require('./modules/clientes/cliente.service');
const { crearRutasClientes } = require('./modules/clientes/cliente.routes');
const { crearTransporteDeCorreo } = require('./modules/notificaciones/correo');
const { crearRepositorioNotificaciones } = require('./modules/notificaciones/notificacion.repository');
const { crearServicioNotificaciones } = require('./modules/notificaciones/notificacion.service');
const { crearRutasNotificaciones } = require('./modules/notificaciones/notificacion.routes');
const { crearRepositorioAlertas } = require('./modules/alertas/alerta.repository');
const { crearServicioAlertas } = require('./modules/alertas/alerta.service');
const { crearRutasAlertas } = require('./modules/alertas/alerta.routes');
const { crearRepositorioConsumo } = require('./modules/prediccion/consumo.repository');
const { crearRepositorioPrediccion } = require('./modules/prediccion/prediccion.repository');
const { crearServicioPrediccion } = require('./modules/prediccion/prediccion.service');
const { crearRutasPrediccion } = require('./modules/prediccion/prediccion.routes');
const { crearMotorPython } = require('./modules/prediccion/motor-python');
const { manejadorDeErrores } = require('./shared/errorHandler');

/**
 * Cabeceras de seguridad. La política de contenido (CSP) solo deja cargar
 * scripts y estilos propios, más las fuentes de Google que usa la interfaz:
 * si alguien lograra inyectar HTML, el navegador no ejecutaría su script.
 */
const cabecerasDeSeguridad = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      // En el taller la aplicación suele abrirse por HTTP dentro de la red
      // local; forzar HTTPS dejaría la página sin scripts ni estilos.
      upgradeInsecureRequests: null,
    },
  },
});

/**
 * Construye la aplicación. Recibe sus dependencias por parámetro para que
 * las pruebas usen una base en memoria, aislada y desechable.
 *
 * @param {{ db?: import('node:sqlite').DatabaseSync, ahora?: () => Date, transporteDeCorreo?: object, urlDeLaAplicacion?: string,
 *           motorDePrediccion?: { predecir: Function, descripcion: string } }} opciones
 */
function crearApp({
  db = crearConexion(':memory:'),
  ahora,
  transporteDeCorreo = crearTransporteDeCorreo(),
  urlDeLaAplicacion = process.env.APP_URL || null,
  motorDePrediccion = crearMotorPython(),
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cabecerasDeSeguridad);
  app.use(express.json({ limit: '100kb' }));

  // --- Composición de módulos (capas) ---------------------------------------
  const servicioAuditoria = crearServicioAuditoria(crearRepositorioAuditoria(db));
  const repositorioUsuarios = crearRepositorioUsuarios(db);
  const servicioAuth = crearServicioAuth(repositorioUsuarios, { ahora, auditoria: servicioAuditoria });
  const servicioNotificaciones = crearServicioNotificaciones(crearRepositorioNotificaciones(db), { transporte: transporteDeCorreo });
  const servicioAlertas = crearServicioAlertas(crearRepositorioAlertas(db), {
    notificaciones: servicioNotificaciones,
    destinatarios: () => repositorioUsuarios.listarQuienesGestionan(),
    auditoria: servicioAuditoria,
    urlDeLaAplicacion,
    // La predicción se crea después: se consulta en el momento de listar, no al construir.
    sugerencias: () => servicioPrediccion.sugerencias(),
  });
  const servicioPrediccion = crearServicioPrediccion({
    consumo: crearRepositorioConsumo(db),
    repositorio: crearRepositorioPrediccion(db),
    motor: motorDePrediccion,
    alertas: servicioAlertas,
    auditoria: servicioAuditoria,
    ahora,
  });

  // Conexión entre módulos: inventario y órdenes avisan; alertas y notificaciones reaccionan.
  const eventos = {
    stockCambiado: (ids) => servicioAlertas.alCambiarStock(ids),
    ordenAsignada: (orden, quien) => servicioNotificaciones.enviar(
      [orden.mecanico],
      [{
        tipo: 'ORDEN_ASIGNADA',
        titulo: `Te asignaron la orden #${orden.id}`,
        mensaje: `${orden.vehiculo.placa} · ${orden.vehiculo.marca} ${orden.vehiculo.modelo}: ${orden.descripcion}`,
        vista: 'ordenes',
      }],
      () => ({
        asunto: `[Taller] Te asignaron la orden #${orden.id} (${orden.vehiculo.placa})`,
        cuerpo: [
          `Hola, ${orden.mecanico.nombre}:`,
          '',
          `${quien.nombre} te asignó la orden #${orden.id}.`,
          `Vehículo: ${orden.vehiculo.placa} · ${orden.vehiculo.marca} ${orden.vehiculo.modelo}`,
          `Problema: ${orden.descripcion}`,
        ].join('\n'),
      }),
    ),
  };

  const repositorioRepuestos = crearRepositorioRepuestos(db);
  const servicioInventario = crearServicioInventario(repositorioRepuestos, { auditoria: servicioAuditoria, eventos });
  const repositorioOrdenes = crearRepositorioOrdenes(db);
  const servicioOrdenes = crearServicioOrdenes(repositorioOrdenes, repositorioUsuarios, repositorioRepuestos, {
    auditoria: servicioAuditoria,
    eventos,
    ahora,
  });
  const servicioClientes = crearServicioClientes(crearRepositorioClientes(db), { auditoria: servicioAuditoria });
  const servicioUsuarios = crearServicioUsuarios(repositorioUsuarios, {
    auth: servicioAuth,
    ordenesEnProcesoDe: (mecanicoId) => repositorioOrdenes.contarEnProcesoDeMecanico(mecanicoId),
    auditoria: servicioAuditoria,
    ahora,
  });
  const servicioSistema = crearServicioSistema(crearRepositorioSistema(db), { ahora });
  const servicioPanel = crearServicioPanel(crearRepositorioPanel(db), { ahora });
  servicioSistema.registrarSeccion('correo', () => servicioNotificaciones.estadoDelCorreo());
  servicioSistema.registrarSeccion('alertas', () => servicioAlertas.conteo());
  servicioSistema.registrarSeccion('prediccion', () => servicioPrediccion.estadoParaElSistema());

  const autenticar = crearAutenticacion(servicioAuth);
  const gestionInventario = autorizar(ROLES.DUENO, ROLES.ADMINISTRADOR);
  // Panel de administración (usuarios, auditoría, sistema) y panel del dueño (indicadores, reasignar órdenes).
  const administracion = autorizar(ROLES.DUENO, ROLES.ADMINISTRADOR);
  // Trabajar en una orden (repuestos, notas, estado): mecánico, dueño y administrador.
  // El mecánico además solo toca SUS órdenes (lo valida el servicio).
  const trabajanEnOrdenes = autorizar(ROLES.MECANICO, ROLES.DUENO, ROLES.ADMINISTRADOR);
  // Crear órdenes: también la recepcionista, que recibe el vehículo y elige al mecánico.
  const creanOrdenes = autorizar(ROLES.MECANICO, ROLES.RECEPCIONISTA, ROLES.DUENO, ROLES.ADMINISTRADOR);
  // Directorio de clientes y vehículos: quien atiende al público. El mecánico no lo necesita.
  const atencionAlCliente = autorizar(ROLES.RECEPCIONISTA, ROLES.DUENO, ROLES.ADMINISTRADOR);

  // Las respuestas de la API llevan datos del taller: ni el navegador ni un proxy deben guardarlas.
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // --- Rutas públicas ---------------------------------------------------------
  app.get('/api/salud', (req, res) => res.json({ estado: 'ok' }));
  app.use('/api/auth', crearRutasAuth(servicioAuth, autenticar, { auditoria: servicioAuditoria }));

  // --- Rutas protegidas: todo lo demás exige sesión ----------------------------
  app.use('/api', autenticar, exigirPasswordPropia);
  app.use('/api/notificaciones', crearRutasNotificaciones(servicioNotificaciones));
  app.use('/api/alertas', gestionInventario, crearRutasAlertas(servicioAlertas));
  app.get('/api/correos', administracion, (req, res) => res.json(servicioNotificaciones.bandejaDeSalida()));
  // El mecánico avisa que un repuesto falta para un trabajo (va antes del enrutador de inventario).
  app.post('/api/repuestos/:id/faltantes', trabajanEnOrdenes, (req, res) => {
    res.status(201).json(servicioAlertas.reportarFaltante(leerId(req), req.body, req.usuario));
  });
  // Aplica como stock mínimo el punto de reorden que calculó la predicción.
  app.patch('/api/repuestos/:id/minimo-sugerido', gestionInventario, (req, res) => {
    const id = leerId(req);
    res.json(servicioInventario.cambiarStockMinimo(id, servicioPrediccion.minimoSugerido(id), req.usuario));
  });
  app.use('/api/prediccion', administracion, crearRutasPrediccion(servicioPrediccion));
  app.use('/api/repuestos', crearRutasInventario(servicioInventario, { soloGestion: gestionInventario }));
  app.get('/api/usuarios/mecanicos', (req, res) => res.json(servicioAuth.listarMecanicos()));
  app.use('/api/usuarios', administracion, crearRutasUsuarios(servicioUsuarios));
  app.get('/api/auditoria', administracion, (req, res) => res.json(servicioAuditoria.listar(req.query)));
  app.get('/api/auditoria/acciones', administracion, (req, res) => res.json(servicioAuditoria.acciones()));
  app.get('/api/sistema/estado', administracion, (req, res) => res.json(servicioSistema.estado()));
  app.use('/api/ordenes', crearRutasOrdenes(servicioOrdenes, {
    puedenCrear: creanOrdenes,
    puedenTrabajar: trabajanEnOrdenes,
    puedenReasignar: administracion,
    soloMecanicos: autorizar(ROLES.MECANICO),
  }));
  app.use('/api/clientes', atencionAlCliente, crearRutasClientes(servicioClientes));
  app.get('/api/vehiculos/:placa', atencionAlCliente, (req, res) => res.json(servicioClientes.historialDeVehiculo(req.params.placa)));
  app.get('/api/panel/resumen', administracion, (req, res) => res.json(servicioPanel.resumen()));

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'RUTA_NO_ENCONTRADA', mensaje: `No existe ${req.method} ${req.originalUrl}`, detalles: [] });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(manejadorDeErrores);

  return {
    app,
    servicios: {
      auth: servicioAuth,
      inventario: servicioInventario,
      ordenes: servicioOrdenes,
      auditoria: servicioAuditoria,
      usuarios: servicioUsuarios,
      sistema: servicioSistema,
      panel: servicioPanel,
      clientes: servicioClientes,
      notificaciones: servicioNotificaciones,
      alertas: servicioAlertas,
      prediccion: servicioPrediccion,
    },
  };
}

module.exports = { crearApp };
