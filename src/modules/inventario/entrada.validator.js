/**
 * Valida una entrada de mercancía (función pura): unidades que llegan del
 * proveedor y se suman al stock de un repuesto.
 * Entrada: { cantidad, detalle? }  (detalle: factura, proveedor, observación)
 */
const CANTIDAD_MAXIMA = 100000;
const LIMITE_DETALLE = 200;

function validarEntrada(entrada) {
  const errores = [];
  const datos = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};

  const cruda = datos.cantidad;
  const cantidad = typeof cruda === 'number' || (typeof cruda === 'string' && cruda.trim() !== '') ? Number(cruda) : Number.NaN;
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    errores.push({ campo: 'cantidad', mensaje: 'La cantidad debe ser un número entero mayor que cero' });
  } else if (cantidad > CANTIDAD_MAXIMA) {
    errores.push({ campo: 'cantidad', mensaje: `La cantidad máxima por entrada es ${CANTIDAD_MAXIMA}` });
  }

  let detalle = null;
  if (datos.detalle !== undefined && datos.detalle !== null) {
    if (typeof datos.detalle !== 'string') {
      errores.push({ campo: 'detalle', mensaje: 'El detalle debe ser texto' });
    } else if (datos.detalle.trim().length > LIMITE_DETALLE) {
      errores.push({ campo: 'detalle', mensaje: `El detalle admite máximo ${LIMITE_DETALLE} caracteres` });
    } else {
      detalle = datos.detalle.trim() || null;
    }
  }

  if (errores.length > 0) return { valido: false, errores, valor: null };
  return { valido: true, errores: [], valor: { cantidad, detalle } };
}

module.exports = { validarEntrada, CANTIDAD_MAXIMA };
