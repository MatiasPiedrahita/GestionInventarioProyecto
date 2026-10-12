/* global window, document */
/**
 * Vista "Panel" (dueño y administrador): los números del negocio de un
 * vistazo. Los indicadores son cifras, no gráficos; los gráficos quedan para
 * lo que cambia en el tiempo o se compara entre repuestos.
 */
window.Taller.vistas.panel = (function crearVistaPanel() {
  const { api, dom, formato, graficos } = window.Taller;
  const $ = (selector) => document.querySelector(selector);

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const NOMBRES_DE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  /** "2026-10-05" → { corta: "5 oct", larga: "Semana del 5 de octubre" }. Sin Date: la fecha ya viene como día de calendario. */
  function semana(texto) {
    const [, mes, dia] = texto.split('-').map(Number);
    return { corta: `${dia} ${MESES[mes - 1]}`, larga: `Semana del ${dia} de ${NOMBRES_DE_MES[mes - 1]}` };
  }

  function mes(texto) {
    const [anio, numero] = texto.split('-').map(Number);
    return { corta: MESES[numero - 1], larga: `${NOMBRES_DE_MES[numero - 1]} de ${anio}` };
  }

  function indicador({ titulo, valor, nota, aviso }) {
    const tarjeta = dom.crear('div', { clase: 'indicador' });
    tarjeta.appendChild(dom.crear('p', { clase: 'indicador__titulo', texto: titulo }));
    tarjeta.appendChild(dom.crear('p', { clase: 'indicador__valor', texto: valor }));
    if (nota) {
      // El aviso lleva símbolo y texto: el estado nunca depende solo del color.
      const linea = dom.crear('p', { clase: aviso ? 'indicador__nota indicador__nota--aviso' : 'indicador__nota' });
      if (aviso) linea.appendChild(dom.crear('span', { clase: 'indicador__simbolo', texto: '!' }));
      linea.appendChild(document.createTextNode(nota));
      tarjeta.appendChild(linea);
    }
    return tarjeta;
  }

  function pintarIndicadores({ inventario, ordenes, gastoPorMes }, compras) {
    const gastoDelMes = gastoPorMes[gastoPorMes.length - 1];
    const stockBajo = inventario.bajoMinimo > 0
      ? `${plural(inventario.bajoMinimo, 'repuesto', 'repuestos')} en el mínimo o por debajo${inventario.agotados ? `, ${plural(inventario.agotados, 'agotado', 'agotados')}` : ''}`
      : 'Ningún repuesto por debajo del mínimo';

    $('#indicadores-panel').replaceChildren(
      indicador({
        titulo: 'Valor del inventario',
        valor: formato.pesos.format(inventario.valor),
        nota: `${plural(inventario.unidades, 'unidad', 'unidades')} en ${plural(inventario.repuestos, 'repuesto', 'repuestos')}`,
      }),
      indicador({ titulo: 'Stock por reponer', valor: String(inventario.bajoMinimo), nota: stockBajo, aviso: inventario.bajoMinimo > 0 }),
      indicador({
        titulo: 'Órdenes en proceso',
        valor: String(ordenes.enProceso),
        nota: `${plural(ordenes.finalizadasUltimos30Dias, 'finalizada', 'finalizadas')} en los últimos 30 días`,
      }),
      indicador({
        titulo: `Repuestos usados en ${mes(gastoDelMes.mes).larga}`,
        valor: formato.pesos.format(gastoDelMes.valor),
        nota: plural(gastoDelMes.unidades, 'unidad', 'unidades'),
      }),
      // Lo que la predicción de demanda sugiere invertir en compras (si ya se calculó).
      ...(compras ? [indicador({
        titulo: 'Compras sugeridas',
        valor: formato.pesos.format(compras.total),
        nota: compras.repuestos > 0 ? `${plural(compras.repuestos, 'repuesto', 'repuestos')} por pedir, según la predicción` : 'La predicción no sugiere compras hoy',
        aviso: compras.urgentes > 0,
      })] : []),
    );
  }

  function pintarMecanicos(mecanicos) {
    const cuerpo = $('#cuerpo-mecanicos');
    cuerpo.replaceChildren(...mecanicos.map((m) => {
      const fila = dom.crear('tr');
      fila.appendChild(dom.crear('td', { texto: m.activo ? m.nombre : `${m.nombre} (inactivo)` }));
      fila.appendChild(dom.crear('td', { clase: 'num', texto: m.enProceso }));
      fila.appendChild(dom.crear('td', { clase: 'num', texto: m.finalizadas }));
      fila.appendChild(dom.crear('td', { clase: 'num', texto: m.horasPromedio === null ? 'Sin datos' : formato.duracion(m.horasPromedio) }));
      return fila;
    }));
    if (mecanicos.length === 0) {
      const fila = dom.crear('tr');
      const celda = dom.crear('td', { clase: 'vacio', texto: 'Todavía no hay mecánicos registrados.' });
      celda.colSpan = 4;
      fila.appendChild(celda);
      cuerpo.appendChild(fila);
    }
  }

  function pintar(resumen, compras) {
    pintarIndicadores(resumen, compras);

    graficos.columnas($('#grafico-ordenes'), {
      datos: resumen.ordenesPorSemana.map((s) => ({ etiqueta: semana(s.semana).corta, descripcion: semana(s.semana).larga, valor: s.finalizadas })),
      columnas: ['Semana', 'Órdenes finalizadas'],
      formatoValor: (n) => String(n),
      vacio: 'Todavía no se ha finalizado ninguna orden en estas semanas.',
    });

    graficos.columnas($('#grafico-gasto'), {
      datos: resumen.gastoPorMes.map((m) => ({ etiqueta: mes(m.mes).corta, descripcion: mes(m.mes).larga, valor: m.valor })),
      columnas: ['Mes', 'Costo de repuestos usados'],
      formatoValor: (n) => formato.pesos.format(n),
      formatoEje: (n) => formato.pesosCortos(n),
      vacio: 'Todavía no se han usado repuestos en órdenes.',
    });

    graficos.barras($('#grafico-repuestos'), {
      datos: resumen.repuestosMasUsados.map((r) => ({
        etiqueta: r.nombre, detalle: r.sku, valor: r.unidades, nota: `Costo: ${formato.pesos.format(r.valor)}`,
      })),
      columnas: ['Repuesto', 'Unidades', 'Costo'],
      vacio: 'Todavía no se han usado repuestos en órdenes.',
    });

    pintarMecanicos(resumen.mecanicos);
    $('#resumen-panel').textContent = `Actualizado: ${formato.fechas.format(new Date(resumen.generadoEn))}`;
  }

  async function cargar() {
    const aviso = $('#aviso-panel');
    aviso.textContent = '';
    try {
      // La predicción es opcional: si todavía no se ha calculado, el panel se muestra sin esa tarjeta.
      const [resumen, compras] = await Promise.all([
        api.pedir('/api/panel/resumen'),
        api.pedir('/api/prediccion/reportes').then((reportes) => reportes.compras).catch(() => null),
      ]);
      pintar(resumen, compras);
    } catch (error) {
      dom.aviso(aviso, `No se pudo cargar el panel: ${error.message}`, 'error');
    }
  }

  $('#boton-actualizar-panel').addEventListener('click', cargar);

  return { alMostrar: cargar };
}());
