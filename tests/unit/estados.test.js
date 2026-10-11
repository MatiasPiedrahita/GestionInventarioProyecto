const { evaluarTransicion, esReapertura, TRANSICIONES, ESTADOS } = require('../../src/modules/ordenes/estados');
const { validarCambioDeEstado } = require('../../src/modules/ordenes/estado.validator');

describe('evaluarTransicion (unitarias)', () => {
  test.each([
    ['EN_PROCESO', 'FINALIZADA', 'mecanico'],
    ['EN_PROCESO', 'CANCELADA', 'mecanico'],
    ['EN_PROCESO', 'FINALIZADA', 'dueno'],
    ['FINALIZADA', 'EN_PROCESO', 'dueno'],
    ['CANCELADA', 'EN_PROCESO', 'administrador'],
  ])('permite %s → %s a %s', (actual, nuevo, rol) => {
    expect(evaluarTransicion(actual, nuevo, rol)).toEqual({ permitida: true, razon: null });
  });

  test.each([
    ['EN_PROCESO', 'EN_PROCESO', 'dueno', 'MISMO_ESTADO'],
    ['FINALIZADA', 'FINALIZADA', 'mecanico', 'MISMO_ESTADO'],
    ['FINALIZADA', 'CANCELADA', 'dueno', 'TRANSICION_INVALIDA'],
    ['CANCELADA', 'FINALIZADA', 'administrador', 'TRANSICION_INVALIDA'],
    ['EN_PROCESO', 'ENTREGADA', 'dueno', 'TRANSICION_INVALIDA'],
    ['PERDIDA', 'EN_PROCESO', 'dueno', 'TRANSICION_INVALIDA'],
    ['FINALIZADA', 'EN_PROCESO', 'mecanico', 'ROL_SIN_PERMISO'],
    ['CANCELADA', 'EN_PROCESO', 'recepcionista', 'ROL_SIN_PERMISO'],
  ])('rechaza %s → %s a %s (%s)', (actual, nuevo, rol, razon) => {
    expect(evaluarTransicion(actual, nuevo, rol)).toEqual({ permitida: false, razon });
  });

  test('todos los estados tienen sus transiciones definidas', () => {
    expect(Object.keys(TRANSICIONES).sort()).toEqual(Object.values(ESTADOS).sort());
  });

  test('esReapertura distingue volver a "en proceso" desde un estado cerrado', () => {
    expect(esReapertura('FINALIZADA', 'EN_PROCESO')).toBe(true);
    expect(esReapertura('CANCELADA', 'EN_PROCESO')).toBe(true);
    expect(esReapertura('EN_PROCESO', 'FINALIZADA')).toBe(false);
    expect(esReapertura('EN_PROCESO', 'EN_PROCESO')).toBe(false);
  });
});

describe('validarCambioDeEstado (unitarias)', () => {
  test('finalizar no exige motivo y devuelve los valores por defecto', () => {
    expect(validarCambioDeEstado({ estado: ' finalizada ' })).toEqual({
      valido: true, errores: [], valor: { estado: 'FINALIZADA', motivo: null, devolverRepuestos: true },
    });
  });

  test('cancelar con motivo y sin devolver repuestos', () => {
    const { valor } = validarCambioDeEstado({ estado: 'CANCELADA', motivo: '  El cliente no aprobó la cotización ', devolverRepuestos: false });

    expect(valor).toEqual({ estado: 'CANCELADA', motivo: 'El cliente no aprobó la cotización', devolverRepuestos: false });
  });

  test.each([
    ['cancelar sin motivo', { estado: 'CANCELADA' }, 'motivo', 'Escribe el motivo para cancelar la orden'],
    ['cancelar con motivo en blanco', { estado: 'CANCELADA', motivo: '   ' }, 'motivo', 'Escribe el motivo para cancelar la orden'],
    ['reabrir sin motivo', { estado: 'EN_PROCESO' }, 'motivo', 'Escribe el motivo para reabrir la orden'],
    ['sin estado', { motivo: 'x' }, 'estado', 'Indica el nuevo estado de la orden'],
    ['estado que no es texto', { estado: 3 }, 'estado', 'Indica el nuevo estado de la orden'],
    ['estado desconocido', { estado: 'ENTREGADA' }, 'estado', 'El estado debe ser uno de: EN_PROCESO, FINALIZADA, CANCELADA'],
    ['motivo que no es texto', { estado: 'FINALIZADA', motivo: 42 }, 'motivo', 'El motivo debe ser texto'],
    ['motivo de 501 caracteres', { estado: 'FINALIZADA', motivo: 'a'.repeat(501) }, 'motivo', 'El motivo admite máximo 500 caracteres'],
    ['devolverRepuestos como texto', { estado: 'CANCELADA', motivo: 'x', devolverRepuestos: 'si' }, 'devolverRepuestos', 'devolverRepuestos debe ser verdadero o falso'],
  ])('rechaza %s', (_, entrada, campo, mensaje) => {
    const resultado = validarCambioDeEstado(entrada);

    expect(resultado.valido).toBe(false);
    expect(resultado.errores).toContainEqual({ campo, mensaje });
  });

  test.each([[null], [undefined], ['FINALIZADA'], [['FINALIZADA']]])('con %p como entrada pide el estado', (entrada) => {
    expect(validarCambioDeEstado(entrada).errores.map((e) => e.campo)).toEqual(['estado']);
  });
});
