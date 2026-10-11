/**
 * Genera un historial de consumo de ejemplo para probar la predicción de demanda.
 * Uso: npm run seed              (primero: crea usuarios y el catálogo base)
 *      npm run seed:historial    (después: dos años y medio de órdenes y consumo)
 *
 * El modelo necesita historia para pronosticar, y un proyecto recién
 * instalado no la tiene. Este script simula dos años y medio de trabajo del
 * taller con patrones de demanda distintos y conocidos (tendencia,
 * temporadas, baja rotación, un repuesto que dejó de usarse), para que se
 * pueda ver al modelo acertar en cada caso.
 *
 * - Usa los mismos servicios de la aplicación: cada unidad consumida pasa
 *   por una orden, descuenta stock y deja su movimiento.
 * - Es determinista: siempre genera exactamente el mismo historial.
 * - Es idempotente: si ya hay órdenes antiguas, no hace nada.
 * - Los datos son inventados. No lo ejecute sobre la base real de un taller.
 */
const path = require('node:path');
const { crearConexion } = require('../src/db/connection');
const { crearRepositorioRepuestos } = require('../src/modules/inventario/repuesto.repository');
const { crearServicioInventario } = require('../src/modules/inventario/repuesto.service');
const { crearRepositorioUsuarios } = require('../src/modules/auth/usuario.repository');
const { crearRepositorioOrdenes } = require('../src/modules/ordenes/orden.repository');
const { crearServicioOrdenes } = require('../src/modules/ordenes/orden.service');
const { crearRepositorioHistorialDemo } = require('./historial-demo.repository');

const RUTA_DB = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'inventario.db');
const SEMANAS = 132; // dos años y medio: el modelo estacional necesita ver cada temporada dos veces
const SEMANAS_SIN_REPONER = 4;
const DIA_MS = 24 * 3600 * 1000;

/** Repuestos que se agregan al catálogo base para tener más variedad de patrones. */
const REPUESTOS_ADICIONALES = [
  { sku: 'BAT-12V-007', nombre: 'Batería 12V 45Ah', costo: 420000, stockActual: 4, stockMinimo: 2, proveedor: 'Baterías Medellín', ubicacion: 'Bodega' },
  { sku: 'LIQ-FRE-008', nombre: 'Líquido de frenos DOT4 500 ml', costo: 32000, stockActual: 10, stockMinimo: 4, proveedor: 'Frenos y Partes SAS', ubicacion: 'Estante B2' },
  { sku: 'AMO-DEL-009', nombre: 'Amortiguador delantero Renault Logan', costo: 265000, stockActual: 4, stockMinimo: 2, proveedor: 'Repuestos Renault Itagüí', ubicacion: 'Estante D1' },
  { sku: 'PLU-LIM-010', nombre: 'Plumillas limpiaparabrisas 20"', costo: 38000, stockActual: 10, stockMinimo: 4, proveedor: 'Autopartes del Valle', ubicacion: 'Estante A4' },
  { sku: 'BOM-H4-011', nombre: 'Bombillo halógeno H4', costo: 19500, stockActual: 12, stockMinimo: 5, proveedor: 'Distribuidora Antioquia', ubicacion: 'Cajón C1' },
  { sku: 'REF-VER-012', nombre: 'Refrigerante verde galón (descontinuado)', costo: 46000, stockActual: 8, stockMinimo: 0, proveedor: 'Lubricantes Medellín', ubicacion: 'Bodega' },
];

/**
 * Cómo se consume cada repuesto.
 *   base        unidades por semana cuando hay consumo
 *   tendencia   cuánto crece (o baja, si es negativo) de principio a fin: 0,6 = termina un 60 % más alto
 *   temporada   meses en los que se consume más, y cuánto más
 *   frecuencia  probabilidad de que haya consumo en una semana (1 = todas)
 *   multiplo    se usa de a tantos (bujías de a 4, amortiguadores de a 2)
 *   hasta       fracción del historial después de la cual deja de usarse
 */
