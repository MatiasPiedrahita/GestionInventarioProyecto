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
const { crearRepositorioOrdenes } = require('../src/modules/ordenes/orden.repository');
const { crearServicioOrdenes } = require('../src/modules/ordenes/orden.service');

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

// 3. Órdenes de ejemplo (solo si todavía no hay ninguna)
const ORDENES_DE_EJEMPLO = [
  ['1037000101', 'Camila Ortiz', '3001112233', 'ABC123', 'Chevrolet', 'Spark GT', 'Ruido metálico al frenar', 'mecanico1'],
  ['1037000102', 'Juan Pérez', '3012223344', 'DEF456', 'Renault', 'Logan', 'Cambio de aceite y filtros', 'mecanico1'],
  ['1037000103', 'Sara Gómez', '3023334455', 'GHI78D', 'Yamaha', 'NMAX', 'Revisión de frenos y cadena', 'mecanico2'],
  ['1037000104', 'Daniel Zapata', '3034445566', 'JKL012', 'Mazda', '2', 'Testigo de motor encendido', 'mecanico2'],
  ['1037000101', 'Camila Ortiz', '3001112233', 'ABC123', 'Chevrolet', 'Spark GT', 'Mantenimiento de 60.000 km', 'mecanico2'],
  ['1037000105', 'Valentina Mesa', '3045556677', 'MNO345', 'Kia', 'Picanto', 'Falla en el aire acondicionado', 'mecanico1'],
  ['1037000106', 'Andrés Cano', '3056667788', 'PQR678', 'Toyota', 'Hilux', 'Alineación y balanceo', 'mecanico2'],
  ['1037000107', 'Luisa Henao', '3067778899', 'STU90E', 'Honda', 'CB 190', 'Cambio de llantas', 'mecanico1'],
  ['1037000108', 'Mateo Arango', '3078889900', 'VWX123', 'Nissan', 'Versa', 'Ruido en la suspensión delantera', 'mecanico1'],
  ['1037000109', 'Isabela Rojas', '3089990011', 'YZA456', 'Volkswagen', 'Gol', 'Batería descargada', 'mecanico2'],
  ['1037000102', 'Juan Pérez', '3012223344', 'DEF456', 'Renault', 'Logan', 'Cambio de pastillas', 'mecanico2'],
  ['1037000110', 'Tomás Vélez', '3090001122', 'BCD789', 'Suzuki', 'Swift', 'Revisión general antes de viaje', 'mecanico1'],
];

const repoOrdenes = crearRepositorioOrdenes(db);
const ordenes = crearServicioOrdenes(repoOrdenes, repoUsuarios, repoRepuestos);
let ordenesNuevas = 0;
if (db.prepare('SELECT COUNT(*) AS n FROM ordenes').get().n === 0) {
  ORDENES_DE_EJEMPLO.forEach(([documento, nombre, telefono, placa, marca, modelo, descripcion, mecanico]) => {
    const autor = repoUsuarios.buscarPorUsuario(mecanico);
    ordenes.crear({ cliente: { documento, nombre, telefono }, vehiculo: { placa, marca, modelo }, descripcion }, autor);
    ordenesNuevas += 1;
  });
  // Algunas quedan como históricas para poder probar los filtros. El cambio
  // de estado desde la aplicación llega con la HU "Actualización del estado".
  db.exec("UPDATE ordenes SET estado = 'FINALIZADA' WHERE id IN (1, 2, 4, 7)");
  db.exec("UPDATE ordenes SET estado = 'CANCELADA' WHERE id = 3");
}

console.log(`Seed completo en ${RUTA_DB}`);
console.log(`- Repuestos nuevos: ${repuestosNuevos}`);
console.log(`- Órdenes de ejemplo nuevas: ${ordenesNuevas}`);
if (credenciales.length > 0) {
  console.log('- Usuarios creados (anota las contraseñas: no se vuelven a mostrar):');
  console.table(credenciales);
} else {
  console.log('- Los usuarios de ejemplo ya existían.');
}

db.close();
