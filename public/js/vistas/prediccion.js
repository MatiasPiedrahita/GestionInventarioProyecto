/* global window, document */
/**
 * Vista "Predicción" (administrador y dueño): ejecutar el modelo y
 * aprovechar su resultado (HU-09). Cinco reportes sobre la misma predicción:
 * compras sugeridas, todos los repuestos, clasificación ABC, repuestos sin
 * movimiento y precisión del modelo. El detalle de cada repuesto muestra su
 * historia de consumo junto al pronóstico.
 */
window.Taller.vistas.prediccion = (function crearVistaPrediccion() {
  const { api, dom, formato, graficos } = window.Taller;
  const $ = (selector) => document.querySelector(selector);

  const aviso = $('#aviso-prediccion');
  const formulario = $('#formulario-prediccion');
  const dialogo = $('#dialogo-prediccion');
  const PESTANAS = ['compras', 'repuestos', 'abc', 'quietos', 'precision'];
  const ESPERAS_DEL_SONDEO = [300, 1000, 1500];
  let predicciones = [];
  let abierta = null;
  let sondeo = null;

  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const NOMBRE_PATRON = { SUAVE: 'Constante', ERRATICA: 'Variable', INTERMITENTE: 'Esporádica', IRREGULAR: 'Esporádica y variable', SIN_CONSUMO: 'Sin consumo' };
  const NOMBRE_TENDENCIA = { CRECE: 'Sube', BAJA: 'Baja', ESTABLE: 'Estable', SIN_DATOS: 'Sin datos' };

  // ------------------------------------------------------------ utilidades
  function celda(fila, contenido, { clase, detalle } = {}) {
    const td = dom.crear('td', { clase });
    if (contenido instanceof window.Node) td.appendChild(contenido);
    else td.textContent = contenido;
    if (detalle) td.appendChild(dom.crear('span', { clase: 'detalle', texto: detalle }));
    fila.appendChild(td);
    return td;
  }

  function vacio(cuerpo, columnas, texto) {
    const fila = dom.crear('tr');
    const td = dom.crear('td', { clase: 'vacio', texto });
    td.colSpan = columnas;
    fila.appendChild(td);
    cuerpo.replaceChildren(fila);
  }

  /** "Se agota el 17 oct (5 días)", "Hoy", o "Más de 6 meses". */
  function cobertura(p) {
    if (p.diasDeCobertura === null) return 'Más de 6 meses';
    if (p.diasDeCobertura < 1) return 'Se agota hoy';
    return `${Math.floor(p.diasDeCobertura)} ${Math.floor(p.diasDeCobertura) === 1 ? 'día' : 'días'}`;
  }

  function indicador({ titulo, valor, nota, alerta }) {
    const tarjeta = dom.crear('div', { clase: 'indicador' });
    tarjeta.appendChild(dom.crear('p', { clase: 'indicador__titulo', texto: titulo }));
    tarjeta.appendChild(dom.crear('p', { clase: 'indicador__valor', texto: valor }));
    const linea = dom.crear('p', { clase: alerta ? 'indicador__nota indicador__nota--aviso' : 'indicador__nota' });
    if (alerta) linea.appendChild(dom.crear('span', { clase: 'indicador__simbolo', texto: '!' }));
    linea.appendChild(document.createTextNode(nota));
    tarjeta.appendChild(linea);
    return tarjeta;
  }

  // --------------------------------------------------------------- reportes
  function pintarIndicadores({ compras, sinMovimiento, precision }) {
    $('#indicadores-prediccion').replaceChildren(
      indicador({ titulo: 'Repuestos por pedir', valor: String(compras.repuestos), nota: `${plural(compras.unidades, 'unidad', 'unidades')} en total` }),
      indicador({ titulo: 'Inversión sugerida', valor: formato.pesos.format(compras.total), nota: 'Para cubrir la reposición y 30 días más' }),
      indicador({
        titulo: 'Se agotan antes de reponer',
        valor: String(compras.urgentes),
        nota: compras.urgentes > 0 ? 'No alcanzan hasta que llegue el pedido' : 'Ninguno: todo alcanza hasta el próximo pedido',
        alerta: compras.urgentes > 0,
      }),
      indicador({
        titulo: 'Plata quieta',
        valor: formato.pesos.format(sinMovimiento.valorInmovilizado),
        nota: `${plural(sinMovimiento.items.length, 'repuesto', 'repuestos')} sin usarse en ${sinMovimiento.semanasDeCorte} semanas o más`,
      }),
      indicador({
        titulo: 'Acierto del modelo',
        valor: precision.evaluados ? `${precision.superanAlIngenuo} de ${precision.evaluados}` : 'Sin datos',
        nota: precision.mejoraMediana === null
          ? 'Todavía no hay historia suficiente para medirlo'
          : `pronostican mejor que repetir la última semana (${formato.porcentaje(precision.mejoraMediana)} menos de error, en la mediana)`,
      }),
    );
  }

  function pintarCompras(compras) {
    const lista = $('#lista-compras');
    $('#boton-exportar-compras').hidden = compras.repuestos === 0;
    if (compras.repuestos === 0) {
      lista.replaceChildren(dom.crear('p', { clase: 'grafico__vacio', texto: 'No hay nada que pedir hoy: el stock alcanza hasta la próxima reposición.' }));
      return;
    }
    lista.replaceChildren(...compras.proveedores.map((grupo) => {
      const bloque = dom.crear('section', { clase: 'proveedor' });
      const cabecera = dom.crear('div', { clase: 'proveedor__cabecera' });
      cabecera.appendChild(dom.crear('h3', { texto: grupo.proveedor }));
      cabecera.appendChild(dom.crear('p', { clase: 'proveedor__total', texto: `${plural(grupo.unidades, 'unidad', 'unidades')} · ${formato.pesos.format(grupo.total)}` }));
      bloque.appendChild(cabecera);

      const tabla = dom.crear('table', { clase: 'tabla-compacta' });
      const cabeza = dom.crear('thead');
      const titulos = dom.crear('tr');
      [['Repuesto', ''], ['En stock', 'num'], ['Alcanza para', ''], ['Pedir', 'num'], ['Costo unitario', 'num'], ['Subtotal', 'num']].forEach(([texto, clase]) => {
        const th = dom.crear('th', { texto, clase });
        th.scope = 'col';
        titulos.appendChild(th);
      });
      cabeza.appendChild(titulos);
      tabla.appendChild(cabeza);
      const cuerpo = dom.crear('tbody');
      grupo.items.forEach((item) => {
        const fila = dom.crear('tr');
        fila.dataset.sku = item.sku;
        celda(fila, dom.crear('span', { clase: 'sku', texto: item.sku }), { detalle: item.nombre });
        celda(fila, item.stockActual, { clase: 'num' });
        const alcance = celda(fila, cobertura(item), { detalle: item.fechaDeQuiebre ? `Hasta el ${formato.dia(item.fechaDeQuiebre)}` : null });
        if (item.urgente) alcance.insertBefore(dom.crear('span', { clase: 'estado alerta--agotado', texto: 'Urgente' }), alcance.firstChild);
        celda(fila, item.cantidad, { clase: 'num fuerte' });
        celda(fila, formato.pesos.format(item.costoUnitario), { clase: 'num' });
        celda(fila, formato.pesos.format(item.subtotal), { clase: 'num' });
        cuerpo.appendChild(fila);
      });
      tabla.appendChild(cuerpo);
      const envoltura = dom.crear('div', { clase: 'tabla-contenedor' });
      envoltura.appendChild(tabla);
      bloque.appendChild(envoltura);
      return bloque;
    }));
  }

  function pintarRepuestos() {
    const cuerpo = $('#cuerpo-prediccion');
    if (predicciones.length === 0) {
      vacio(cuerpo, 7, 'No hay repuestos en la predicción.');
      return;
    }
    cuerpo.replaceChildren(...predicciones.map((p) => {
      const fila = dom.crear('tr');
      fila.dataset.repuesto = p.repuesto.id;
      celda(fila, dom.crear('span', { clase: 'sku', texto: p.repuesto.sku }), { detalle: p.repuesto.nombre });
      celda(fila, NOMBRE_PATRON[p.patron] || p.patron, { detalle: p.modeloNombre });
      celda(fila, formato.unidades(p.demandaTotal), { clase: 'num', detalle: `${formato.unidades(p.demandaDiaria * 7)} por semana` });
      celda(fila, p.repuesto.stockActual, { clase: 'num', detalle: `Mínimo ${p.repuesto.stockMinimo}` });
      celda(fila, cobertura(p), { detalle: p.fechaDeQuiebre ? `Hasta el ${formato.dia(p.fechaDeQuiebre)}` : null });
      celda(fila, p.debePedir ? `Pedir ${p.cantidadSugerida}` : 'No hace falta', { clase: p.debePedir ? 'fuerte' : '', detalle: `Punto de reorden ${p.puntoDeReorden}` });
      const acciones = dom.crear('td');
      const ver = dom.crear('button', { clase: 'boton boton--secundario boton--chico', texto: 'Ver pronóstico' });
      ver.type = 'button';
      ver.dataset.ver = p.repuesto.id;
      ver.setAttribute('aria-label', `Ver el pronóstico de ${p.repuesto.sku}`);
      acciones.appendChild(ver);
      fila.appendChild(acciones);
      return fila;
    }));
  }

  function pintarAbc(abc) {
    $('#resumen-abc').replaceChildren(...abc.clases.map((clase) => {
      const tarjeta = dom.crear('div', { clase: 'clase-abc' });
      tarjeta.appendChild(dom.crear('span', { clase: `insignia-abc insignia-abc--${clase.clase.toLowerCase()}`, texto: clase.clase }));
      tarjeta.appendChild(dom.crear('strong', { texto: formato.porcentaje(clase.participacion) }));
      tarjeta.appendChild(dom.crear('span', { clase: 'detalle', texto: `del valor consumido, en ${plural(clase.repuestos, 'repuesto', 'repuestos')}` }));
      return tarjeta;
    }));
    graficos.barras($('#grafico-abc'), {
      datos: abc.items.map((i) => ({ etiqueta: i.nombre, detalle: `${i.sku} · clase ${i.clase}`, valor: i.valorConsumoAnual, nota: `${formato.porcentaje(i.participacion)} del total` })),
      columnas: ['Repuesto', 'Valor consumido en un año', 'Participación'],
      formatoValor: (n) => formato.pesosCortos(n),
      espacioDelValor: '9ch',
      vacio: 'Todavía no hay consumo para clasificar.',
    });
  }

  function pintarQuietos(sinMovimiento) {
    const cuerpo = $('#cuerpo-quietos');
    if (sinMovimiento.items.length === 0) {
      vacio(cuerpo, 4, `Todo lo que hay en el estante se ha usado en las últimas ${sinMovimiento.semanasDeCorte} semanas.`);
      return;
    }
    cuerpo.replaceChildren(...sinMovimiento.items.map((i) => {
      const fila = dom.crear('tr');
      celda(fila, dom.crear('span', { clase: 'sku', texto: i.sku }), { detalle: i.nombre });
      celda(fila, i.semanasSinConsumo === null ? 'Nunca se ha usado' : `${i.semanasSinConsumo} semanas sin usarse`);
      celda(fila, i.stockActual, { clase: 'num' });
      celda(fila, formato.pesos.format(i.valorInmovilizado), { clase: 'num' });
      return fila;
    }));
  }

  function pintarPrecision(precision) {
    $('#resumen-precision').textContent = precision.evaluados === 0
      ? 'Todavía no hay historia suficiente para medir el modelo. Hacen falta al menos 12 semanas de consumo.'
      : `De ${plural(precision.evaluados, 'repuesto evaluado', 'repuestos evaluados')}, ${precision.superanAlIngenuo} se pronostican mejor que repitiendo la última semana. `
        + `Modelos en uso: ${precision.porModelo.map((m) => `${m.modelo} (${m.repuestos})`).join(', ')}.`;
    const cuerpo = $('#cuerpo-precision');
    cuerpo.replaceChildren(...precision.items.map((i) => {
      const fila = dom.crear('tr');
      celda(fila, dom.crear('span', { clase: 'sku', texto: i.sku }), { detalle: i.nombre });
      celda(fila, i.modeloNombre, { detalle: NOMBRE_PATRON[i.patron] ? `Demanda ${NOMBRE_PATRON[i.patron].toLowerCase()}` : null });
      celda(fila, i.mejoraSobreIngenuo === null ? 'Sin medir' : formato.porcentaje(i.mejoraSobreIngenuo), { clase: 'num' });
      celda(fila, i.wape === null ? '—' : formato.porcentaje(i.wape), { clase: 'num' });
      celda(fila, i.sesgo === null ? '—' : `${i.sesgo > 0.02 ? 'Se queda corto' : i.sesgo < -0.02 ? 'Se pasa' : 'Sin sesgo'}`);
      // No se dice "confiable" de un modelo que apenas le gana al método más simple.
      let observacion = 'Sin observaciones';
      if (i.aviso) observacion = i.aviso;
      else if (i.mejoraSobreIngenuo !== null && i.mejoraSobreIngenuo < 0.1) observacion = 'Apenas mejora frente a repetir la última semana';
      celda(fila, observacion, { clase: observacion === 'Sin observaciones' ? '' : 'nota-de-aviso' });
      return fila;
    }));
  }

  function mostrarPestana(nombre) {
    PESTANAS.forEach((pestana) => {
      $(`#pestana-pred-${pestana}`).setAttribute('aria-selected', String(pestana === nombre));
      $(`#panel-pred-${pestana}`).hidden = pestana !== nombre;
    });
  }

  $('#pestanas-prediccion').addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-pestana]');
    if (boton) mostrarPestana(boton.dataset.pestana);
  });

  // ------------------------------------------------------- carga y ejecución
  function resumirEjecucion(ejecucion) {
    const motor = ejecucion.motor ? `${ejecucion.motor.nombre} ${ejecucion.motor.version}` : 'modelo';
    const quien = ejecucion.origen === 'PROGRAMADA' ? 'automáticamente' : `por ${ejecucion.iniciadaPor || 'un usuario'}`;
    return `Calculada el ${formato.fechaSqlite(ejecucion.finalizadaEn)} ${quien}, con ${motor}. `
      + `Proyecta ${ejecucion.horizonteSemanas} semanas con un nivel de servicio del ${formato.porcentaje(ejecucion.nivelDeServicio)}.`;
  }

  function mostrarCalculando(calculando) {
    $('#boton-calcular-prediccion').disabled = calculando;
    $('#boton-calcular-prediccion').textContent = calculando ? 'Calculando…' : 'Calcular predicción';
  }

  async function cargar() {
    const [resumen, estado] = await Promise.all([api.pedir('/api/prediccion/resumen'), api.pedir('/api/prediccion/estado')]);
    predicciones = resumen.predicciones;
    const hay = Boolean(resumen.ejecucion);
    $('#contenido-prediccion').hidden = !hay;
    $('#prediccion-vacia').hidden = hay;
    mostrarCalculando(Boolean(estado.enCurso));

    if (hay) {
      $('#resumen-prediccion').textContent = resumirEjecucion(resumen.ejecucion);
      const reportes = await api.pedir('/api/prediccion/reportes');
      pintarIndicadores(reportes);
      pintarCompras(reportes.compras);
      pintarRepuestos();
      pintarAbc(reportes.abc);
      pintarQuietos(reportes.sinMovimiento);
      pintarPrecision(reportes.precision);
    } else {
      $('#resumen-prediccion').textContent = 'Todavía no se ha calculado ninguna predicción.';
    }

    // Si la última ejecución falló, se explica por qué (por ejemplo, falta instalar Python).
    if (estado.ultima && estado.ultima.estado === 'FALLIDA') {
      dom.aviso(aviso, `El último cálculo falló: ${estado.ultima.error}`, 'error');
    }
    return estado;
  }

  /** Consulta el estado hasta que la ejecución termine; la respuesta al lanzarla es inmediata. */
  function esperarResultado(intento = 0) {
    clearTimeout(sondeo);
    sondeo = setTimeout(async () => {
      try {
        const estado = await api.pedir('/api/prediccion/estado');
        if (estado.enCurso) {
          esperarResultado(intento + 1);
          return;
        }
        aviso.textContent = '';
        await cargar();
        if (estado.ultima && estado.ultima.estado === 'COMPLETADA') {
          dom.aviso(aviso, `Predicción lista: ${plural(estado.ultima.repuestos, 'repuesto analizado', 'repuestos analizados')} en ${formato.unidades((estado.ultima.duracionMs || 0) / 1000)} s.`, 'ok');
          window.Taller.campana.refrescar();
        }
      } catch (error) {
        mostrarCalculando(false);
        dom.aviso(aviso, `No se pudo consultar el estado: ${error.message}`, 'error');
      }
    }, ESPERAS_DEL_SONDEO[Math.min(intento, ESPERAS_DEL_SONDEO.length - 1)]);
  }

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    aviso.textContent = '';
    try {
      await api.enviar('/api/prediccion/ejecuciones', 'POST', Object.fromEntries(new FormData(formulario)));
      mostrarCalculando(true);
      dom.aviso(aviso, 'Calculando la predicción. Puede seguir usando la aplicación; esta página se actualiza sola.', 'ok');
      esperarResultado();
    } catch (error) {
      dom.aviso(aviso, error.message, 'error', error.detalles || []);
      if (error.status === 409) {
        mostrarCalculando(true);
        esperarResultado();
      }
    }
  });

  // ---------------------------------------------- exportar compras a CSV
  $('#boton-exportar-compras').addEventListener('click', async () => {
    try {
      // La descarga necesita el token de la sesión: se pide con fetch y se entrega como archivo.
      const respuesta = await window.fetch('/api/prediccion/reportes/compras.csv', { headers: { Authorization: `Bearer ${api.token()}` } });
      if (!respuesta.ok) throw new Error(`Error ${respuesta.status}`);
      const nombre = (respuesta.headers.get('content-disposition') || '').match(/filename="([^"]+)"/);
      const archivo = new window.Blob([await respuesta.text()], { type: 'text/csv;charset=utf-8' });
      const enlace = dom.crear('a');
      enlace.href = window.URL.createObjectURL(archivo);
      enlace.download = nombre ? nombre[1] : 'compras-sugeridas.csv';
      document.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      window.URL.revokeObjectURL(enlace.href);
      dom.aviso(aviso, `Se descargó ${enlace.download}. Ábralo con Excel.`, 'ok');
    } catch (error) {
      dom.aviso(aviso, `No se pudo exportar: ${error.message}`, 'error');
    }
  });

  // ------------------------------------------------ detalle de un repuesto
  /** Cada dato va en su propio bloque (título + valor), para que la rejilla nunca separe uno del otro. */
  function dato(lista, termino, valor, nota) {
    const bloque = dom.crear('div', { clase: 'ficha__dato' });
    bloque.appendChild(dom.crear('dt', { texto: termino }));
    const dd = dom.crear('dd');
    dd.appendChild(dom.crear('span', { texto: valor }));
    if (nota) dd.appendChild(dom.crear('span', { clase: 'detalle', texto: nota }));
    bloque.appendChild(dd);
    lista.appendChild(bloque);
  }

  function pintarDetalle(p) {
    abierta = p;
    $('#titulo-prediccion').textContent = `${p.repuesto.sku} · ${p.repuesto.nombre}`;
    $('#aviso-detalle-prediccion').textContent = '';
    const nota = $('#nota-prediccion');
    nota.hidden = !p.aviso;
    nota.textContent = p.aviso || '';

    graficos.pronostico($('#grafico-prediccion'), {
      historia: p.historia.serie.slice(-52),
      pronostico: p.pronostico,
      formatoFecha: (semana, largo) => formato.dia(semana, largo),
      formatoValor: (n) => formato.unidades(n),
    });

    const ficha = $('#ficha-prediccion');
    ficha.replaceChildren();
    dato(ficha, 'Tipo de demanda', NOMBRE_PATRON[p.patron] || p.patron, p.patronDescripcion);
    dato(ficha, 'Modelo elegido', p.modeloNombre, p.metricas.mejoraSobreIngenuo === null
      ? 'Todavía no se pudo medir'
      : `${formato.porcentaje(Math.max(p.metricas.mejoraSobreIngenuo, 0))} menos de error que repetir la última semana`);
    dato(ficha, `Demanda en ${p.pronostico.length} semanas`, `${formato.unidades(p.demandaTotal)} unidades`, `${formato.unidades(p.demandaDiaria * 7)} por semana`);
    dato(ficha, 'Stock actual', plural(p.repuesto.stockActual, 'unidad', 'unidades'), `Alcanza para: ${cobertura(p).toLowerCase()}`);
    dato(ficha, 'Punto de reorden', plural(p.puntoDeReorden, 'unidad', 'unidades'), `Incluye ${p.stockDeSeguridad} de colchón. El pedido tarda ${plural(p.repuesto.diasReposicion, 'día', 'días')}`);
    dato(ficha, 'Recomendación', p.debePedir ? `Pedir ${p.cantidadSugerida}` : 'No hace falta pedir', p.quiebreAntesDeReponer ? 'Se agotaría antes de que llegue el pedido' : null);
    dato(ficha, 'Último trimestre', NOMBRE_TENDENCIA[p.tendencia] || p.tendencia,
      p.variacionTrimestral === null ? null : `${p.variacionTrimestral >= 0 ? '+' : ''}${formato.porcentaje(p.variacionTrimestral)} frente al trimestre anterior`);
    dato(ficha, 'Clase ABC', p.claseAbc, `${formato.pesos.format(p.valorConsumoAnual)} consumidos en un año`);

    const cuerpo = $('#cuerpo-comparados');
    if (p.comparados.length === 0) vacio(cuerpo, 3, 'No hubo historia suficiente para comparar modelos.');
    else {
      cuerpo.replaceChildren(...[...p.comparados].sort((a, b) => a.rmsse - b.rmsse).map((c) => {
        const fila = dom.crear('tr', { clase: c.modelo === p.modelo ? 'elegido' : '' });
        const nombre = c.modeloNombre || c.modelo;
        celda(fila, c.modelo === p.modelo ? `${nombre} (elegido)` : nombre);
        celda(fila, formato.unidades(Math.round(c.rmsse * 100) / 100), { clase: 'num' });
        celda(fila, c.wape === null ? '—' : formato.porcentaje(c.wape), { clase: 'num' });
        return fila;
      }));
    }

    // Aplicar el punto de reorden como stock mínimo solo se ofrece si cambia algo.
    const boton = $('#boton-aplicar-minimo');
    boton.hidden = p.puntoDeReorden === p.repuesto.stockMinimo || p.puntoDeReorden === 0;
    boton.textContent = `Usar ${p.puntoDeReorden} como stock mínimo (hoy es ${p.repuesto.stockMinimo})`;
  }

  async function abrirDetalle(repuestoId) {
    try {
      const prediccion = await api.pedir(`/api/prediccion/repuestos/${repuestoId}`);
      // El diálogo se abre antes de dibujar: el gráfico necesita conocer el ancho real disponible.
      if (!dialogo.open) dialogo.showModal();
      pintarDetalle(prediccion);
    } catch (error) {
      dom.aviso(aviso, error.message, 'error');
    }
  }

  $('#cuerpo-prediccion').addEventListener('click', (evento) => {
    const boton = evento.target.closest('button[data-ver]');
    if (boton) abrirDetalle(Number(boton.dataset.ver));
  });

  $('#boton-aplicar-minimo').addEventListener('click', async () => {
    const avisoDetalle = $('#aviso-detalle-prediccion');
    try {
      const repuesto = await api.pedir(`/api/repuestos/${abierta.repuesto.id}/minimo-sugerido`, { method: 'PATCH' });
      await abrirDetalle(repuesto.id);
      dom.aviso(avisoDetalle, `Listo: el stock mínimo de ${repuesto.sku} ahora es ${repuesto.stockMinimo}. Las alertas ya lo tienen en cuenta.`, 'ok');
      await cargar();
      window.Taller.campana.refrescar();
    } catch (error) {
      dom.aviso(avisoDetalle, error.message, 'error');
    }
  });

  return {
    async alMostrar() {
      clearTimeout(sondeo);
      aviso.textContent = '';
      mostrarPestana('compras');
      try {
        const estado = await cargar();
        if (estado.enCurso) esperarResultado();
      } catch (error) {
        dom.aviso(aviso, `No se pudo cargar la predicción: ${error.message}`, 'error');
      }
    },
  };
}());