const PERFILES = {
  'FIL-ACE-001': { base: 6, tendencia: 0.5, temporada: { meses: [6, 12], factor: 1.6 } },
  'ACE-15W40-005': { base: 5, tendencia: 0.3, temporada: { meses: [6, 12], factor: 1.6 } },
  'FIL-AIR-002': { base: 3 },
  'PAS-DEL-003': { base: 2, tendencia: 1.2 },
  'BUJ-NGK-004': { base: 1.6, multiplo: 4, frecuencia: 0.75 },
  'COR-DIS-006': { base: 1, frecuencia: 0.2 },
  'BAT-12V-007': { base: 1, frecuencia: 0.15 },
  'LIQ-FRE-008': { base: 2.2 },
  'AMO-DEL-009': { base: 1, multiplo: 2, frecuencia: 0.14 },
  'PLU-LIM-010': { base: 1.5, temporada: { meses: [4, 5, 10, 11], factor: 2.8 } },
  'BOM-H4-011': { base: 1.4, frecuencia: 0.65 },
  'REF-VER-012': { base: 2.5, hasta: 0.6 },
};

const CLIENTES = [
  ['Camila Ortiz', 'ABC123', 'Chevrolet', 'Spark GT'], ['Juan Pérez', 'DEF456', 'Renault', 'Logan'], ['Sara Gómez', 'GHI78D', 'Yamaha', 'NMAX'],
  ['Daniel Zapata', 'JKL012', 'Mazda', '2'], ['Valentina Mesa', 'MNO345', 'Kia', 'Picanto'], ['Andrés Cano', 'PQR678', 'Toyota', 'Hilux'],
  ['Luisa Henao', 'STU90E', 'Honda', 'CB 190'], ['Mateo Arango', 'VWX123', 'Nissan', 'Versa'], ['Isabela Rojas', 'YZA456', 'Volkswagen', 'Gol'],
  ['Tomás Vélez', 'BCD789', 'Suzuki', 'Swift'], ['Mariana Duque', 'EFG234', 'Renault', 'Sandero'], ['Santiago Marín', 'HIJ567', 'Chevrolet', 'Onix'],
  ['Laura Betancur', 'KLM890', 'Hyundai', 'i10'], ['Felipe Cardona', 'NOP12F', 'Bajaj', 'Pulsar 200'], ['Paula Giraldo', 'QRS345', 'Mazda', '3'],
  ['Sebastián Ochoa', 'TUV678', 'Renault', 'Duster'], ['Natalia Uribe', 'WXY901', 'Kia', 'Rio'], ['David Londoño', 'ZAB234', 'Ford', 'Fiesta'],
  ['Carolina Osorio', 'CDE567', 'Chevrolet', 'Sail'], ['Julián Montoya', 'FGH89G', 'AKT', 'NKD 125'], ['Manuela Ríos', 'IJK012', 'Renault', 'Kwid'],
  ['Esteban Correa', 'LMN345', 'Toyota', 'Corolla'], ['Daniela Salazar', 'OPQ678', 'Nissan', 'March'], ['Alejandro Mejía', 'RST901', 'Volkswagen', 'Voyage'],
];

const TRABAJOS = [
  'Cambio de aceite y filtros', 'Revisión de frenos', 'Mantenimiento de los 10.000 km', 'Ruido en la suspensión', 'Sincronización del motor',
  'Revisión general antes de viaje', 'Cambio de pastillas', 'Falla al encender', 'Revisión de luces', 'Mantenimiento preventivo',
];

