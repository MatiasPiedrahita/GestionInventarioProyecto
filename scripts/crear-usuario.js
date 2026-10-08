/**
 * Crea un usuario del sistema desde la consola.
 * Uso:
 *   npm run usuario:crear -- --usuario luis --nombre "Luis Carlos" --rol mecanico --password "una-clave-segura"
 * Roles válidos: dueno, mecanico, recepcionista, administrador
 */
const path = require('node:path');
const { parseArgs } = require('node:util');
const { crearConexion } = require('../src/db/connection');
const { crearRepositorioUsuarios } = require('../src/modules/auth/usuario.repository');
const { crearServicioAuth } = require('../src/modules/auth/auth.service');

const { values } = parseArgs({
  options: {
    usuario: { type: 'string' },
    nombre: { type: 'string' },
    rol: { type: 'string' },
    password: { type: 'string' },
  },
});

const RUTA_DB = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'inventario.db');
const db = crearConexion(RUTA_DB);

try {
  const creado = crearServicioAuth(crearRepositorioUsuarios(db)).crearUsuario(values);
  console.log(`Usuario creado: ${creado.usuario} (${creado.rol})`);
} catch (error) {
  console.error(`No se pudo crear el usuario: ${error.message}`);
  (error.detalles || []).forEach((d) => console.error(`  - ${d.mensaje}`));
  process.exitCode = 1;
} finally {
  db.close();
}
