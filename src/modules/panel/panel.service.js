const { aFechaSql, ultimasSemanas, ultimosMeses, haceDias } = require('./periodos');
const { ESTADOS } = require('../ordenes/estados');

const SEMANAS = 8;
const MESES = 6;
const DIAS_DE_ACTIVIDAD = 30;
const DIAS_DE_CONSUMO = 90;
const REPUESTOS_MAS_USADOS = 8;

const redondear = (valor, decimales = 0) => {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
};

/**
 * Panel del dueño: los números del negocio en una sola consulta.
 * Las semanas y los meses sin movimiento se devuelven en cero, para que los
 * gráficos muestren el hueco en lugar de saltárselo.
 */
function crearServicioPanel(repositorio, { ahora = () => new Date() } = {}) {
  return {
    resumen() {
      const momento = ahora();
      const semanas = ultimasSemanas(momento, SEMANAS);
      const meses = ultimosMeses(momento, MESES);
      const desdeSemanas = `${semanas[0]} 00:00:00`;
      const desdeMeses = `${meses[0]}-01 00:00:00`;
      const desdeActividad = aFechaSql(haceDias(momento, DIAS_DE_ACTIVIDAD));

      const inventario = repositorio.inventario();
      const porEstado = Object.fromEntries(repositorio.ordenesPorEstado().map((f) => [f.estado, f.cantidad]));
      const creadas = Object.fromEntries(repositorio.creadasPorSemana(desdeSemanas).map((f) => [f.semana, f.cantidad]));
      const finalizadas = Object.fromEntries(repositorio.finalizadasPorSemana(desdeSemanas).map((f) => [f.semana, f.cantidad]));
      const gasto = Object.fromEntries(repositorio.gastoPorMes(desdeMeses).map((f) => [f.mes, f]));

      return {
        generadoEn: momento.toISOString(),
        inventario: {
          repuestos: inventario.repuestos,
          unidades: inventario.unidades,
          valor: redondear(inventario.valor),
          bajoMinimo: inventario.bajoMinimo,
          agotados: inventario.agotados,
        },
        ordenes: {
          enProceso: porEstado[ESTADOS.EN_PROCESO] || 0,
          finalizadas: porEstado[ESTADOS.FINALIZADA] || 0,
          canceladas: porEstado[ESTADOS.CANCELADA] || 0,
          finalizadasUltimos30Dias: repositorio.contarFinalizadasDesde(desdeActividad),
        },
        ordenesPorSemana: semanas.map((semana) => ({
          semana,
          creadas: creadas[semana] || 0,
          finalizadas: finalizadas[semana] || 0,
        })),
        gastoPorMes: meses.map((mes) => ({
          mes,
          valor: redondear(gasto[mes] ? gasto[mes].valor : 0),
          unidades: gasto[mes] ? gasto[mes].unidades : 0,
        })),
        repuestosMasUsados: repositorio
          .masUsados(aFechaSql(haceDias(momento, DIAS_DE_CONSUMO)), REPUESTOS_MAS_USADOS)
          .map((r) => ({ ...r, valor: redondear(r.valor) })),
        mecanicos: repositorio.porMecanico(desdeActividad).map((m) => ({
          ...m,
          horasPromedio: m.horasPromedio === null ? null : redondear(m.horasPromedio, 1),
        })),
        periodos: { semanas: SEMANAS, meses: MESES, diasDeActividad: DIAS_DE_ACTIVIDAD, diasDeConsumo: DIAS_DE_CONSUMO },
      };
    },
  };
}

module.exports = { crearServicioPanel };
