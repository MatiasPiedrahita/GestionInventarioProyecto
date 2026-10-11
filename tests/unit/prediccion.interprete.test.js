const path = require('node:path');
const { resolverPython, CARPETA_DEL_MODELO, RAIZ } = require('../../src/modules/prediccion/interprete');

describe('resolverPython · con qué Python se ejecuta el modelo (unitarias)', () => {
  const raiz = path.join('proyecto');

  test('si el .env trae PYTHON_BIN, se usa ese y no se mira nada más', () => {
    const existe = jest.fn(() => true);

    expect(resolverPython({ entorno: { PYTHON_BIN: 'C:/Python312/python.exe' }, raiz, existe })).toEqual({
      ejecutable: 'C:/Python312/python.exe', origen: 'variable PYTHON_BIN',
    });
    expect(existe).not.toHaveBeenCalled();
  });

  test('en Windows usa el entorno virtual del proyecto si existe', () => {
    const esperado = path.join(raiz, '.venv', 'Scripts', 'python.exe');

    const resultado = resolverPython({ entorno: {}, raiz, existe: (ruta) => ruta === esperado, plataforma: 'win32' });

    expect(resultado).toEqual({ ejecutable: esperado, origen: 'entorno virtual del proyecto (.venv)' });
  });

  test('en Linux y macOS el entorno virtual está en .venv/bin', () => {
    const esperado = path.join(raiz, '.venv', 'bin', 'python');

    const resultado = resolverPython({ entorno: {}, raiz, existe: (ruta) => ruta === esperado, plataforma: 'linux' });

    expect(resultado.ejecutable).toBe(esperado);
  });

  test.each([['win32', 'python'], ['linux', 'python3'], ['darwin', 'python3']])(
    'sin entorno virtual en %s recurre al Python del sistema (%s)',
    (plataforma, ejecutable) => {
      expect(resolverPython({ entorno: {}, raiz, existe: () => false, plataforma })).toEqual({ ejecutable, origen: 'Python del sistema' });
    },
  );

  test('la carpeta del modelo es "prediccion", en la raíz del proyecto', () => {
    expect(CARPETA_DEL_MODELO).toBe(path.join(RAIZ, 'prediccion'));
    expect(require('node:fs').existsSync(path.join(CARPETA_DEL_MODELO, 'taller_prediccion', '__main__.py'))).toBe(true);
  });
});
