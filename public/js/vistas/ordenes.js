/* global window, document */
/**
 * Vista "Órdenes de trabajo".
 * - Mecánico: crea órdenes (quedan a su nombre) y ve solo las suyas.
 * - Dueño y administrador: crean órdenes eligiendo el mecánico y ven todas.
 * - Recepcionista: solo consulta el listado.
 */
window.Taller.vistas.ordenes = (function crearVistaOrdenes() {
  const { api, dom, formato } = window.Taller;
  const $ = (selector) => document.querySelector(selector);

  const formulario = $('#formulario-orden');
  const aviso = $('#aviso-orden');
  const avisoLista = $('#aviso-lista-ordenes');
  const cuerpo = $('#cuerpo-ordenes');
  const panelNueva = $('#panel-nueva-orden');
  const campoMecanico = $('#campo-mecanico');
  const selectMecanico = $('#orden-mecanico');

  let usuario = null;

  const puedeCrear = () => ['mecanico', 'dueno', 'administrador'].includes(usuario.rol);
  const eligeMecanico = () => ['dueno', 'administrador'].includes(usuario.rol);

  /** Convierte los campos "cliente.nombre" del formulario en { cliente: { nombre } }. */
  function leerFormulario() {
    const datos = {};
    new FormData(formulario).forEach((valor, nombre) => {
      const [grupo, campo] = nombre.split('.');
      if (campo) {
        datos[grupo] = datos[grupo] || {};
        datos[grupo][campo] = valor;
      } else {
        datos[grupo] = valor;
      }
    });
    return datos;
  }

  function chipEstado(orden) {
    return dom.crear('span', { clase: `estado estado--${orden.estado.toLowerCase()}`, texto: orden.estadoNombre });
  }

  function construirFila(orden) {
    const fila = dom.crear('tr');
    fila.appendChild(dom.crear('td', { clase: 'num-orden', texto: `#${orden.id}` }));

    const vehiculo = dom.crear('td');
    vehiculo.appendChild(dom.crear('span', { clase: 'placa', texto: orden.vehiculo.placa }));
    vehiculo.appendChild(dom.crear('span', { clase: 'detalle', texto: `${orden.vehiculo.marca} ${orden.vehiculo.modelo}` }));
    fila.appendChild(vehiculo);

    const cliente = dom.crear('td', { texto: orden.cliente.nombre });
    cliente.appendChild(dom.crear('span', { clase: 'detalle', texto: orden.cliente.telefono }));
    fila.appendChild(cliente);

    const problema = dom.crear('td', { clase: 'col-problema' });
    problema.appendChild(dom.crear('span', { clase: 'recortado', texto: orden.descripcion }));
    problema.appendChild(dom.crear('span', { clase: 'detalle', texto: formato.fechaSqlite(orden.creadoEn) }));
    fila.appendChild(problema);

    fila.appendChild(dom.crear('td', { texto: orden.mecanico.nombre }));
    const estado = dom.crear('td');
    estado.appendChild(chipEstado(orden));
    fila.appendChild(estado);

    const acciones = dom.crear('td');
    const abrir = dom.crear('button', { clase: 'boton boton--secundario boton--chico', texto: 'Abrir' });
    abrir.type = 'button';
    abrir.dataset.orden = orden.id;
    abrir.setAttribute('aria-label', `Abrir orden ${orden.id} de ${orden.vehiculo.placa}`);
    acciones.appendChild(abrir);
    fila.appendChild(acciones);
    return fila;
  }

  function pintar(ordenes) {
    cuerpo.replaceChildren();
    const enProceso = ordenes.filter((o) => o.estado === 'EN_PROCESO').length;
    $('#resumen-ordenes').textContent = ordenes.length === 0
      ? 'Todavía no hay órdenes registradas.'
      : `${ordenes.length} ${ordenes.length === 1 ? 'orden' : 'órdenes'}, ${enProceso} en proceso.`;

    if (ordenes.length === 0) {
      const fila = dom.crear('tr');
      const celda = dom.crear('td', {
        clase: 'vacio',
        texto: puedeCrear() ? 'No hay órdenes todavía. Registra la primera con el formulario.' : 'No hay órdenes registradas.',
      });
      celda.colSpan = 7;
      fila.appendChild(celda);
      cuerpo.appendChild(fila);
      return;
    }
    ordenes.forEach((orden) => cuerpo.appendChild(construirFila(orden)));
  }

  async function cargar() {
    try {
      pintar(await api.pedir('/api/ordenes'));
    } catch (error) {
      dom.aviso(avisoLista, `No se pudieron cargar las órdenes: ${error.message}`, 'error');
    }
  }

  async function cargarMecanicos() {
    const mecanicos = await api.pedir('/api/usuarios/mecanicos');
    selectMecanico.replaceChildren(dom.crear('option', { texto: 'Selecciona un mecánico' }));
    selectMecanico.firstChild.value = '';
    mecanicos.forEach((m) => {
      const opcion = dom.crear('option', { texto: m.nombre });
      opcion.value = m.id;
      selectMecanico.appendChild(opcion);
    });
  }

  // ---------------------------------------------------------------- Detalle
  const dialogo = $('#dialogo-orden');
  const formularioUsado = $('#formulario-repuesto-usado');
  const avisoUsado = $('#aviso-repuesto-usado');
  let ordenAbierta = null;

  function dato(lista, termino, ...lineas) {
    lista.appendChild(dom.crear('dt', { texto: termino }));
    const dd = dom.crear('dd');
    lineas.filter(Boolean).forEach((linea, i) => {
      if (linea instanceof window.Node) dd.appendChild(linea);
      else dd.appendChild(dom.crear('span', { clase: i === 0 ? '' : 'detalle', texto: linea }));
    });
    lista.appendChild(dd);
  }

  function pintarDetalle(orden) {
    ordenAbierta = orden;
    $('#titulo-orden').textContent = `Orden #${orden.id}`;
    $('#estado-orden').replaceChildren(chipEstado(orden));

    const ficha = $('#ficha-orden');
    ficha.replaceChildren();
    const v = orden.vehiculo;
    dato(ficha, 'Vehículo', dom.crear('span', { clase: 'placa', texto: v.placa }), `${v.marca} ${v.modelo}${v.anio ? ` (${v.anio})` : ''}`);
    dato(ficha, 'Cliente', orden.cliente.nombre, `CC ${orden.cliente.documento}`, orden.cliente.telefono);
    dato(ficha, 'Mecánico', orden.mecanico.nombre);
    dato(ficha, 'Creada', formato.fechaSqlite(orden.creadoEn));
    $('#problema-orden').textContent = orden.descripcion;

    const cuerpoUsados = $('#cuerpo-repuestos-orden');
    cuerpoUsados.replaceChildren();
    if (orden.repuestos.length === 0) {
      const fila = dom.crear('tr');
      const celda = dom.crear('td', { clase: 'vacio', texto: 'Todavía no se han registrado repuestos en esta orden.' });
      celda.colSpan = 4;
      fila.appendChild(celda);
      cuerpoUsados.appendChild(fila);
    }
    orden.repuestos.forEach((r) => {
      const fila = dom.crear('tr');
      const nombre = dom.crear('td', { texto: r.nombre });
      nombre.appendChild(dom.crear('span', { clase: 'detalle', texto: `${r.sku}, registró ${r.registradoPor}` }));
      fila.appendChild(nombre);
      fila.appendChild(dom.crear('td', { clase: 'num', texto: r.cantidad }));
      fila.appendChild(dom.crear('td', { clase: 'num', texto: formato.pesos.format(r.costoUnitario) }));
      fila.appendChild(dom.crear('td', { clase: 'num', texto: formato.pesos.format(r.subtotal) }));
      cuerpoUsados.appendChild(fila);
    });
    $('#total-repuestos-orden').textContent = formato.pesos.format(orden.totalRepuestos);

    formularioUsado.hidden = !(puedeCrear() && orden.estado === 'EN_PROCESO');
  }

  async function cargarRepuestosDisponibles() {
    const select = $('#usado-repuesto');
    const repuestos = await api.pedir('/api/repuestos');
    select.replaceChildren();
    const vacia = dom.crear('option', { texto: repuestos.length ? 'Selecciona un repuesto' : 'No hay repuestos en el inventario' });
    vacia.value = '';
    select.appendChild(vacia);
    repuestos.forEach((r) => {
      const opcion = dom.crear('option', { texto: `${r.sku}: ${r.nombre} (quedan ${r.stockActual})` });
      opcion.value = r.id;
      opcion.disabled = r.stockActual === 0;
      select.appendChild(opcion);
    });
  }

  async function abrirDetalle(id) {
    avisoUsado.textContent = '';
    try {
      const orden = await api.pedir(`/api/ordenes/${id}`);
      pintarDetalle(orden);
      if (!formularioUsado.hidden) await cargarRepuestosDisponibles();
      if (!dialogo.open) dialogo.showModal();
    } catch (error) {
      dom.aviso(avisoLista, error.message, 'error');
    }
  }

  cuerpo.addEventListener('click', (evento) => {
    const boton = evento.target.closest('button[data-orden]');
    if (boton) abrirDetalle(Number(boton.dataset.orden));
  });

  formularioUsado.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    avisoUsado.textContent = '';
    const { repuestoId, cantidad } = Object.fromEntries(new FormData(formularioUsado));
    if (!repuestoId) {
      dom.aviso(avisoUsado, 'Selecciona un repuesto del inventario.', 'error');
      return;
    }
    try {
      const orden = await api.enviar(`/api/ordenes/${ordenAbierta.id}/repuestos`, 'POST', { items: [{ repuestoId, cantidad }] });
      pintarDetalle(orden);
      await cargarRepuestosDisponibles();
      formularioUsado.reset();
      const ultimo = orden.repuestos[orden.repuestos.length - 1];
      dom.aviso(avisoUsado, `Registrado. Se descontaron ${cantidad} unidad(es) del inventario${ultimo ? ` de ${ultimo.sku}` : ''}.`, 'ok');
    } catch (error) {
      dom.aviso(avisoUsado, error.message, 'error', error.detalles || []);
    }
  });

  // ------------------------------------------------------------ Nueva orden
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    dom.limpiarErrores(formulario);
    aviso.textContent = '';
    try {
      const orden = await api.enviar('/api/ordenes', 'POST', leerFormulario());
      formulario.reset();
      dom.aviso(aviso, `Orden #${orden.id} creada para ${orden.vehiculo.placa}. Quedó en estado ${orden.estadoNombre}.`, 'ok');
      await cargar();
    } catch (error) {
      const sinCampo = dom.marcarErrores(formulario, error.detalles || []);
      dom.aviso(aviso, error.message, 'error', sinCampo);
    }
  });

  $('#orden-placa').addEventListener('input', (evento) => {
    evento.target.value = evento.target.value.toUpperCase();
  });

  return {
    async alMostrar(usuarioActual) {
      usuario = usuarioActual;
      panelNueva.hidden = !puedeCrear();
      $('#disposicion-ordenes').classList.toggle('disposicion--sola', !puedeCrear());
      campoMecanico.hidden = !eligeMecanico();
      $('#titulo-lista-ordenes').textContent = usuario.rol === 'mecanico' ? 'Mis órdenes' : 'Órdenes';
      if (eligeMecanico()) await cargarMecanicos().catch(() => {});
      await cargar();
    },
  };
}());
