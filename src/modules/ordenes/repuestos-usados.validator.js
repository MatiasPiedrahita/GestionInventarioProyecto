/**
 * Valida la lista de repuestos que se registran en una orden (función pura).
 * Entrada esperada: { items: [{ repuestoId, cantidad }, ...] }
 * Si el mismo repuesto aparece varias veces, se suman sus cantidades.
 */
const MAXIMO_ITEMS = 50;

function validarRepuestosUsados(entrada) {
  const items = entrada && Array.isArray(entrada.items) ? entrada.items : null;
  if (!items || items.length === 0) {
    return { valido: false, errores: [{ campo: 'items', mensaje: 'Agrega al menos un repuesto con su cantidad' }], valor: null };
  }
  if (items.length > MAXIMO_ITEMS) {
    return { valido: false, errores: [{ campo: 'items', mensaje: `Máximo ${MAXIMO_ITEMS} repuestos por registro` }], valor: null };
  }

  const errores = [];
  const porRepuesto = new Map();

  items.forEach((item, indice) => {
    const repuestoId = Number(item && item.repuestoId);
    const cantidad = Number(item && item.cantidad);
    if (!Number.isInteger(repuestoId) || repuestoId <= 0) {
      errores.push({ campo: `items[${indice}].repuestoId`, mensaje: 'Selecciona un repuesto del inventario' });
    }
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      errores.push({ campo: `items[${indice}].cantidad`, mensaje: 'La cantidad debe ser un número entero mayor que cero' });
    }
    if (errores.length === 0) porRepuesto.set(repuestoId, (porRepuesto.get(repuestoId) || 0) + cantidad);
  });

  if (errores.length > 0) return { valido: false, errores, valor: null };
  return {
    valido: true,
    errores: [],
    valor: [...porRepuesto].map(([repuestoId, cantidad]) => ({ repuestoId, cantidad })),
  };
}

module.exports = { validarRepuestosUsados };
