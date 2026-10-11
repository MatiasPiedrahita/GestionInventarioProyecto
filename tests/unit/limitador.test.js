const { crearLimitador } = require('../../src/shared/limitador');
const { problemaDePassword } = require('../../src/modules/auth/password');

describe('crearLimitador (unitarias)', () => {
  let reloj;
  const ahora = () => reloj;
  const avanzar = (segundos) => { reloj = new Date(reloj.getTime() + segundos * 1000); };

  beforeEach(() => {
    reloj = new Date('2026-10-12T08:00:00Z');
  });

  test('no bloquea antes de llegar al máximo y bloquea al alcanzarlo', () => {
    const limitador = crearLimitador({ maximo: 3, ventanaMs: 60000, ahora });

    expect(limitador.registrarFallo('ana')).toBe(1);
    expect(limitador.registrarFallo('ana')).toBe(2);
    expect(limitador.segundosDeBloqueo('ana')).toBe(0);
    expect(limitador.registrarFallo('ana')).toBe(3);
    expect(limitador.segundosDeBloqueo('ana')).toBe(60);
  });

  test('el tiempo de espera baja con el reloj y el bloqueo termina cuando acaba la ventana', () => {
    const limitador = crearLimitador({ maximo: 1, ventanaMs: 60000, ahora });
    limitador.registrarFallo('ana');

    avanzar(45);
    expect(limitador.segundosDeBloqueo('ana')).toBe(15);
    avanzar(15);
    expect(limitador.segundosDeBloqueo('ana')).toBe(0);
    // Pasada la ventana la cuenta empieza de cero.
    expect(limitador.registrarFallo('ana')).toBe(1);
  });

  test('cada clave lleva su propia cuenta y limpiar la reinicia', () => {
    const limitador = crearLimitador({ maximo: 2, ventanaMs: 60000, ahora });
    limitador.registrarFallo('ana');
    limitador.registrarFallo('ana');

    expect(limitador.segundosDeBloqueo('ana')).toBeGreaterThan(0);
    expect(limitador.segundosDeBloqueo('luis')).toBe(0);
    limitador.limpiar('ana');
    expect(limitador.segundosDeBloqueo('ana')).toBe(0);
  });

  test('no crece sin límite: al llenarse descarta registros vencidos o el más antiguo', () => {
    const limitador = crearLimitador({ maximo: 1, ventanaMs: 60000, ahora, maximoDeClaves: 3 });
    limitador.registrarFallo('a');
    limitador.registrarFallo('b');
    limitador.registrarFallo('c');

    limitador.registrarFallo('d');
    expect(limitador.segundosDeBloqueo('a')).toBe(0);
    expect(limitador.segundosDeBloqueo('d')).toBe(60);

    avanzar(61);
    limitador.registrarFallo('e');
    expect(['b', 'c', 'd'].map((clave) => limitador.segundosDeBloqueo(clave))).toEqual([0, 0, 0]);
  });
});

describe('problemaDePassword · política de contraseñas (unitarias)', () => {
  test.each([
    ['una frase larga', 'caballo-bateria-grapa'],
    ['exactamente 8 caracteres', 'Ab3$xy9z'],
    ['128 caracteres', 'ab'.repeat(64)],
  ])('acepta %s', (_, password) => {
    expect(problemaDePassword(password, { usuario: 'andres' })).toBeNull();
  });

  test.each([
    ['menos de 8 caracteres', 'abc1234', 'La contraseña debe tener al menos 8 caracteres'],
    ['algo que no es texto', 12345678, 'La contraseña debe tener al menos 8 caracteres'],
    ['undefined', undefined, 'La contraseña debe tener al menos 8 caracteres'],
    ['más de 128 caracteres', 'ab'.repeat(65), 'La contraseña admite máximo 128 caracteres'],
    ['solo espacios', '         ', 'La contraseña no puede ser solo espacios'],
    ['el nombre de usuario', 'Mecanico.Uno', 'La contraseña no puede ser igual al nombre de usuario'],
    ['un solo carácter repetido', 'aaaaaaaaaa', 'La contraseña no puede repetir un solo carácter'],
  ])('rechaza %s', (_, password, mensaje) => {
    expect(problemaDePassword(password, { usuario: 'mecanico.uno' })).toBe(mensaje);
  });
});
