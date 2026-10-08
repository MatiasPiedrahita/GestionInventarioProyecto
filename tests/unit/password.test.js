const { hashearPassword, verificarPassword } = require('../../src/modules/auth/password');

describe('hash de contraseñas (unitarias)', () => {
  test('verifica la contraseña correcta y rechaza una incorrecta', () => {
    const guardado = hashearPassword('taller-2026');

    expect(verificarPassword('taller-2026', guardado)).toBe(true);
    expect(verificarPassword('taller-2025', guardado)).toBe(false);
  });

  test('nunca guarda la contraseña en claro y usa una sal distinta cada vez', () => {
    const a = hashearPassword('taller-2026');
    const b = hashearPassword('taller-2026');

    expect(a).not.toContain('taller-2026');
    expect(a).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(a).not.toBe(b);
  });

  test('rechaza hashes con formato inválido o entradas que no son texto', () => {
    expect(verificarPassword('x', 'md5$abc$def')).toBe(false);
    expect(verificarPassword('x', 'basura')).toBe(false);
    expect(verificarPassword(undefined, hashearPassword('x'))).toBe(false);
  });
});
