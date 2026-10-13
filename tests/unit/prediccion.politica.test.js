const { aplicarPolitica, demandaEnDias, diasHastaElQuiebre } = require('../../src/modules/prediccion/politica');

const LUNES = '2026-10-12';
const SIETE_POR_SEMANA = Array(8).fill(7); // una unidad diaria

/** Política con valores razonables; cada prueba cambia solo lo que le interesa. */
function politica(cambios = {}) {
  return aplicarPolitica({
    pronostico: SIETE_POR_SEMANA, primeraSemana: LUNES, hoy: LUNES, stockActual: 10, diasDeReposicion: 7, stockDeSeguridad: 4, ...cambios,
  });
}

describe('demandaEnDias (unitarias)', () => {
  test.each([
    [[7, 14], 7, 0, 7],
    [[7, 14], 10, 0, 7 + (14 * 3) / 7],
    [[7, 14], 14, 0, 21],
    [[7], 14, 0, 14], // más allá del horizonte se prolonga la última semana
    [[7, 14], 0, 0, 0],
    [[], 10, 0, 0],
    [[7, 14], 7, 3, 4 * 1 + 3 * 2], // jueves: cuatro días de la primera semana y tres de la segunda
    [[7, 14], 4, 3, 4], // de jueves a domingo: todo sale de la primera semana
    [[7, 14], 5, 6, 1 * 1 + 4 * 2], // domingo: un día de la primera semana y cuatro de la segunda
    [[7, 14], 7, 7, 14], // el desfase ya consumió la primera semana entera
    [[7, 14], 7, 21, 14], // pronóstico vencido: se prolonga la última semana
  ])('pronóstico %j, %i días, desfase %i → %f unidades', (pronostico, dias, desfase, esperado) => {
    expect(demandaEnDias(pronostico, dias, desfase)).toBeCloseTo(esperado, 9);
  });
});

describe('diasHastaElQuiebre (unitarias)', () => {
  test('sigue el pronóstico semana a semana', () => {
    // Semana 1: 1 al día. Semana 2: 2 al día. Con 11 en stock: 7 días + 2 días.
    expect(diasHastaElQuiebre([7, 14], 11)).toBe(9);
  });

  test('un jueves, la semana en curso solo aporta los días que le quedan', () => {
    // De jueves a domingo se gastan 4; los 7 restantes duran 3,5 días de la semana siguiente.
    expect(diasHastaElQuiebre([7, 14], 11, 3)).toBe(7.5);
  });

  test('sin stock el quiebre es hoy; sin consumo esperado o con stock para más de seis meses no hay fecha', () => {
    expect(diasHastaElQuiebre(SIETE_POR_SEMANA, 0)).toBe(0);
    expect(diasHastaElQuiebre([0, 0], 5)).toBeNull();
    expect(diasHastaElQuiebre([], 5)).toBeNull();
    expect(diasHastaElQuiebre(Array(8).fill(0.07), 50)).toBeNull();
  });
});

