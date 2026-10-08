/** Estados de una orden de trabajo y su nombre para mostrar. */
const ESTADOS = Object.freeze({
  EN_PROCESO: 'EN_PROCESO',
  FINALIZADA: 'FINALIZADA',
  CANCELADA: 'CANCELADA',
});

const NOMBRE_ESTADO = Object.freeze({
  EN_PROCESO: 'En proceso',
  FINALIZADA: 'Finalizada',
  CANCELADA: 'Cancelada',
});

module.exports = { ESTADOS, NOMBRE_ESTADO };
