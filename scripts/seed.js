/**
 * Carga datos de ejemplo para probar la aplicación a mano.
 * Uso: npm run seed   (es idempotente: no duplica lo que ya existe)
 *
 * Contraseñas de los usuarios de ejemplo:
 *  - Si existe DEMO_PASSWORD (en el archivo .env, que NO se sube al repo),
 *    todos los usuarios de ejemplo usan esa contraseña.
 *  - Si no, se genera una contraseña aleatoria por usuario y se muestra
 *    una sola vez en la consola. Así nunca hay contraseñas en el repositorio.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { crearConexion } = require('../src/db/connection');
const { crearRepositorioRepuestos } = require('../src/modules/inventario/repuesto.repository');
const { crearServicioInventario } = require('../src/modules/inventario/repuesto.service');
const { crearRepositorioUsuarios } = require('../src/modules/auth/usuario.repository');
const { crearServicioAuth } = require('../src/modules/auth/auth.service');
const { parsearCsv } = require('../src/modules/inventario/csv');

const RUTA_DB = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'inventario.db');
const RUTA_CSV = path.join(__dirname, '..', 'ejemplos', 'repuestos-ejemplo.csv');

const USUARIOS_DE_EJEMPLO = [
  { usuario: 'dueno', nombre: 'Jorge Restrepo', rol: 'dueno' },
  { usuario: 'admin', nombre: 'Administrador del sistema', rol: 'administrador' },
  { usuario: 'mecanico1', nombre: 'Andrés Gómez', rol: 'mecanico' },
  { usuario: 'mecanico2', nombre: 'Felipe Ríos', rol: 'mecanico' },
  { usuario: 'recepcion', nombre: 'Laura Mejía', rol: 'recepcionista' },
];

const db = crearConexion(RUTA_DB);
const repoRepuestos = crearRepositorioRepuestos(db);
const inventario = crearServicioInventario(repoRepuestos);
const repoUsuarios = crearRepositorioUsuarios(db);
const auth = crearServicioAuth(repoUsuarios);

// 1. Repuestos
const { filas } = parsearCsv(fs.readFileSync(RUTA_CSV, 'utf8'));
let repuestosNuevos = 0;
for (const { datos } of filas) {
  if (repoRepuestos.buscarPorSku(String(datos.sku).toUpperCase())) continue;
  inventario.crear(datos);
  repuestosNuevos += 1;
}

// 2. Usuarios
const credenciales = [];
for (const datos of USUARIOS_DE_EJEMPLO) {
  if (repoUsuarios.buscarPorUsuario(datos.usuario)) continue;
  const password = process.env.DEMO_PASSWORD || crypto.randomBytes(6).toString('base64url');
  auth.crearUsuario({ ...datos, password });
  credenciales.push({ usuario: datos.usuario, rol: datos.rol, password: process.env.DEMO_PASSWORD ? '(DEMO_PASSWORD)' : password });
}

console.log(`Seed completo en ${RUTA_DB}`);
console.log(`- Repuestos nuevos: ${repuestosNuevos}`);
if (credenciales.length > 0) {
  console.log('- Usuarios creados (anota las contraseñas: no se vuelven a mostrar):');
  console.table(credenciales);
} else {
  console.log('- Los usuarios de ejemplo ya existían.');
}

db.close();
