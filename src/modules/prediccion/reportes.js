/**
 * Reportes que se arman con el resultado de la predicción (funciones puras:
 * reciben la lista de predicciones y devuelven el reporte, sin base de datos).
 */
const SEMANAS_SIN_MOVIMIENTO = 12;
const SIN_PROVEEDOR = 'Sin proveedor registrado';

const redondear = (valor) => Math.round(valor * 100) / 100;
const mediana = (valores) => {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[mitad] : (ordenados[mitad - 1] + ordenados[mitad]) / 2;
};

/**
 * Compras sugeridas, agrupadas por proveedor: lo que hay que pedir hoy.
 * Primero lo más urgente (lo que se agota antes) dentro de cada proveedor.
 */
function comprasSugeridas(predicciones) {
  const porProveedor = new Map();
  predicciones
    .filter((p) => p.debePedir && p.cantidadSugerida > 0)
    .forEach((p) => {
      const proveedor = p.repuesto.proveedor || SIN_PROVEEDOR;
      if (!porProveedor.has(proveedor)) porProveedor.set(proveedor, []);
      porProveedor.get(proveedor).push({
        repuestoId: p.repuesto.id,
        sku: p.repuesto.sku,
        nombre: p.repuesto.nombre,
        stockActual: p.repuesto.stockActual,
        puntoDeReorden: p.puntoDeReorden,
        diasDeCobertura: p.diasDeCobertura,
        fechaDeQuiebre: p.fechaDeQuiebre,
        urgente: p.quiebreAntesDeReponer,
        cantidad: p.cantidadSugerida,
        costoUnitario: p.repuesto.costo,
        subtotal: redondear(p.cantidadSugerida * p.repuesto.costo),
      });
    });

  const dias = (item) => (item.diasDeCobertura === null ? Number.POSITIVE_INFINITY : item.diasDeCobertura);
  const proveedores = [...porProveedor]
    .map(([proveedor, items]) => ({
      proveedor,
      items: items.sort((a, b) => dias(a) - dias(b) || a.sku.localeCompare(b.sku)),
      unidades: items.reduce((suma, i) => suma + i.cantidad, 0),
      total: redondear(items.reduce((suma, i) => suma + i.subtotal, 0)),
    }))
    // El grupo sin proveedor va al final; el resto, en orden alfabético.
    .sort((a, b) => (a.proveedor === SIN_PROVEEDOR) - (b.proveedor === SIN_PROVEEDOR) || a.proveedor.localeCompare(b.proveedor, 'es'));

  return {
    proveedores,
    repuestos: proveedores.reduce((suma, p) => suma + p.items.length, 0),
    unidades: proveedores.reduce((suma, p) => suma + p.unidades, 0),
    urgentes: proveedores.reduce((suma, p) => suma + p.items.filter((i) => i.urgente).length, 0),
    total: redondear(proveedores.reduce((suma, p) => suma + p.total, 0)),
  };
}

/** Clasificación ABC: cuántos repuestos y cuánto valor de consumo concentra cada clase. */
function clasificacionAbc(predicciones) {
  const total = predicciones.reduce((suma, p) => suma + p.valorConsumoAnual, 0);
  let acumulado = 0;
  const items = [...predicciones]
    .sort((a, b) => b.valorConsumoAnual - a.valorConsumoAnual || a.repuesto.sku.localeCompare(b.repuesto.sku))
    .map((p) => {
      acumulado += p.valorConsumoAnual;
      return {
        repuestoId: p.repuesto.id,
        sku: p.repuesto.sku,
        nombre: p.repuesto.nombre,
        clase: p.claseAbc,
        valorConsumoAnual: redondear(p.valorConsumoAnual),
        participacion: total > 0 ? redondear(p.valorConsumoAnual / total) : 0,
        acumulado: total > 0 ? redondear(acumulado / total) : 0,
      };
    });
  const clases = ['A', 'B', 'C'].map((clase) => {
    const deLaClase = items.filter((i) => i.clase === clase);
    const valor = deLaClase.reduce((suma, i) => suma + i.valorConsumoAnual, 0);
    return { clase, repuestos: deLaClase.length, valor: redondear(valor), participacion: total > 0 ? redondear(valor / total) : 0 };
  });
  return { clases, items, total: redondear(total) };
}