/** Generador de números aleatorios con semilla (mulberry32): el historial sale siempre igual. */
function crearAleatorio(semilla) {
  let estado = semilla;
  return () => {
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Número de eventos con distribución de Poisson (método de Knuth). */
function poisson(media, aleatorio) {
  const limite = Math.exp(-media);
  let eventos = 0;
  let producto = aleatorio();
  while (producto > limite) {
    eventos += 1;
    producto *= aleatorio();
  }
  return eventos;
}

/** Unidades consumidas de un repuesto en una semana, según su perfil. */
function consumoDeLaSemana(perfil, indice, lunes, aleatorio) {
  const avance = indice / (SEMANAS - 1);
  if (perfil.hasta !== undefined && avance > perfil.hasta) return 0;
  if (perfil.frecuencia !== undefined && aleatorio() > perfil.frecuencia) return 0;
  let media = perfil.base * (1 + (perfil.tendencia || 0) * avance);
  if (perfil.temporada && perfil.temporada.meses.includes(lunes.getUTCMonth() + 1)) media *= perfil.temporada.factor;
  const veces = perfil.frecuencia === undefined ? poisson(media, aleatorio) : Math.max(1, poisson(media, aleatorio));
  return veces * (perfil.multiplo || 1);
}

const aFechaSql = (fecha) => fecha.toISOString().slice(0, 19).replace('T', ' ');

function lunesDeHaceSemanas(semanas) {
  const hoy = new Date();
  const lunes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - ((hoy.getUTCDay() + 6) % 7)));
  return new Date(lunes.getTime() - semanas * 7 * DIA_MS);
}

// ------------------------------------------------------------------ ejecución
const db = crearConexion(RUTA_DB);
const repoRepuestos = crearRepositorioRepuestos(db);
const repoUsuarios = crearRepositorioUsuarios(db);
const inventario = crearServicioInventario(repoRepuestos);
const ordenes = crearServicioOrdenes(crearRepositorioOrdenes(db), repoUsuarios, repoRepuestos);
const demo = crearRepositorioHistorialDemo(db);

function terminar(mensaje, codigo = 0) {
  (codigo === 0 ? console.log : console.error)(mensaje);
  db.close();
  process.exit(codigo);
}

const mecanicos = repoUsuarios.listarPorRol('mecanico');
const dueno = repoUsuarios.listarPorRol('dueno')[0];
if (mecanicos.length === 0 || !dueno) terminar('Faltan los usuarios de ejemplo. Ejecute primero: npm run seed', 1);
if (demo.contarOrdenesAnterioresA(aFechaSql(lunesDeHaceSemanas(8))) > 0) {
  terminar('Ya existe historial de órdenes antiguas: no se generó nada (el script no duplica datos).');
}

const inicio = lunesDeHaceSemanas(SEMANAS);
const aleatorio = crearAleatorio(20261012);

REPUESTOS_ADICIONALES.filter((r) => !repoRepuestos.buscarPorSku(r.sku)).forEach((r) => inventario.crear(r));
const catalogo = Object.fromEntries(Object.keys(PERFILES).map((sku) => [sku, repoRepuestos.buscarPorSku(sku)]));
const faltantes = Object.entries(catalogo).filter(([, repuesto]) => !repuesto || !repuesto.activo).map(([sku]) => sku);
if (faltantes.length > 0) terminar(`Faltan repuestos del catálogo de ejemplo (${faltantes.join(', ')}). Ejecute primero: npm run seed`, 1);
demo.fecharCatalogo(aFechaSql(inicio));

let totalOrdenes = 0;
let totalUnidades = 0;
let canceladas = 0;

