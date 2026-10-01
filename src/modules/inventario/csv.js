/**
 * Lector de CSV mínimo para la carga masiva de repuestos.
 * - Acepta coma o punto y coma como separador (Excel en español exporta con ';').
 * - Respeta campos entre comillas dobles, con comillas escapadas ("").
 * - Mapea encabezados flexibles: "stock_actual", "Stock Actual" o "stockActual".
 */

const ALIAS_COLUMNAS = {
  sku: 'sku',
  codigo: 'sku',
  nombre: 'nombre',
  costo: 'costo',
  stockactual: 'stockActual',
  stock: 'stockActual',
  stockminimo: 'stockMinimo',
  minimo: 'stockMinimo',
  proveedor: 'proveedor',
  ubicacion: 'ubicacion',
};

function normalizarEncabezado(texto) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_\-]/g, '');
}

function detectarSeparador(primeraLinea) {
  const comas = (primeraLinea.match(/,/g) || []).length;
  const puntoYComa = (primeraLinea.match(/;/g) || []).length;
  return puntoYComa > comas ? ';' : ',';
}

function dividirLinea(linea, separador) {
  const campos = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i];
    if (entreComillas) {
      if (c === '"' && linea[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        actual += c;
      }
    } else if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      campos.push(actual);
      actual = '';
    } else {
      actual += c;
    }
  }
  campos.push(actual);
  return campos.map((campo) => campo.trim());
}

/**
 * @param {string} texto Contenido completo del archivo CSV.
 * @returns {{ filas: {numeroFila: number, datos: object}[], columnasDesconocidas: string[] }}
 */
function parsearCsv(texto) {
  if (typeof texto !== 'string' || texto.trim() === '') {
    throw new Error('El archivo CSV está vacío');
  }

  const lineas = texto
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((linea, indice) => ({ linea, numeroFila: indice + 1 }))
    .filter(({ linea }) => linea.trim() !== '');

  const [encabezado, ...resto] = lineas;
  const separador = detectarSeparador(encabezado.linea);
  const columnasCrudas = dividirLinea(encabezado.linea, separador);
  const columnas = columnasCrudas.map((c) => ALIAS_COLUMNAS[normalizarEncabezado(c)] || null);
  const columnasDesconocidas = columnasCrudas.filter((_, i) => columnas[i] === null);

  const filas = resto.map(({ linea, numeroFila }) => {
    const valores = dividirLinea(linea, separador);
    const datos = {};
    columnas.forEach((columna, i) => {
      if (columna) datos[columna] = valores[i] === undefined ? '' : valores[i];
    });
    return { numeroFila, datos };
  });

  return { filas, columnasDesconocidas };
}

module.exports = { parsearCsv };
