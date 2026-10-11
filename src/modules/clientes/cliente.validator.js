const { normalizarEmail } = require('../auth/email');
const { PATRON_TELEFONO } = require('../ordenes/orden.validator');

/**
 * Validadores del directorio de clientes (funciones puras).
 * El documento del cliente no se edita: es lo que lo identifica al crear órdenes.
 */
const LIMITE_NOMBRE = 120;
const LIMITE_BUSQUEDA = 60;
const TAMANO_POR_DEFECTO = 15;
const TAMANO_MAXIMO = 50;

const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

function validarContacto(entrada) {
  const errores = [];
  const datos = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};

  const nombre = texto(datos.nombre);
  if (nombre === '') errores.push({ campo: 'nombre', mensaje: 'El nombre del cliente es obligatorio' });
  else if (nombre.length > LIMITE_NOMBRE) errores.push({ campo: 'nombre', mensaje: `El nombre admite máximo ${LIMITE_NOMBRE} caracteres` });

  const telefono = texto(datos.telefono);
  if (telefono === '') errores.push({ campo: 'telefono', mensaje: 'El teléfono del cliente es obligatorio' });
  else if (!PATRON_TELEFONO.test(telefono)) errores.push({ campo: 'telefono', mensaje: 'El teléfono no es válido' });

  const correo = normalizarEmail(datos.email);
  if (correo.error) errores.push({ campo: 'email', mensaje: correo.error });

  if (errores.length > 0) return { valido: false, errores, valor: null };
  return { valido: true, errores: [], valor: { nombre, telefono, email: correo.valor } };
}

function entero(errores, campo, valor, { porDefecto, maximo }) {
  if (texto(valor) === '') return porDefecto;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 1 || (maximo && numero > maximo)) {
    errores.push({ campo, mensaje: maximo ? `${campo} debe ser un entero entre 1 y ${maximo}` : `${campo} debe ser un entero positivo` });
    return null;
  }
  return numero;
}

/** Filtros del listado: ?q= (nombre, documento, teléfono o placa) &documento= (exacto) &pagina= &tamano= */
function validarBusquedaDeClientes(query = {}) {
  const errores = [];
  const q = texto(query.q) || null;
  if (q && q.length > LIMITE_BUSQUEDA) errores.push({ campo: 'q', mensaje: 'La búsqueda es muy larga' });
  const documento = texto(query.documento) || null;
  if (documento && documento.length > 20) errores.push({ campo: 'documento', mensaje: 'El documento es muy largo' });
  const pagina = entero(errores, 'pagina', query.pagina, { porDefecto: 1 });
  const tamano = entero(errores, 'tamano', query.tamano, { porDefecto: TAMANO_POR_DEFECTO, maximo: TAMANO_MAXIMO });

  if (errores.length > 0) return { valido: false, errores, valor: null };
  return { valido: true, errores: [], valor: { q, documento, pagina, tamano } };
}

module.exports = { validarContacto, validarBusquedaDeClientes };
