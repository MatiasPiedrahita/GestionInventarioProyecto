/**
 * Política de inventario aplicada al stock y a la fecha de hoy (funciones
 * puras, sin base de datos).
 *
 * El modelo de Python pronostica cuántas unidades se van a consumir cada
 * semana; eso solo cambia cuando se vuelve a ejecutar. En cambio, "cuánto
 * pedir", "para cuántos días alcanza" y "en qué fecha se agota" dependen
 * del stock, que cambia con cada orden y cada entrada de mercancía. Por eso
 * la aplicación repite ese cálculo cada vez que muestra una recomendación:
 * así una compra registrada hace un minuto ya se refleja.
 *
 * Es el MISMO cálculo de prediccion/taller_prediccion/inventario.py, con las
 * operaciones en el mismo orden para que los decimales coincidan. Con el
 * stock y la fecha del momento del cálculo, ambas versiones dan exactamente
 * lo mismo; lo vigila tests/integration/prediccion.python.test.js. Si
 * cambia una, hay que cambiar la otra.
 */
const DIAS_DE_COBERTURA = 30;
const DIAS_MAXIMOS_DE_PROYECCION = 180;
const DIA_MS = 24 * 3600 * 1000;

const aTiempo = (dia) => Date.parse(`${dia}T00:00:00Z`);

/** Días completos entre dos fechas AAAA-MM-DD. */
function diasEntre(desde, hasta) {
  return Math.round((aTiempo(hasta) - aTiempo(desde)) / DIA_MS);
}

function sumarDias(dia, dias) {
  return new Date(aTiempo(dia) + dias * DIA_MS).toISOString().slice(0, 10);
}

/**
 * Unidades esperadas en los próximos `dias`, repartiendo cada semana en siete días.
 * `desfase` son los días ya transcurridos de la primera semana del pronóstico (un jueves, 3).
 * Si los días superan el horizonte, se prolonga la última semana.
 */
function demandaEnDias(semanal, dias, desfase = 0) {
  if (semanal.length === 0 || dias <= 0) return 0;
  let total = 0;
  let restantes = dias;
  let posicion = desfase;
  while (restantes > 0) {
    const semana = Math.min(Math.floor(posicion / 7), semanal.length - 1);
    const hastaElDomingo = 7 - (posicion % 7);
    const tomados = Math.min(hastaElDomingo, restantes);
    total += (semanal[semana] * tomados) / 7;
    restantes -= tomados;
    posicion += hastaElDomingo;
  }
  return total;
}

/**
 * Días que dura el stock consumiéndose al ritmo pronosticado.
 * @returns {number | null} null si alcanza para más de seis meses (o si no se espera consumo).
 */
function diasHastaElQuiebre(semanal, stock, desfase = 0) {
  if (stock <= 0) return 0;
  let restante = stock;
  for (let dia = 0; dia < DIAS_MAXIMOS_DE_PROYECCION; dia += 1) {
    const semana = Math.min(Math.floor((dia + desfase) / 7), semanal.length - 1);
    const consumoDiario = semanal.length ? semanal[semana] / 7 : 0;
    if (consumoDiario > 0) {
      if (restante <= consumoDiario) return Math.round((dia + restante / consumoDiario) * 10) / 10;
      restante -= consumoDiario;
    }
  }
  return null;
}

/**
 * Decisiones de inventario de un repuesto con el stock de hoy.
 *
 * @param {object} datos
 * @param {number[]} datos.pronostico Unidades por semana que pronosticó el modelo.
 * @param {string | null} datos.primeraSemana Lunes (AAAA-MM-DD) de la primera semana del pronóstico.
 * @param {string} datos.hoy Fecha de hoy (AAAA-MM-DD).
 * @param {number} datos.stockActual
 * @param {number} datos.diasDeReposicion Días que tarda en llegar un pedido.
 * @param {number} datos.stockDeSeguridad Colchón que calculó el modelo (depende del error del pronóstico).
 */
function aplicarPolitica({ pronostico, primeraSemana, hoy, stockActual, diasDeReposicion, stockDeSeguridad }) {
  const desfase = primeraSemana ? Math.max(0, diasEntre(primeraSemana, hoy)) : 0;
  const hayDemanda = pronostico.reduce((suma, unidades) => suma + unidades, 0) > 0;

  const enReposicion = demandaEnDias(pronostico, diasDeReposicion, desfase);
  const puntoDeReorden = hayDemanda ? Math.max(0, Math.ceil(enReposicion + stockDeSeguridad - 1e-9)) : 0;
  const objetivo = demandaEnDias(pronostico, diasDeReposicion + DIAS_DE_COBERTURA, desfase) + stockDeSeguridad;
  let cantidadSugerida = hayDemanda ? Math.max(0, Math.ceil(objetivo - stockActual - 1e-9)) : 0;
  const debePedir = hayDemanda && stockActual <= puntoDeReorden;
  // Si hay que pedir, nunca son cero unidades: como mínimo, lo que deja el stock por encima del punto de reorden.
  if (debePedir) cantidadSugerida = Math.max(cantidadSugerida, puntoDeReorden + 1 - stockActual);

  const diasDeCobertura = diasHastaElQuiebre(pronostico, stockActual, desfase);
  return {
    demandaEnReposicion: Math.round(enReposicion * 100) / 100,
    puntoDeReorden,
    cantidadSugerida,
    debePedir,
    diasDeCobertura,
    fechaDeQuiebre: diasDeCobertura === null ? null : sumarDias(hoy, Math.floor(diasDeCobertura)),
    // Se agotaría antes de que alcance a llegar un pedido hecho hoy.
    quiebreAntesDeReponer: diasDeCobertura !== null && diasDeCobertura < diasDeReposicion,
  };
}

module.exports = { aplicarPolitica, demandaEnDias, diasHastaElQuiebre, DIAS_DE_COBERTURA, DIAS_MAXIMOS_DE_PROYECCION };
