const { ESTADOS } = require('./estados');

/**
 * Valida la petición de cambio de estado de una orden (función pura).
 * Entrada: { estado, motivo?, devolverRepuestos? }
 *
 * - Finalizar no exige motivo.
 * - Cancelar y reabrir sí: queda escrito por qué se hizo.
 * - devolverRepuestos solo aplica al cancelar; por defecto los repuestos
 *   registrados vuelven al inventario.
 */
const LIMITE_MOTIVO = 500;
const EXIGEN_MOTIVO = [ESTADOS.CANCELADA, ESTADOS.EN_PROCESO];

function validarCambioDeEstado(entrada) {
  const errores = [];
  const datos = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};

  const estado = typeof datos.estado === 'string' ? datos.estado.trim().toUpperCase() : '';
  if (estado === '') {
    errores.push({ campo: 'estado', mensaje: 'Indica el nuevo estado de la orden' });
  } else if (!Object.values(ESTADOS).includes(estado)) {
    errores.push({ campo: 'estado', mensaje: `El estado debe ser uno de: ${Object.values(ESTADOS).join(', ')}` });
  }

  let motivo = null;
  if (datos.motivo !== undefined && datos.motivo !== null && typeof datos.motivo !== 'string') {
    errores.push({ campo: 'motivo', mensaje: 'El motivo debe ser texto' });
  } else {
    motivo = typeof datos.motivo === 'string' && datos.motivo.trim() !== '' ? datos.motivo.trim() : null;
    if (motivo && motivo.length > LIMITE_MOTIVO) {
      errores.push({ campo: 'motivo', mensaje: `El motivo admite máximo ${LIMITE_MOTIVO} caracteres` });
    } else if (!motivo && EXIGEN_MOTIVO.includes(estado)) {
      const accion = estado === ESTADOS.CANCELADA ? 'cancelar' : 'reabrir';
      errores.push({ campo: 'motivo', mensaje: `Escribe el motivo para ${accion} la orden` });
    }
  }

  let devolverRepuestos = true;
  if (datos.devolverRepuestos !== undefined && datos.devolverRepuestos !== null) {
    if (typeof datos.devolverRepuestos !== 'boolean') {
      errores.push({ campo: 'devolverRepuestos', mensaje: 'devolverRepuestos debe ser verdadero o falso' });
    } else {
      devolverRepuestos = datos.devolverRepuestos;
    }
  }

  if (errores.length > 0) return { valido: false, errores, valor: null };
  return { valido: true, errores: [], valor: { estado, motivo, devolverRepuestos } };
}

module.exports = { validarCambioDeEstado, LIMITE_MOTIVO };