for (let semana = 0; semana < SEMANAS; semana += 1) {
  const lunes = new Date(inicio.getTime() + semana * 7 * DIA_MS);
  const esLaUltima = semana === SEMANAS - 1;

  // Lo que se consume esta semana de cada repuesto.
  const consumo = Object.entries(PERFILES)
    .map(([sku, perfil]) => ({ repuesto: catalogo[sku], unidades: consumoDeLaSemana(perfil, semana, lunes, aleatorio) }))
    .filter((c) => c.unidades > 0);

  // Compras: si lo que hay no alcanza para la semana, "llegó un pedido" el lunes.
  // En el último mes el taller "se descuidó" y compró solo lo justo: así el historial
  // termina con repuestos en su mínimo, que es cuando las alertas y la predicción se lucen.
  const compraJusta = semana >= SEMANAS - SEMANAS_SIN_REPONER;
  const antesDeLasEntradas = demo.ultimoMovimientoId();
  consumo.forEach(({ repuesto, unidades }) => {
    const actual = repoRepuestos.buscarPorId(repuesto.id);
    const detalle = `Compra a ${actual.proveedor || 'proveedor'}`;
    if (compraJusta) {
      // Lo que falta más un pequeño sobrante distinto por repuesto, para que no terminen todos en cero.
      if (actual.stockActual < unidades) {
        inventario.registrarEntrada(repuesto.id, { cantidad: unidades - actual.stockActual + (repuesto.id % 4) * 2, detalle });
      }
    } else if (actual.stockActual < unidades + actual.stockMinimo) {
      inventario.registrarEntrada(repuesto.id, { cantidad: unidades * 3 + actual.stockMinimo, detalle });
    }
  });
  demo.fecharEntradasDesde(antesDeLasEntradas, aFechaSql(lunes));

  // Las unidades se reparten entre las órdenes de la semana.
  const cantidadDeOrdenes = 4 + Math.floor(aleatorio() * 5);
  const itemsPorOrden = Array.from({ length: cantidadDeOrdenes }, () => new Map());
  consumo.forEach(({ repuesto, unidades }) => {
    const paso = PERFILES[repuesto.sku].multiplo || 1;
    for (let restantes = unidades; restantes > 0; restantes -= paso) {
      const items = itemsPorOrden[Math.floor(aleatorio() * cantidadDeOrdenes)];
      items.set(repuesto.id, (items.get(repuesto.id) || 0) + paso);
    }
  });

  itemsPorOrden.forEach((items, i) => {
    const [nombre, placa, marca, modelo] = CLIENTES[Math.floor(aleatorio() * CLIENTES.length)];
    const mecanico = mecanicos[(totalOrdenes + i) % mecanicos.length];
    const creada = new Date(lunes.getTime() + Math.floor(aleatorio() * 5) * DIA_MS + (8 + Math.floor(aleatorio() * 9)) * 3600 * 1000);
    const cerrada = new Date(creada.getTime() + (3 + Math.floor(aleatorio() * 45)) * 3600 * 1000);

    {
      const orden = ordenes.crear({
        cliente: { documento: String(1037100000 + CLIENTES.findIndex((c) => c[1] === placa)), nombre, telefono: `30${String(10000000 + CLIENTES.findIndex((c) => c[1] === placa) * 7919).slice(0, 8)}` },
        vehiculo: { placa, marca, modelo },
        descripcion: TRABAJOS[Math.floor(aleatorio() * TRABAJOS.length)],
      }, mecanico);
      if (items.size > 0) {
        ordenes.registrarRepuestos(orden.id, { items: [...items].map(([repuestoId, cantidad]) => ({ repuestoId, cantidad })) }, mecanico);
      }

      // Unas pocas se cancelan (y devuelven sus repuestos); las de la última semana quedan casi todas abiertas.
      const seCancela = aleatorio() < 0.03;
      const quedaAbierta = esLaUltima && aleatorio() < 0.6;
      if (seCancela) {
        ordenes.cambiarEstado(orden.id, { estado: 'CANCELADA', motivo: 'El cliente no aprobó la cotización' }, mecanico);
        canceladas += 1;
      } else if (!quedaAbierta) {
        ordenes.cambiarEstado(orden.id, { estado: 'FINALIZADA' }, mecanico);
      }
      if (!seCancela) totalUnidades += [...items.values()].reduce((suma, cantidad) => suma + cantidad, 0);

      demo.fecharOrden({ id: orden.id, clienteId: orden.cliente.id, creada: aFechaSql(creada), cerrada: aFechaSql(cerrada) });
    }
  });
  totalOrdenes += cantidadDeOrdenes;
}

console.log(`Historial de demostración creado en ${RUTA_DB}`);
console.log(`- Periodo: ${SEMANAS} semanas, desde el ${inicio.toISOString().slice(0, 10)}`);
console.log(`- Órdenes: ${totalOrdenes} (${canceladas} canceladas)`);
console.log(`- Unidades consumidas: ${totalUnidades} en ${Object.keys(PERFILES).length} repuestos`);
console.log('Siguiente paso: inicie la aplicación (npm start), entre como administrador y ejecute la predicción.');

db.close();
