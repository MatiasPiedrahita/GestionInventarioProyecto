const { ACCIONES } = require('./acciones');

/**
 * Valida los filtros de la consulta de auditoría (función pura).
 * Entrada: ?usuarioId=&accion=&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&pagina=&tamano=
 */
const TAMANO_POR_DEFECTO = 20;
const TAMANO_MAXIMO = 100;
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

function entero(errores, campo, valor, { porDefecto = null, maximo } = {}) {
  if (texto(valor) === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || (maximo && numero > maximo)) {
    errores.push({ campo, mensaje: maximo ? `${campo} debe ser un entero entre 1 y ${maximo}` : `${campo} debe ser un entero positivo` });
    return null;
  }
  return numero;
}

function fecha(errores, campo, valor) {
  const limpio = texto(valor);
  if (limpio === '') return null;
  if (!PATRON_FECHA.test(limpio) || Number.isNaN(Date.parse(`${limpio}T00:00:00Z`))) {
    errores.push({ campo, mensaje: `${campo} debe tener el formato AAAA-MM-DD` });
    return null;
  }
  return limpio;
}

function validarFiltrosDeAuditoria(query = {}) {
  const errores = [];

  const usuarioId = entero(errores, 'usuarioId', query.usuarioId);
  let accion = texto(query.accion).toUpperCase() || null;
  if (accion && !Object.values(ACCIONES).includes(accion)) {
    errores.push({ campo: 'accion', mensaje: 'La acción no existe' });
    accion = null;
  }
  const desde = fecha(errores, 'desde', query.desde);
  const hasta = fecha(errores, 'hasta', query.hasta);
  if (desde && hasta && desde > hasta) errores.push({ campo: 'hasta', mensaje: 'La fecha final no puede ser anterior a la inicial' });
  const pagina = entero(errores, 'pagina', query.pagina, { porDefecto: 1 });
  const tamano = entero(errores, 'tamano', query.tamano, { porDefecto: TAMANO_POR_DEFECTO, maximo: TAMANO_MAXIMO });

  if (errores.length > 0) return { valido: false, errores, valor: null };
  return { valido: true, errores: [], valor: { usuarioId, accion, desde, hasta, pagina, tamano } };
}

module.exports = { validarFiltrosDeAuditoria };
