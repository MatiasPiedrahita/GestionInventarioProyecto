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
const { crearRutasOrdenes } = require('./modules/ordenes/orden.routes');
const { crearRepositorioAuditoria } = require('./modules/auditoria/auditoria.repository');
const { crearServicioAuditoria } = require('./modules/auditoria/auditoria.service');
const { crearServicioUsuarios } = require('./modules/usuarios/usuario.service');
const { crearRutasUsuarios } = require('./modules/usuarios/usuario.routes');
const { crearRepositorioSistema } = require('./modules/sistema/sistema.repository');
const { crearServicioSistema } = require('./modules/sistema/sistema.service');
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
 * @param {{ db?: import('node:sqlite').DatabaseSync, ahora?: () => Date }} opciones
 */
function crearApp({ db = crearConexion(':memory:'), ahora } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(cabecerasDeSeguridad);
  app.use(express.json({ limit: '100kb' }));

  // --- Composición de módulos (capas) ---------------------------------------
  const servicioAuditoria = crearServicioAuditoria(crearRepositorioAuditoria(db));
  const repositorioUsuarios = crearRepositorioUsuarios(db);
  const servicioAuth = crearServicioAuth(repositorioUsuarios, { ahora, auditoria: servicioAuditoria });
  const repositorioRepuestos = crearRepositorioRepuestos(db);
  const servicioInventario = crearServicioInventario(repositorioRepuestos, { auditoria: servicioAuditoria });
  const repositorioOrdenes = crearRepositorioOrdenes(db);
  const servicioOrdenes = crearServicioOrdenes(repositorioOrdenes, repositorioUsuarios, repositorioRepuestos, {
    auditoria: servicioAuditoria,
  });
  const servicioUsuarios = crearServicioUsuarios(repositorioUsuarios, {
    auth: servicioAuth,
    ordenesEnProcesoDe: (mecanicoId) => repositorioOrdenes.contarEnProcesoDeMecanico(mecanicoId),
    auditoria: servicioAuditoria,
    ahora,
  });
  const servicioSistema = crearServicioSistema(crearRepositorioSistema(db), { ahora });

  const autenticar = crearAutenticacion(servicioAuth);
  const gestionInventario = autorizar(ROLES.DUENO, ROLES.ADMINISTRADOR);
  // Panel de administración: usuarios, auditoría y estado del sistema.
  const administracion = autorizar(ROLES.DUENO, ROLES.ADMINISTRADOR);
  // Crear órdenes y trabajar en ellas (repuestos, notas): mecánico, dueño y administrador.
  // La recepcionista solo consulta. El mecánico además solo toca SUS órdenes (lo valida el servicio).
  const trabajanEnOrdenes = autorizar(ROLES.MECANICO, ROLES.DUENO, ROLES.ADMINISTRADOR);

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
  app.use('/api/repuestos', crearRutasInventario(servicioInventario, { soloGestion: gestionInventario }));
  app.get('/api/usuarios/mecanicos', (req, res) => res.json(servicioAuth.listarMecanicos()));
  app.use('/api/usuarios', administracion, crearRutasUsuarios(servicioUsuarios));
  app.get('/api/auditoria', administracion, (req, res) => res.json(servicioAuditoria.listar(req.query)));
  app.get('/api/auditoria/acciones', administracion, (req, res) => res.json(servicioAuditoria.acciones()));
  app.get('/api/sistema/estado', administracion, (req, res) => res.json(servicioSistema.estado()));
  app.use('/api/ordenes', crearRutasOrdenes(servicioOrdenes, { puedenCrear: trabajanEnOrdenes, puedenTrabajar: trabajanEnOrdenes }));

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
    },
  };
}

module.exports = { crearApp };