/**
 * Repuestos sin movimiento: tienen unidades en el estante pero llevan tres
 * meses o más sin usarse (o nunca se han usado). Es plata quieta.
 */
function sinMovimiento(predicciones) {
  const items = predicciones
    .filter((p) => p.repuesto.stockActual > 0 && (p.historia.semanasSinConsumo === null || p.historia.semanasSinConsumo >= SEMANAS_SIN_MOVIMIENTO))
    .map((p) => ({
      repuestoId: p.repuesto.id,
      sku: p.repuesto.sku,
      nombre: p.repuesto.nombre,
      stockActual: p.repuesto.stockActual,
      semanasSinConsumo: p.historia.semanasSinConsumo,
      valorInmovilizado: redondear(p.repuesto.stockActual * p.repuesto.costo),
    }))
    .sort((a, b) => b.valorInmovilizado - a.valorInmovilizado || a.sku.localeCompare(b.sku));
  return { semanasDeCorte: SEMANAS_SIN_MOVIMIENTO, items, valorInmovilizado: redondear(items.reduce((suma, i) => suma + i.valorInmovilizado, 0)) };
}

/** Qué tan bien pronostica el modelo: su error y cuánto mejora frente a repetir la última semana. */
function precisionDelModelo(predicciones) {
  const items = predicciones.map((p) => ({
    repuestoId: p.repuesto.id,
    sku: p.repuesto.sku,
    nombre: p.repuesto.nombre,
    patron: p.patron,
    modelo: p.modelo,
    modeloNombre: p.modeloNombre,
    rmsse: p.metricas.rmsse,
    wape: p.metricas.wape,
    sesgo: p.metricas.sesgo,
    mejoraSobreIngenuo: p.metricas.mejoraSobreIngenuo,
    semanasDePrueba: p.metricas.semanasDePrueba,
    semanasDeHistoria: p.historia.semanas,
    aviso: p.aviso,
  })).sort((a, b) => a.sku.localeCompare(b.sku));

  const evaluados = items.filter((i) => i.rmsse !== null);
  const mejoras = evaluados.map((i) => i.mejoraSobreIngenuo).filter((m) => m !== null);
  const porModelo = {};
  items.forEach((i) => { porModelo[i.modeloNombre] = (porModelo[i.modeloNombre] || 0) + 1; });
  return {
    items,
    evaluados: evaluados.length,
    sinEvaluar: items.length - evaluados.length,
    superanAlIngenuo: mejoras.filter((m) => m > 0).length,
    mejoraMediana: mejoras.length ? redondear(mediana(mejoras)) : null,
    porModelo: Object.entries(porModelo).map(([modelo, repuestos]) => ({ modelo, repuestos })).sort((a, b) => b.repuestos - a.repuestos || a.modelo.localeCompare(b.modelo)),
  };
}

/**
 * Convierte un valor en una celda de CSV segura.
 * Además de las comillas, neutraliza la "inyección de fórmulas": una celda
 * que empieza por = + - @ (por ejemplo, el nombre de un proveedor escrito con
 * mala intención) se ejecutaría como fórmula al abrir el archivo en Excel.
 */
function celdaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return String(valor);
  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** Reporte de compras como CSV para Excel en español: separado por punto y coma y con marca de UTF-8. */
function comprasEnCsv(compras) {
  const filas = [['Proveedor', 'SKU', 'Repuesto', 'Stock actual', 'Se agota el', 'Cantidad sugerida', 'Costo unitario', 'Subtotal']];
  compras.proveedores.forEach((grupo) => {
    grupo.items.forEach((i) => {
      filas.push([grupo.proveedor, i.sku, i.nombre, i.stockActual, i.fechaDeQuiebre || '', i.cantidad, i.costoUnitario, i.subtotal]);
    });
  });
  filas.push(['Total', '', '', '', '', compras.unidades, '', compras.total]);
  return `﻿${filas.map((fila) => fila.map(celdaCsv).join(';')).join('\r\n')}\r\n`;
}

module.exports = { comprasSugeridas, clasificacionAbc, sinMovimiento, precisionDelModelo, comprasEnCsv, celdaCsv, SEMANAS_SIN_MOVIMIENTO };
