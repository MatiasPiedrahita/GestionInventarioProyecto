const { validarDatosDeUsuario } = require('../../src/modules/usuarios/usuario.validator');
const { validarFiltrosDeAuditoria } = require('../../src/modules/auditoria/auditoria.filtros.validator');
const { normalizarEmail } = require('../../src/modules/auth/email');
const { generarPasswordTemporal } = require('../../src/modules/usuarios/usuario.service');
const { problemaDePassword } = require('../../src/modules/auth/password');

describe('validarDatosDeUsuario (unitarias)', () => {
  test('acepta y normaliza nombre, rol y correo', () => {
    expect(validarDatosDeUsuario({ nombre: '  Andrés Gómez ', rol: 'mecanico', email: ' Andres@Taller.co ' })).toEqual({
      valido: true, errores: [], valor: { nombre: 'Andrés Gómez', rol: 'mecanico', email: 'andres@taller.co' },
    });
  });

  test('el correo es opcional', () => {
    expect(validarDatosDeUsuario({ nombre: 'Laura', rol: 'recepcionista' }).valor.email).toBeNull();
    expect(validarDatosDeUsuario({ nombre: 'Laura', rol: 'recepcionista', email: '  ' }).valor.email).toBeNull();
  });

  test.each([
    ['sin nombre', { rol: 'mecanico' }, 'nombre', 'El nombre es obligatorio'],
    ['nombre que no es texto', { nombre: 7, rol: 'mecanico' }, 'nombre', 'El nombre es obligatorio'],
    ['nombre de 81 caracteres', { nombre: 'a'.repeat(81), rol: 'mecanico' }, 'nombre', 'El nombre admite máximo 80 caracteres'],
    ['rol inexistente', { nombre: 'Ana', rol: 'jefe' }, 'rol', 'El rol debe ser uno de: dueno, mecanico, recepcionista, administrador'],
    ['correo inválido', { nombre: 'Ana', rol: 'mecanico', email: 'ana.taller.co' }, 'email', 'El correo no es válido'],
  ])('rechaza %s', (_, entrada, campo, mensaje) => {
    expect(validarDatosDeUsuario(entrada).errores).toContainEqual({ campo, mensaje });
  });

  test.each([[null], [undefined], ['texto'], [[]]])('con %p como entrada informa nombre y rol', (entrada) => {
    expect(validarDatosDeUsuario(entrada).errores.map((e) => e.campo)).toEqual(['nombre', 'rol']);
  });
});

describe('normalizarEmail (unitarias)', () => {
  test.each([[undefined], [null], [''], ['   ']])('%p es un correo vacío válido', (valor) => {
    expect(normalizarEmail(valor)).toEqual({ valor: null, error: null });
  });

  test.each([['sin-arroba'], ['a@b'], ['con espacio@taller.co'], [`${'a'.repeat(120)}@taller.co`], [42], [{}]])('rechaza %p', (valor) => {
    expect(normalizarEmail(valor)).toEqual({ valor: null, error: 'El correo no es válido' });
  });
});

describe('generarPasswordTemporal (unitarias)', () => {
  test('genera 12 caracteres sin los que se confunden al dictarlos y cumple la política', () => {
    const generadas = Array.from({ length: 200 }, generarPasswordTemporal);

    generadas.forEach((password) => {
      expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{12}$/);
      expect(problemaDePassword(password, { usuario: 'mecanico1' })).toBeNull();
    });
    expect(new Set(generadas).size).toBe(200);
  });
});

describe('validarFiltrosDeAuditoria (unitarias)', () => {
  test('sin filtros: página 1 y 20 por página', () => {
    expect(validarFiltrosDeAuditoria({}).valor).toEqual({ usuarioId: null, accion: null, desde: null, hasta: null, pagina: 1, tamano: 20 });
    expect(validarFiltrosDeAuditoria().valido).toBe(true);
  });

  test('normaliza la acción y convierte los números', () => {
    const { valor } = validarFiltrosDeAuditoria({ usuarioId: '3', accion: 'login_fallido', desde: '2026-10-01', hasta: '2026-10-31', pagina: '2', tamano: '50' });

    expect(valor).toEqual({ usuarioId: 3, accion: 'LOGIN_FALLIDO', desde: '2026-10-01', hasta: '2026-10-31', pagina: 2, tamano: 50 });
  });

  test.each([
    [{ usuarioId: 'abc' }, 'usuarioId'],
    [{ accion: 'BORRAR_TODO' }, 'accion'],
    [{ desde: '01/10/2026' }, 'desde'],
    [{ hasta: '2026-13-45' }, 'hasta'],
    [{ desde: '2026-10-31', hasta: '2026-10-01' }, 'hasta'],
    [{ pagina: '0' }, 'pagina'],
    [{ tamano: '101' }, 'tamano'],
  ])('rechaza %p', (query, campo) => {
    const { valido, errores } = validarFiltrosDeAuditoria(query);

    expect(valido).toBe(false);
    expect(errores.map((e) => e.campo)).toEqual([campo]);
  });
});