describe('aplicarPolitica (unitarias)', () => {
  test('ejemplo completo calculado a mano', () => {
    // Una unidad diaria, colchón de 4, reposición en 7 días, stock 10.
    expect(politica()).toEqual({
      demandaEnReposicion: 7,
      puntoDeReorden: 11, // 7 + 4
      cantidadSugerida: 31, // 37 días de demanda + 4 de colchón − 10 en stock
      debePedir: true, // 10 <= 11
      diasDeCobertura: 10,
      fechaDeQuiebre: '2026-10-22',
      quiebreAntesDeReponer: false,
    });
  });

  test('con el mismo pronóstico, la recomendación cambia con el stock', () => {
    const escaso = politica({ stockActual: 3 });
    const recienLlegado = politica({ stockActual: 60 });

    expect(escaso).toMatchObject({ debePedir: true, cantidadSugerida: 38, diasDeCobertura: 3, quiebreAntesDeReponer: true });
    expect(recienLlegado).toMatchObject({ debePedir: false, cantidadSugerida: 0, diasDeCobertura: 60, fechaDeQuiebre: '2026-12-11', quiebreAntesDeReponer: false });
    // El punto de reorden no depende del stock.
    expect(escaso.puntoDeReorden).toBe(recienLlegado.puntoDeReorden);
  });

  test('la fecha de quiebre se cuenta desde hoy, no desde el día en que se calculó el pronóstico', () => {
    const elJueves = politica({ hoy: '2026-10-15', stockActual: 5 });

    expect(elJueves).toMatchObject({ diasDeCobertura: 5, fechaDeQuiebre: '2026-10-20', quiebreAntesDeReponer: true });
  });

  test('a mitad de semana toma de cada semana del pronóstico solo los días que le tocan', () => {
    // Semana del 12: 1 al día. Desde el 19: 2 al día. Un jueves, la reposición de 7 días gasta 4 + 6.
    const resultado = politica({ pronostico: [7, 14, 14, 14], hoy: '2026-10-15', stockActual: 11, stockDeSeguridad: 0 });

    expect(resultado).toMatchObject({ demandaEnReposicion: 10, puntoDeReorden: 10, diasDeCobertura: 7.5, fechaDeQuiebre: '2026-10-22' });
  });

  test('con un pronóstico que ya venció se prolonga su última semana', () => {
    const tresMesesDespues = politica({ pronostico: [7, 14], hoy: '2027-01-11', stockActual: 4, stockDeSeguridad: 0 });

    expect(tresMesesDespues).toMatchObject({ demandaEnReposicion: 14, diasDeCobertura: 2, fechaDeQuiebre: '2027-01-13' });
  });

  test('si hay que pedir, nunca sugiere cero unidades', () => {
    // Una batería: sale una cada seis semanas. Punto de reorden = techo(0,16 + 1) = 2 y objetivo = techo(0,85 + 1) = 2.
    const bateria = politica({ pronostico: Array(8).fill(0.16), stockActual: 2, stockDeSeguridad: 1 });

    expect(bateria).toMatchObject({ puntoDeReorden: 2, debePedir: true, cantidadSugerida: 1 });
  });

  test('sin demanda esperada no sugiere comprar nada', () => {
    expect(politica({ pronostico: Array(8).fill(0), stockActual: 8, stockDeSeguridad: 0 })).toEqual({
      demandaEnReposicion: 0, puntoDeReorden: 0, cantidadSugerida: 0, debePedir: false, diasDeCobertura: null, fechaDeQuiebre: null, quiebreAntesDeReponer: false,
    });
    expect(politica({ pronostico: [], primeraSemana: null, stockActual: 0, stockDeSeguridad: 0 })).toMatchObject({ debePedir: false, cantidadSugerida: 0, diasDeCobertura: 0 });
  });

  test('las cantidades siempre son enteros no negativos, y pedir implica pedir al menos una unidad', () => {
    let semilla = 20261012;
    const azar = () => {
      semilla = (semilla * 1103515245 + 12345) % 2147483648;
      return semilla / 2147483648;
    };
    for (let i = 0; i < 300; i += 1) {
      const escala = [0.02, 0.2, 1][Math.floor(azar() * 3)];
      const resultado = politica({
        pronostico: Array.from({ length: 8 }, () => Math.round(azar() * 12 * escala * 100) / 100),
        hoy: `2026-10-${12 + Math.floor(azar() * 14)}`,
        stockActual: Math.floor(azar() * 80),
        diasDeReposicion: 1 + Math.floor(azar() * 45),
        stockDeSeguridad: Math.floor(azar() * 6),
      });

      expect(Number.isInteger(resultado.puntoDeReorden) && resultado.puntoDeReorden >= 0).toBe(true);
      expect(Number.isInteger(resultado.cantidadSugerida) && resultado.cantidadSugerida >= 0).toBe(true);
      if (resultado.debePedir) expect(resultado.cantidadSugerida).toBeGreaterThanOrEqual(1);
    }
  });
});
