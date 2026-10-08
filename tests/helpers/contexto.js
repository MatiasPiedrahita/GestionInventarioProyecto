const request = require('supertest');
const { crearApp } = require('../../src/app');
const { crearConexion } = require('../../src/db/connection');

/** Contraseña de prueba: solo existe en bases de datos en memoria. */
const CLAVE_DE_PRUEBA = 'clave-solo-para-pruebas';

const NOMBRES = {
  dueno: 'Dueño de Prueba',
  mecanico: 'Mecánico de Prueba',
  recepcionista: 'Recepcionista de Prueba',
  administrador: 'Administrador de Prueba',
};

function clienteHttp(app, token) {
  const conToken = (peticion) => (token ? peticion.set('Authorization', `Bearer ${token}`) : peticion);
  return {
    get: (url) => conToken(request(app).get(url)),
    post: (url) => conToken(request(app).post(url)),
    put: (url) => conToken(request(app).put(url)),
    patch: (url) => conToken(request(app).patch(url)),
    delete: (url) => conToken(request(app).delete(url)),
  };
}

/**
 * Crea una aplicación con base de datos en memoria y permite actuar "como"
 * un usuario de cualquier rol. Cada usuario se crea la primera vez que se pide.
 *
 *   const ctx = crearContexto();
 *   const dueno = ctx.como('dueno');
 *   await dueno.get('/api/repuestos');
 */
function crearContexto(opciones = {}) {
  const db = crearConexion(':memory:');
  const { app, servicios } = crearApp({ db, ...opciones });
  const sesiones = new Map();

  function sesionDe(rol, alias = rol) {
    const clave = `${rol}:${alias}`;
    if (!sesiones.has(clave)) {
      const usuario = servicios.auth.crearUsuario({
        usuario: `${alias}.prueba`,
        nombre: alias === rol ? NOMBRES[rol] : `${NOMBRES[rol]} (${alias})`,
        rol,
        password: CLAVE_DE_PRUEBA,
      });
      const { token } = servicios.auth.iniciarSesion(usuario.usuario, CLAVE_DE_PRUEBA);
      sesiones.set(clave, { usuario, token });
    }
    return sesiones.get(clave);
  }

  return {
    app,
    db,
    servicios,
    /** Cliente HTTP autenticado con el rol indicado (alias permite varios usuarios del mismo rol). */
    como: (rol, alias) => clienteHttp(app, sesionDe(rol, alias).token),
    /** Datos del usuario de prueba de ese rol (id, usuario, nombre, rol). */
    usuario: (rol, alias) => sesionDe(rol, alias).usuario,
    /** Cliente HTTP sin sesión. */
    anonimo: () => clienteHttp(app, null),
  };
}

module.exports = { crearContexto, CLAVE_DE_PRUEBA };
