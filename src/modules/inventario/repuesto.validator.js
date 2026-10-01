/**
 * Reglas de negocio para un repuesto. Es una función pura (no toca la base
 * de datos ni Express), por eso se prueba de forma unitaria.
 *
 * Criterio de aceptación HU-01: "validar que no permita stock negativo ni
 * campos obligatorios vacíos al guardar".
 */

const PATRON_SKU = /^[A-Za-z0-9][A-Za-z0-9\-_.]*$/;

/** Nombre legible de cada campo, para que los mensajes sirvan tal cual en la interfaz. */
const ETIQUETAS = {
  sku: 'El SKU',
  nombre: 'El nombre',
  costo: 'El costo',
  stockActual: 'El stock actual',
  stockMinimo: 'El stock mínimo',
  proveedor: 'El proveedor',
  ubicacion: 'La ubicación',
};

const LIMITES = {
  sku: 40,
  nombre: 120,
  proveedor: 120,
  ubicacion: 60,
};

function estaVacio(valor) {
  return valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '');
}

/** Convierte "12" o 12 en número; cualquier otra cosa en NaN. */
function aNumero(valor) {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string' && valor.trim() !== '') return Number(valor.trim());
  return Number.NaN;
}

function validarTexto(errores, campo, valor, { obligatorio }) {
  if (estaVacio(valor)) {
    if (obligatorio) errores.push({ campo, mensaje: `${ETIQUETAS[campo]} es obligatorio` });
    return null;
  }
  if (typeof valor !== 'string') {
    errores.push({ campo, mensaje: `${ETIQUETAS[campo]} debe ser texto` });
    return null;
  }
  const limpio = valor.trim();
  if (limpio.length > LIMITES[campo]) {
    errores.push({ campo, mensaje: `${ETIQUETAS[campo]} admite máximo ${LIMITES[campo]} caracteres` });
  }
  return limpio;
}

function validarEnteroNoNegativo(errores, campo, valor, { obligatorio, porDefecto }) {
  if (estaVacio(valor)) {
    if (obligatorio) {
      errores.push({ campo, mensaje: `${ETIQUETAS[campo]} es obligatorio` });
      return null;
    }
    return porDefecto;
  }
  const numero = aNumero(valor);
  if (!Number.isInteger(numero)) {
    errores.push({ campo, mensaje: `${ETIQUETAS[campo]} debe ser un número entero` });
    return null;
  }
  if (numero < 0) {
    errores.push({ campo, mensaje: `${ETIQUETAS[campo]} no puede ser negativo` });
    return null;
  }
  return numero;
}

/**
 * Valida y normaliza los datos de un repuesto.
 * @param {object} entrada Datos tal como llegan del cliente (JSON o CSV).
 * @returns {{ valido: boolean, errores: {campo: string, mensaje: string}[], valor: object|null }}
 */
function validarRepuesto(entrada) {
  const errores = [];

  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return {
      valido: false,
      errores: [{ campo: '_', mensaje: 'Se esperaba un objeto con los datos del repuesto' }],
      valor: null,
    };
  }

  const sku = validarTexto(errores, 'sku', entrada.sku, { obligatorio: true });
  if (sku && !PATRON_SKU.test(sku)) {
    errores.push({ campo: 'sku', mensaje: 'El SKU solo admite letras, números, guion, guion bajo y punto' });
  }

  const nombre = validarTexto(errores, 'nombre', entrada.nombre, { obligatorio: true });

  let costo = null;
  if (estaVacio(entrada.costo)) {
    errores.push({ campo: 'costo', mensaje: 'El costo es obligatorio' });
  } else {
    costo = aNumero(entrada.costo);
    if (!Number.isFinite(costo)) {
      errores.push({ campo: 'costo', mensaje: 'El costo debe ser un número' });
    } else if (costo < 0) {
      errores.push({ campo: 'costo', mensaje: 'El costo no puede ser negativo' });
    }
  }

  const stockActual = validarEnteroNoNegativo(errores, 'stockActual', entrada.stockActual, { obligatorio: true });
  const stockMinimo = validarEnteroNoNegativo(errores, 'stockMinimo', entrada.stockMinimo, {
    obligatorio: false,
    porDefecto: 0,
  });

  const proveedor = validarTexto(errores, 'proveedor', entrada.proveedor, { obligatorio: false });
  const ubicacion = validarTexto(errores, 'ubicacion', entrada.ubicacion, { obligatorio: false });

  if (errores.length > 0) {
    return { valido: false, errores, valor: null };
  }

  return {
    valido: true,
    errores: [],
    valor: {
      sku: sku.toUpperCase(),
      nombre,
      costo: Math.round(costo * 100) / 100,
      stockActual,
      stockMinimo,
      proveedor,
      ubicacion,
    },
  };
}

module.exports = { validarRepuesto };
