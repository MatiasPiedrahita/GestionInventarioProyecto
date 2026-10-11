/* global window, document */
/**
 * Vista "Órdenes de trabajo".
 * - Mecánico: crea órdenes (quedan a su nombre), ve solo las suyas y tiene "Mi resumen".
 * - Dueño y administrador: crean órdenes eligiendo el mecánico y ven todas.
 * - Recepcionista: recibe el vehículo (crea la orden eligiendo el mecánico) y consulta
 *   el listado global con filtros (HU-06). No registra repuestos, notas ni estados.
 *
 * Las órdenes se ven como lista paginada o como tablero Kanban (HU-07), con
 * una columna por estado. El estado se cambia arrastrando la tarjeta o con
 * los botones de cada tarjeta (en tabletas no hay arrastre).
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

  const puedeCrear = () => ['mecanico', 'recepcionista', 'dueno', 'administrador'].includes(usuario.rol);
  /** Quién registra repuestos, escribe notas y cambia el estado (el mecánico, solo en sus órdenes). */
  const puedeTrabajar = () => ['mecanico', 'dueno', 'administrador'].includes(usuario.rol);
  const puedeReabrir = () => ['dueno', 'administrador'].includes(usuario.rol);
  const eligeMecanico = () => ['recepcionista', 'dueno', 'administrador'].includes(usuario.rol);
  /** Quién puede consultar el directorio de clientes (para completar el formulario con datos ya registrados). */
  const consultaClientes = () => ['recepcionista', 'dueno', 'administrador'].includes(usuario.rol);

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

  function filtrosActuales() {
    const parametros = new URLSearchParams();
    new FormData(formularioFiltros).forEach((valor, clave) => {
      if (String(valor).trim() !== '') parametros.set(clave, String(valor).trim());
    });
    return parametros;
  }

  async function cargar() {
    try {
      if (modo === 'tablero') {
        await cargarTablero();
      } else {
        const parametros = filtrosActuales();
        parametros.set('pagina', pagina);
        pintar(await api.pedir(`/api/ordenes?${parametros}`));
      }
      await actualizarResumen();
    } catch (error) {
      dom.aviso(avisoLista, `No se pudieron cargar las órdenes: ${error.message}`, 'error', error.detalles || []);
    }
  }

  // ------------------------------------------------- Tablero Kanban (HU-07)
  const tablero = $('#tablero-ordenes');
  const CLAVE_MODO = 'taller.modoOrdenes';
  const ESTADOS_DEL_TABLERO = ['EN_PROCESO', 'FINALIZADA', 'CANCELADA'];
  const TARJETAS_POR_COLUMNA = 50;
  /** Espejo de las reglas del servidor, solo para no ofrecer acciones que la API va a rechazar. */
  const SIGUIENTES = { EN_PROCESO: ['FINALIZADA', 'CANCELADA'], FINALIZADA: ['EN_PROCESO'], CANCELADA: ['EN_PROCESO'] };
  const ACCIONES = {
    FINALIZADA: { texto: 'Finalizar', clase: 'boton boton--chico' },
    CANCELADA: { texto: 'Cancelar', clase: 'boton boton--secundario boton--chico boton--peligro' },
    EN_PROCESO: { texto: 'Reabrir', clase: 'boton boton--secundario boton--chico' },
  };
  let modo = 'lista';

  function puedePasar(estadoActual, destino) {
    if (!puedeTrabajar() || !SIGUIENTES[estadoActual].includes(destino)) return false;
    return destino !== 'EN_PROCESO' || puedeReabrir();
  }

  function botonesDeEstado(orden) {
    return SIGUIENTES[orden.estado].filter((destino) => puedePasar(orden.estado, destino)).map((destino) => {
      const boton = dom.crear('button', { clase: ACCIONES[destino].clase, texto: ACCIONES[destino].texto });
      boton.type = 'button';
      boton.dataset.cambiar = orden.id;
      boton.dataset.destino = destino;
      boton.setAttribute('aria-label', `${ACCIONES[destino].texto} la orden ${orden.id} de ${orden.vehiculo.placa}`);
      return boton;
    });
  }

  function construirTarjeta(orden) {
    const tarjeta = dom.crear('li', { clase: 'tarjeta' });
    tarjeta.dataset.orden = orden.id;
    tarjeta.dataset.estado = orden.estado;
    tarjeta.draggable = SIGUIENTES[orden.estado].some((destino) => puedePasar(orden.estado, destino));

    const cabecera = dom.crear('div', { clase: 'tarjeta__cabecera' });
    cabecera.appendChild(dom.crear('span', { clase: 'placa', texto: orden.vehiculo.placa }));
    cabecera.appendChild(dom.crear('span', { clase: 'num-orden', texto: `#${orden.id}` }));
    tarjeta.appendChild(cabecera);

    tarjeta.appendChild(dom.crear('p', { clase: 'tarjeta__vehiculo', texto: `${orden.vehiculo.marca} ${orden.vehiculo.modelo}` }));
    tarjeta.appendChild(dom.crear('p', { clase: 'tarjeta__problema recortado', texto: orden.descripcion }));
    const pie = usuario.rol === 'mecanico' ? orden.cliente.nombre : `${orden.cliente.nombre} · ${orden.mecanico.nombre}`;
    tarjeta.appendChild(dom.crear('p', { clase: 'detalle', texto: pie }));

    const acciones = dom.crear('div', { clase: 'tarjeta__acciones' });
    const abrir = dom.crear('button', { clase: 'boton boton--texto boton--chico', texto: 'Abrir' });
    abrir.type = 'button';
    abrir.dataset.orden = orden.id;
    abrir.setAttribute('aria-label', `Abrir orden ${orden.id} de ${orden.vehiculo.placa}`);
    acciones.appendChild(abrir);
    botonesDeEstado(orden).forEach((boton) => acciones.appendChild(boton));
    tarjeta.appendChild(acciones);
    return tarjeta;
  }

  function pintarColumna(estado, resultado) {
    const lista = tablero.querySelector(`[data-tarjetas="${estado}"]`);
    lista.replaceChildren();
    tablero.querySelector(`[data-conteo="${estado}"]`).textContent = resultado.total;
    resultado.datos.forEach((orden) => lista.appendChild(construirTarjeta(orden)));
    if (resultado.datos.length === 0) {
      lista.appendChild(dom.crear('li', { clase: 'tablero__vacio', texto: 'Sin órdenes' }));
    } else if (resultado.total > resultado.datos.length) {
      lista.appendChild(dom.crear('li', {
        clase: 'tablero__vacio',
        texto: `Se muestran las ${resultado.datos.length} más recientes de ${resultado.total}. Usa la lista para ver todas.`,
      }));
    }
  }

  async function cargarTablero() {
    avisoLista.textContent = '';
    const columnas = await Promise.all(ESTADOS_DEL_TABLERO.map((estado) => {
      const parametros = filtrosActuales();
      parametros.set('estado', estado);
      parametros.set('tamano', TARJETAS_POR_COLUMNA);
      return api.pedir(`/api/ordenes?${parametros}`);
    }));
    ESTADOS_DEL_TABLERO.forEach((estado, i) => pintarColumna(estado, columnas[i]));
  }

  function aplicarModo(nuevo) {
    modo = nuevo;
    try { window.sessionStorage.setItem(CLAVE_MODO, modo); } catch { /* almacenamiento no disponible */ }
    tablero.hidden = modo !== 'tablero';
    $('#lista-ordenes').hidden = modo === 'tablero';
    // En el tablero cada columna ya es un estado: el filtro por estado sobra.
    $('#campo-filtro-estado').hidden = modo === 'tablero';
    $('#info-resultados').hidden = modo === 'tablero';
    document.querySelectorAll('.alternador__opcion').forEach((boton) => {
      boton.setAttribute('aria-pressed', String(boton.dataset.modo === modo));
    });
  }

  document.querySelector('.alternador').addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-modo]');
    if (!boton || boton.dataset.modo === modo) return;
    aplicarModo(boton.dataset.modo);
    pagina = 1;
    cargar();
  });

  tablero.addEventListener('click', (evento) => {
    const cambiar = evento.target.closest('button[data-cambiar]');
    if (cambiar) {
      pedirCambioDeEstado(Number(cambiar.dataset.cambiar), cambiar.dataset.destino);
      return;
    }
    const abrir = evento.target.closest('button[data-orden]');
    if (abrir) abrirDetalle(Number(abrir.dataset.orden));
  });

  // Arrastrar y soltar: la columna solo acepta la tarjeta si la transición es válida para el rol.
  let arrastrada = null;
  tablero.addEventListener('dragstart', (evento) => {
    const tarjeta = evento.target.closest('.tarjeta');
    if (!tarjeta) return;
    arrastrada = { id: Number(tarjeta.dataset.orden), estado: tarjeta.dataset.estado };
    evento.dataTransfer.effectAllowed = 'move';
    evento.dataTransfer.setData('text/plain', tarjeta.dataset.orden);
    tarjeta.classList.add('tarjeta--arrastrada');
  });
  tablero.addEventListener('dragend', (evento) => {
    const tarjeta = evento.target.closest('.tarjeta');
    if (tarjeta) tarjeta.classList.remove('tarjeta--arrastrada');
    tablero.querySelectorAll('.tablero__columna--destino').forEach((c) => c.classList.remove('tablero__columna--destino'));
    arrastrada = null;
  });
  tablero.addEventListener('dragover', (evento) => {
    const columna = evento.target.closest('.tablero__columna');
    if (!columna || !arrastrada || !puedePasar(arrastrada.estado, columna.dataset.estado)) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = 'move';
    columna.classList.add('tablero__columna--destino');
  });
  tablero.addEventListener('dragleave', (evento) => {
    const columna = evento.target.closest('.tablero__columna');
    if (columna && !columna.contains(evento.relatedTarget)) columna.classList.remove('tablero__columna--destino');
  });
  tablero.addEventListener('drop', (evento) => {
    const columna = evento.target.closest('.tablero__columna');
    if (!columna || !arrastrada || !puedePasar(arrastrada.estado, columna.dataset.estado)) return;
    evento.preventDefault();
    columna.classList.remove('tablero__columna--destino');
    pedirCambioDeEstado(arrastrada.id, columna.dataset.estado);
  });

  // ------------------------------------------------ Cambio de estado (HU-07)
  const dialogoEstado = $('#dialogo-estado');
  const formularioEstado = $('#formulario-estado');
  const avisoEstado = $('#aviso-estado');
  const TEXTOS_DE_CAMBIO = {
    FINALIZADA: {
      titulo: 'Finalizar la orden',
      texto: 'La orden pasa a Finalizada y ya no admite más repuestos. El inventario no cambia: cada repuesto se descontó cuando se registró.',
      boton: 'Finalizar orden',
      motivoObligatorio: false,
    },
    CANCELADA: {
      titulo: 'Cancelar la orden',
      texto: 'La orden pasa a Cancelada. Escribe por qué se cancela; queda en el historial.',
      boton: 'Cancelar orden',
      motivoObligatorio: true,
    },
    EN_PROCESO: {
      titulo: 'Reabrir la orden',
      texto: 'La orden vuelve a En proceso y admite repuestos otra vez. Escribe por qué se reabre.',
      boton: 'Reabrir orden',
      motivoObligatorio: true,
    },
  };
  let cambioPendiente = null;

  async function pedirCambioDeEstado(id, destino) {
    let orden;
    try {
      orden = await api.pedir(`/api/ordenes/${id}`);
    } catch (error) {
      dom.aviso(avisoLista, error.message, 'error');
      return;
    }
    const textos = TEXTOS_DE_CAMBIO[destino];
    cambioPendiente = { id, destino };
    formularioEstado.reset();
    dom.limpiarErrores(formularioEstado);
    avisoEstado.textContent = '';
    $('#titulo-cambio-estado').textContent = `${textos.titulo} #${orden.id}`;
    $('#texto-cambio-estado').textContent = textos.texto;
    $('#motivo-opcional').hidden = textos.motivoObligatorio;
    $('#boton-confirmar-estado').textContent = textos.boton;

    const unidades = orden.repuestos.filter((r) => !r.devuelto).reduce((suma, r) => suma + r.cantidad, 0);
    $('#campo-devolver').hidden = !(destino === 'CANCELADA' && unidades > 0);
    $('#texto-devolver').textContent = `Devolver al inventario ${unidades === 1 ? 'la unidad registrada' : `las ${unidades} unidades registradas`} en esta orden`;

    dialogoEstado.showModal();
    $('#estado-motivo').focus();
  }

  formularioEstado.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (!cambioPendiente) return;
    dom.limpiarErrores(formularioEstado);
    avisoEstado.textContent = '';
    const datos = new FormData(formularioEstado);
    const cuerpo = { estado: cambioPendiente.destino, motivo: datos.get('motivo') };
    if (cambioPendiente.destino === 'CANCELADA') cuerpo.devolverRepuestos = datos.get('devolverRepuestos') === 'on';
    try {
      const orden = await api.enviar(`/api/ordenes/${cambioPendiente.id}/estado`, 'PATCH', cuerpo);
      dialogoEstado.close();
      cambioPendiente = null;
      if (dialogo.open) await abrirDetalle(orden.id);
      await cargar();
      await cargarMiResumen();
    } catch (error) {
      const sinCampo = dom.marcarErrores(formularioEstado, error.detalles || []);
      dom.aviso(avisoEstado, error.message, 'error', sinCampo);
    }
  });

  $('#boton-volver-estado').addEventListener('click', () => dialogoEstado.close());

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

  let mecanicos = [];

  async function cargarMecanicos() {
    mecanicos = await api.pedir('/api/usuarios/mecanicos');
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
      const fila = dom.crear('tr', { clase: r.devuelto ? 'devuelto' : '' });
      const nombre = dom.crear('td', { texto: r.nombre });
      nombre.appendChild(dom.crear('span', {
        clase: 'detalle',
        texto: `${r.sku}, registró ${r.registradoPor}${r.devuelto ? '. Devuelto al inventario' : ''}`,
      }));
      fila.appendChild(nombre);
      fila.appendChild(dom.crear('td', { clase: 'num', texto: r.cantidad }));
      fila.appendChild(dom.crear('td', { clase: 'num', texto: formato.pesos.format(r.costoUnitario) }));
      fila.appendChild(dom.crear('td', { clase: 'num', texto: formato.pesos.format(r.subtotal) }));
      cuerpoUsados.appendChild(fila);
    });
    $('#total-repuestos-orden').textContent = formato.pesos.format(orden.totalRepuestos);

    formularioUsado.hidden = !(puedeTrabajar() && orden.estado === 'EN_PROCESO');
    $('#acciones-estado').replaceChildren(...botonesDeEstado(orden));
    pintarReasignacion(orden);
    pintarNotas(orden);
  }

  // ------------------------------------------- Reasignar (dueño y administrador)
  const formularioReasignar = $('#formulario-reasignar');
  const avisoReasignar = $('#aviso-reasignar');

  function pintarReasignacion(orden) {
    const otros = mecanicos.filter((m) => m.id !== orden.mecanico.id);
    formularioReasignar.hidden = !(puedeReabrir() && orden.estado === 'EN_PROCESO' && otros.length > 0);
    const select = $('#reasignar-mecanico');
    const vacia = dom.crear('option', { texto: 'Selecciona un mecánico' });
    vacia.value = '';
    select.replaceChildren(vacia, ...otros.map((m) => {
      const opcion = dom.crear('option', { texto: m.nombre });
      opcion.value = m.id;
      return opcion;
    }));
  }

  formularioReasignar.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    avisoReasignar.textContent = '';
    try {
      const orden = await api.enviar(`/api/ordenes/${ordenAbierta.id}/mecanico`, 'PATCH', { mecanicoId: $('#reasignar-mecanico').value });
      pintarDetalle(orden);
      dom.aviso(avisoReasignar, `La orden pasó a ${orden.mecanico.nombre}.`, 'ok');
      await cargar();
    } catch (error) {
      dom.aviso(avisoReasignar, error.message, 'error', error.detalles || []);
    }
  });

  const ETIQUETA_DE_CAMBIO = { EN_PROCESO: 'Reabierta', FINALIZADA: 'Finalizada', CANCELADA: 'Cancelada' };

  async function cargarHistorialDeEstados(id) {
    const lista = $('#historial-estados');
    lista.replaceChildren();
    const cambios = await api.pedir(`/api/ordenes/${id}/historial`);
    cambios.forEach((cambio) => {
      const item = dom.crear('li');
      const titulo = cambio.estadoAnterior ? ETIQUETA_DE_CAMBIO[cambio.estadoNuevo] : 'Creada';
      item.appendChild(dom.crear('span', { texto: `${titulo} por ${cambio.usuario}` }));
      item.appendChild(dom.crear('span', { clase: 'fecha', texto: formato.fechaSqlite(cambio.fecha) }));
      if (cambio.motivo) item.appendChild(dom.crear('span', { clase: 'motivo', texto: cambio.motivo }));
      lista.appendChild(item);
    });
  }

  // ------------------------------------------------------------------ Notas
  const formularioNotas = $('#formulario-notas');
  const campoNotas = $('#notas-orden');
  const avisoNotas = $('#aviso-notas');

  function pintarNotas(orden) {
    const editable = puedeTrabajar();
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
      // Los agotados se pueden elegir: no para registrarlos, sino para avisar que hacen falta.
      const opcion = dom.crear('option', { texto: `${r.sku}: ${r.nombre} (${r.stockActual === 0 ? 'agotado' : `quedan ${r.stockActual}`})` });
      opcion.value = r.id;
      select.appendChild(opcion);
    });
  }

  async function abrirDetalle(id) {
    avisoUsado.textContent = '';
    avisoNotas.textContent = '';
    avisoReasignar.textContent = '';
    try {
      const orden = await api.pedir(`/api/ordenes/${id}`);
      pintarDetalle(orden);
      await cargarHistorialDeEstados(id);
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

  $('#acciones-estado').addEventListener('click', (evento) => {
    const boton = evento.target.closest('button[data-cambiar]');
    if (boton) pedirCambioDeEstado(Number(boton.dataset.cambiar), boton.dataset.destino);
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

  // El mecánico avisa que el repuesto falta o no sirve para este trabajo, aunque el sistema diga que hay.
  $('#boton-reportar-faltante').addEventListener('click', async () => {
    avisoUsado.textContent = '';
    const repuestoId = $('#usado-repuesto').value;
    if (!repuestoId) {
      dom.aviso(avisoUsado, 'Selecciona primero el repuesto que hace falta.', 'error');
      return;
    }
    try {
      const alerta = await api.enviar(`/api/repuestos/${repuestoId}/faltantes`, 'POST', {
        nota: `Para la orden #${ordenAbierta.id} (${ordenAbierta.vehiculo.placa})`,
      });
      dom.aviso(avisoUsado, `Se avisó al dueño que falta ${alerta.repuesto.sku}.`, 'ok');
    } catch (error) {
      dom.aviso(avisoUsado, error.message, 'error', error.detalles || []);
    }
  });

  // ----------------------------------------------- Mi resumen (mecánico)
  function tarjetaDeResumen(titulo, valor, nota) {
    const tarjeta = dom.crear('div', { clase: 'indicador' });
    tarjeta.appendChild(dom.crear('p', { clase: 'indicador__titulo', texto: titulo }));
    tarjeta.appendChild(dom.crear('p', { clase: 'indicador__valor', texto: valor }));
    if (nota) tarjeta.appendChild(dom.crear('p', { clase: 'indicador__nota', texto: nota }));
    return tarjeta;
  }

  async function cargarMiResumen() {
    const franja = $('#franja-mi-resumen');
    franja.hidden = usuario.rol !== 'mecanico';
    if (franja.hidden) return;
    try {
      const r = await api.pedir('/api/ordenes/mi-resumen');
      let antigua = 'Sin órdenes abiertas';
      if (r.diasDeLaMasAntigua !== null) {
        antigua = r.diasDeLaMasAntigua === 0 ? 'La más antigua es de hoy' : `La más antigua lleva ${r.diasDeLaMasAntigua} ${r.diasDeLaMasAntigua === 1 ? 'día' : 'días'}`;
      }
      $('#mi-resumen').replaceChildren(
        tarjetaDeResumen('Mis órdenes en proceso', String(r.enProceso), antigua),
        tarjetaDeResumen('Finalizadas', String(r.finalizadas), `En los últimos ${r.dias} días`),
        tarjetaDeResumen('Repuestos que usé', String(r.repuestosUsados), `Unidades, últimos ${r.dias} días`),
      );
    } catch {
      franja.hidden = true;
    }
  }

  // ------------------------------- Completar con datos ya registrados (recepción)
  const pistaCliente = $('#pista-cliente');
  const pistaVehiculo = $('#pista-vehiculo');
  const campo = (nombre) => formulario.elements[nombre];

  /** Solo rellena lo que está vacío: nunca pisa lo que la persona ya escribió. */
  function completar(valores) {
    Object.entries(valores).forEach(([nombre, valor]) => {
      if (valor !== null && valor !== undefined && campo(nombre).value.trim() === '') campo(nombre).value = valor;
    });
  }

  campo('cliente.documento').addEventListener('change', async () => {
    pistaCliente.textContent = '';
    const documento = campo('cliente.documento').value.trim();
    if (!consultaClientes() || documento === '') return;
    try {
      const { datos } = await api.pedir(`/api/clientes?${new URLSearchParams({ documento })}`);
      if (datos.length === 0) return;
      const [cliente] = datos;
      completar({ 'cliente.nombre': cliente.nombre, 'cliente.telefono': cliente.telefono, 'cliente.email': cliente.email });
      pistaCliente.textContent = `Cliente registrado: ${cliente.nombre}, con ${cliente.ordenes} ${cliente.ordenes === 1 ? 'orden anterior' : 'órdenes anteriores'}.`;
    } catch { /* sin datos previos: se llena a mano */ }
  });

  campo('vehiculo.placa').addEventListener('change', async () => {
    pistaVehiculo.textContent = '';
    const placa = campo('vehiculo.placa').value.trim();
    if (!consultaClientes() || placa === '') return;
    try {
      const { vehiculo, cliente, ordenes } = await api.pedir(`/api/vehiculos/${encodeURIComponent(placa)}`);
      completar({ 'vehiculo.marca': vehiculo.marca, 'vehiculo.modelo': vehiculo.modelo, 'vehiculo.anio': vehiculo.anio });
      const abiertas = ordenes.filter((o) => o.estado === 'EN_PROCESO').length;
      pistaVehiculo.textContent = `Vehículo registrado a nombre de ${cliente.nombre}: ${ordenes.length} ${ordenes.length === 1 ? 'orden anterior' : 'órdenes anteriores'}`
        + `${abiertas > 0 ? `, ${abiertas} todavía en proceso` : ''}.`;
    } catch { /* placa nueva o incompleta: se llena a mano */ }
  });

  formulario.addEventListener('reset', () => {
    pistaCliente.textContent = '';
    pistaVehiculo.textContent = '';
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
      await cargarMiResumen();
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
      // El mecánico trabaja sobre el tablero; los demás roles arrancan en la lista.
      let guardado = null;
      try { guardado = window.sessionStorage.getItem(CLAVE_MODO); } catch { /* almacenamiento no disponible */ }
      aplicarModo(guardado || (esMecanico ? 'tablero' : 'lista'));
      await cargarMiResumen();
      pagina = 1;
      await cargar();
    },
  };
}());
