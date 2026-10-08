/* global window, document */
/**
 * Vista "Órdenes de trabajo".
 * - Mecánico: crea órdenes (quedan a su nombre) y ve solo las suyas.
 * - Dueño y administrador: crean órdenes eligiendo el mecánico y ven todas.
 * - Recepcionista: consulta el listado global con filtros (HU-06), sin modificar nada.
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

  // ----------------------------------------------- Listado, filtros y páginas
  const formularioFiltros = $('#filtros-ordenes');
  let pagina = 1;

  function hayFiltros() {
    return [...new FormData(formularioFiltros).values()].some((v) => String(v).trim() !== '');
  }

  function pintar(resultado) {
    const { datos, total, totalPaginas } = resultado;
    cuerpo.replaceChildren();
    avisoLista.textContent = '';

    const desde = total === 0 ? 0 : (resultado.pagina - 1) * resultado.tamano + 1;
    const hasta = (resultado.pagina - 1) * resultado.tamano + datos.length;
    $('#info-resultados').textContent = total === 0 ? '' : `Mostrando ${desde} a ${hasta} de ${total}`;
    $('#pagina-actual').textContent = `Página ${resultado.pagina} de ${totalPaginas}`;
    $('#pagina-anterior').disabled = resultado.pagina <= 1;
    $('#pagina-siguiente').disabled = resultado.pagina >= totalPaginas;
    $('.paginacion').hidden = totalPaginas <= 1;

    if (datos.length === 0) {
      const fila = dom.crear('tr');
      let texto = 'No hay órdenes registradas.';
      if (hayFiltros()) texto = 'Ninguna orden coincide con los filtros. Revisa la placa completa o limpia los filtros.';
      else if (puedeCrear()) texto = 'No hay órdenes todavía. Registra la primera con el formulario.';
      const celda = dom.crear('td', { clase: 'vacio', texto });
      celda.colSpan = 7;
      fila.appendChild(celda);
      cuerpo.appendChild(fila);
      return;
    }
    datos.forEach((orden) => cuerpo.appendChild(construirFila(orden)));
  }

  async function actualizarResumen() {
    const activas = await api.pedir('/api/ordenes?estado=ACTIVAS&tamano=1');
    const todas = await api.pedir('/api/ordenes?tamano=1');
    $('#resumen-ordenes').textContent = todas.total === 0
      ? 'Todavía no hay órdenes registradas.'
      : `${todas.total} ${todas.total === 1 ? 'orden' : 'órdenes'} en total, ${activas.total} activas.`;
  }

  async function cargar() {
    const parametros = new URLSearchParams();
    new FormData(formularioFiltros).forEach((valor, clave) => {
      if (String(valor).trim() !== '') parametros.set(clave, String(valor).trim());
    });
    parametros.set('pagina', pagina);
    try {
      pintar(await api.pedir(`/api/ordenes?${parametros}`));
      await actualizarResumen();
    } catch (error) {
      dom.aviso(avisoLista, `No se pudieron cargar las órdenes: ${error.message}`, 'error', error.detalles || []);
    }
  }

  let temporizador;
  function filtrarPronto() {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { pagina = 1; cargar(); }, 300);
  }
  formularioFiltros.addEventListener('input', filtrarPronto);
  formularioFiltros.addEventListener('submit', (evento) => { evento.preventDefault(); pagina = 1; cargar(); });
  formularioFiltros.addEventListener('reset', () => setTimeout(() => { pagina = 1; cargar(); }, 0));
  $('#filtro-placa').addEventListener('input', (evento) => { evento.target.value = evento.target.value.toUpperCase(); });
  $('#pagina-anterior').addEventListener('click', () => { pagina -= 1; cargar(); });
  $('#pagina-siguiente').addEventListener('click', () => { pagina += 1; cargar(); });

  async function cargarMecanicos() {
    const mecanicos = await api.pedir('/api/usuarios/mecanicos');
    const llenar = (select, textoVacio) => {
      select.replaceChildren(dom.crear('option', { texto: textoVacio }));
      select.firstChild.value = '';
      mecanicos.forEach((m) => {
        const opcion = dom.crear('option', { texto: m.nombre });
        opcion.value = m.id;
        select.appendChild(opcion);
      });
    };
    llenar(selectMecanico, 'Selecciona un mecánico');
    llenar($('#filtro-mecanico'), 'Todos');
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
    pintarNotas(orden);
  }

  // ------------------------------------------------------------------ Notas
  const formularioNotas = $('#formulario-notas');
  const campoNotas = $('#notas-orden');
  const avisoNotas = $('#aviso-notas');

  function pintarNotas(orden) {
    const editable = puedeCrear();
    campoNotas.value = orden.notas || '';
    campoNotas.readOnly = !editable;
    campoNotas.placeholder = editable ? campoNotas.placeholder : 'Sin notas registradas.';
    $('#boton-guardar-notas').hidden = !editable;
    $('#meta-notas').textContent = orden.notasActualizadasEn
      ? `Última actualización: ${formato.fechaSqlite(orden.notasActualizadasEn)}, por ${orden.notasActualizadasPor}`
      : 'Todavía no hay notas.';
  }

  formularioNotas.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    avisoNotas.textContent = '';
    try {
      const orden = await api.enviar(`/api/ordenes/${ordenAbierta.id}/notas`, 'PATCH', { notas: campoNotas.value });
      ordenAbierta = orden;
      pintarNotas(orden);
      dom.aviso(avisoNotas, orden.notas ? 'Notas guardadas.' : 'Notas borradas.', 'ok');
    } catch (error) {
      dom.aviso(avisoNotas, error.message, 'error');
    }
  });

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
    avisoNotas.textContent = '';
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
      pagina = 1;
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
      const esMecanico = usuario.rol === 'mecanico';
      $('#campo-filtro-mecanico').hidden = esMecanico;
      $('#titulo-lista-ordenes').textContent = esMecanico ? 'Mis órdenes' : 'Todas las órdenes';
      if (!esMecanico) await cargarMecanicos().catch(() => {});
      pagina = 1;
      await cargar();
    },
  };
}());
