const { ESTADOS } = require('./estados');
const { normalizarPlaca } = require('./orden.validator');

/**
 * Valida los filtros y la paginación del listado de órdenes (función pura).
 * Entrada: los query params tal como llegan (?placa=&cliente=&mecanicoId=&estado=&pagina=&tamano=).
 *
 * estado admite un estado puntual o dos grupos:
 *  - ACTIVAS: órdenes en proceso.
 *  - HISTORICAS: finalizadas o canceladas.
 */
const TAMANO_POR_DEFECTO = 10;
const TAMANO_MAXIMO = 50;
const ESTADOS_VALIDOS = [...Object.values(ESTADOS), 'ACTIVAS', 'HISTORICAS'];

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function enteroPositivo(errores, campo, valor, { porDefecto, maximo }) {
  if (texto(valor) === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || (maximo && numero > maximo)) {
    errores.push({ campo, mensaje: maximo ? `${campo} debe ser un entero entre 1 y ${maximo}` : `${campo} debe ser un entero positivo` });
    return null;
  }
  return numero;
}

function validarFiltros(query = {}) {
  const errores = [];

  const placa = normalizarPlaca(query.placa) || null;
  const cliente = texto(query.cliente) || null;
  if (cliente && cliente.length > 120) errores.push({ campo: 'cliente', mensaje: 'La búsqueda de cliente es muy larga' });

  const mecanicoId = texto(query.mecanicoId) === '' ? null : enteroPositivo(errores, 'mecanicoId', query.mecanicoId, {});

  let estado = texto(query.estado).toUpperCase() || null;
  if (estado && !ESTADOS_VALIDOS.includes(estado)) {
    errores.push({ campo: 'estado', mensaje: `El estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
    estado = null;
  }

  const pagina = enteroPositivo(errores, 'pagina', query.pagina, { porDefecto: 1 });
  const tamano = enteroPositivo(errores, 'tamano', query.tamano, { porDefecto: TAMANO_POR_DEFECTO, maximo: TAMANO_MAXIMO });

  if (errores.length > 0) return { valido: false, errores, valor: null };
  return { valido: true, errores: [], valor: { placa, cliente, mecanicoId, estado, pagina, tamano } };
}

module.exports = { validarFiltros, TAMANO_MAXIMO };
