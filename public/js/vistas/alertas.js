/* global window, document */
/**
 * Vista "Alertas" (dueño y administrador): los repuestos que llegaron a su
 * mínimo, se agotaron o fueron reportados como faltantes (HU-08). Desde aquí
 * se marca que ya se hizo el pedido y se consulta el historial.
 */
window.Taller.vistas.alertas = (function crearVistaAlertas() {
  const { api, dom, formato } = window.Taller;
  const $ = (selector) => document.querySelector(selector);

  const cuerpo = $('#cuerpo-alertas');
  const aviso = $('#aviso-alertas');
  const dialogo = $('#dialogo-atender');
  const formulario = $('#formulario-atender');
  const avisoAtender = $('#aviso-atender');
  let grupo = 'ABIERTAS';
  let pagina = 1;
  let alertas = [];
  let porAtender = null;

  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  function resumir({ activas, atendidas, agotados }) {
    if (activas + atendidas === 0) return 'Todo el inventario está por encima de su mínimo.';
    const partes = [`${plural(activas, 'alerta', 'alertas')} sin atender`];
    if (atendidas > 0) partes.push(`${atendidas} con pedido hecho`);
    if (agotados > 0) partes.push(plural(agotados, 'repuesto agotado', 'repuestos agotados'));
    return `${partes.join(', ')}.`;
  }

  function construirFila(alerta) {
    const fila = dom.crear('tr');
    fila.dataset.alerta = alerta.id;
    const { repuesto } = alerta;

    const celdaRepuesto = dom.crear('td');
    celdaRepuesto.appendChild(dom.crear('span', { clase: 'sku', texto: repuesto.sku }));
    celdaRepuesto.appendChild(dom.crear('span', { clase: 'detalle', texto: [repuesto.nombre, repuesto.proveedor].filter(Boolean).join(' · ') }));
    fila.appendChild(celdaRepuesto);

    // El tipo se dice con texto; el color solo lo acompaña.
    const celdaTipo = dom.crear('td');
    celdaTipo.appendChild(dom.crear('span', { clase: `estado alerta--${alerta.tipo.toLowerCase()}`, texto: alerta.tipoNombre }));
    if (alerta.detalle) celdaTipo.appendChild(dom.crear('span', { clase: 'detalle', texto: alerta.detalle }));
    fila.appendChild(celdaTipo);

    const unidades = repuesto.stockActual === 1 ? '1 unidad' : `${repuesto.stockActual} unidades`;
    const celdaStock = dom.crear('td', { texto: unidades });
    celdaStock.appendChild(dom.crear('span', { clase: 'detalle', texto: `Mínimo ${repuesto.stockMinimo}` }));
    fila.appendChild(celdaStock);

    const celdaFecha = dom.crear('td', { texto: formato.fechaSqlite(grupo === 'RESUELTAS' ? alerta.resueltaEn : alerta.creadaEn) });
    if (grupo === 'RESUELTAS') celdaFecha.appendChild(dom.crear('span', { clase: 'detalle', texto: `Abierta el ${formato.fechaSqlite(alerta.creadaEn)}` }));
    fila.appendChild(celdaFecha);

    const celdaEstado = dom.crear('td', { texto: alerta.estadoNombre });
    if (alerta.atendidaPor) {
      celdaEstado.appendChild(dom.crear('span', {
        clase: 'detalle',
        texto: `${alerta.atendidaPor}${alerta.notaDeAtencion ? `: ${alerta.notaDeAtencion}` : ''}`,
      }));
    }
    fila.appendChild(celdaEstado);

    const celdaAccion = dom.crear('td');
    if (alerta.estado === 'ACTIVA') {
      const boton = dom.crear('button', { clase: 'boton boton--secundario boton--chico', texto: 'Ya hice el pedido' });
      boton.type = 'button';
      boton.dataset.atender = alerta.id;
      boton.setAttribute('aria-label', `Marcar pedido hecho: ${repuesto.sku}`);
      celdaAccion.appendChild(boton);
    }
    fila.appendChild(celdaAccion);
    return fila;
  }

  async function cargar() {
    aviso.textContent = '';
    try {
      const resultado = await api.pedir(`/api/alertas?${new URLSearchParams({ estado: grupo, pagina })}`);
      alertas = resultado.datos;
      $('#resumen-alertas').textContent = resumir(resultado.conteo);
      $('#columna-fecha-alertas').textContent = grupo === 'RESUELTAS' ? 'Resuelta' : 'Desde';
      if (alertas.length === 0) {
        const fila = dom.crear('tr');
        const celda = dom.crear('td', {
          clase: 'vacio',
          texto: grupo === 'RESUELTAS' ? 'Todavía no hay alertas resueltas.' : 'No hay alertas abiertas. Ningún repuesto está en su mínimo.',
        });
        celda.colSpan = 6;
        fila.appendChild(celda);
        cuerpo.replaceChildren(fila);
      } else {
        cuerpo.replaceChildren(...alertas.map(construirFila));
      }
      $('#alertas-pagina').textContent = `Página ${resultado.pagina} de ${resultado.totalPaginas}`;
      $('#alertas-anterior').disabled = resultado.pagina <= 1;
      $('#alertas-siguiente').disabled = resultado.pagina >= resultado.totalPaginas;
      $('#paginacion-alertas').hidden = resultado.totalPaginas <= 1;
    } catch (error) {
      dom.aviso(aviso, `No se pudieron cargar las alertas: ${error.message}`, 'error');
    }
  }

  function mostrarGrupo(nuevo) {
    grupo = nuevo;
    pagina = 1;
    document.querySelectorAll('#pestanas-alertas [data-grupo]').forEach((pestana) => {
      pestana.setAttribute('aria-selected', String(pestana.dataset.grupo === grupo));
    });
    return cargar();
  }

  $('#pestanas-alertas').addEventListener('click', (evento) => {
    const pestana = evento.target.closest('[data-grupo]');
    if (pestana) mostrarGrupo(pestana.dataset.grupo);
  });
  $('#alertas-anterior').addEventListener('click', () => { pagina -= 1; cargar(); });
  $('#alertas-siguiente').addEventListener('click', () => { pagina += 1; cargar(); });

  $('#boton-revisar-alertas').addEventListener('click', async () => {
    try {
      const r = await api.pedir('/api/alertas/revisar', { method: 'POST' });
      await cargar();
      const novedades = r.creadas + r.escaladas + r.resueltas === 0
        ? 'sin novedades'
        : `${plural(r.creadas + r.escaladas, 'alerta nueva', 'alertas nuevas')}, ${plural(r.resueltas, 'resuelta', 'resueltas')}`;
      dom.aviso(aviso, `Se revisaron ${plural(r.revisados, 'repuesto', 'repuestos')}: ${novedades}.`, 'ok');
      window.Taller.campana.refrescar();
    } catch (error) {
      dom.aviso(aviso, error.message, 'error');
    }
  });

  // ------------------------------------------------------- Marcar pedido hecho
  cuerpo.addEventListener('click', (evento) => {
    const boton = evento.target.closest('button[data-atender]');
    if (!boton) return;
    porAtender = alertas.find((a) => a.id === Number(boton.dataset.atender));
    formulario.reset();
    dom.limpiarErrores(formulario);
    avisoAtender.textContent = '';
    $('#texto-atender').textContent = `${porAtender.repuesto.sku} · ${porAtender.repuesto.nombre}. La alerta queda como "Pedido hecho" y se cierra sola cuando registres la entrada de la mercancía.`;
    dialogo.showModal();
    $('#atender-nota').focus();
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    dom.limpiarErrores(formulario);
    avisoAtender.textContent = '';
    try {
      await api.enviar(`/api/alertas/${porAtender.id}/atender`, 'PATCH', { nota: new FormData(formulario).get('nota') });
      dialogo.close();
      await cargar();
    } catch (error) {
      const sinCampo = dom.marcarErrores(formulario, error.detalles || []);
      dom.aviso(avisoAtender, error.message, 'error', sinCampo);
    }
  });

  $('#boton-volver-atender').addEventListener('click', () => dialogo.close());

  return { alMostrar: () => mostrarGrupo('ABIERTAS') };
}());
