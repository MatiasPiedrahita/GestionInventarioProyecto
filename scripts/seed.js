/**
 * Carga datos de ejemplo para probar la aplicación a mano.
 * Uso: npm run seed   (es idempotente: no duplica SKUs existentes)
 */
const fs = require('node:fs');
const path = require('node:path');
const { crearConexion } = require('../src/db/connection');
const { crearRepositorioRepuestos } = require('../src/modules/inventario/repuesto.repository');
const { crearServicioInventario } = require('../src/modules/inventario/repuesto.service');
const { parsearCsv } = require('../src/modules/inventario/csv');

const RUTA_DB = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'inventario.db');
const RUTA_CSV = path.join(__dirname, '..', 'ejemplos', 'repuestos-ejemplo.csv');

const db = crearConexion(RUTA_DB);
const repositorio = crearRepositorioRepuestos(db);
const servicio = crearServicioInventario(repositorio);

const { filas } = parsearCsv(fs.readFileSync(RUTA_CSV, 'utf8'));
let creados = 0;
for (const { datos } of filas) {
  if (repositorio.buscarPorSku(String(datos.sku).toUpperCase())) continue;
  servicio.crear(datos);
  creados += 1;
}

console.log(`Seed completo: ${creados} repuesto(s) nuevo(s) en ${RUTA_DB}`);
db.close();
