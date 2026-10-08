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
      celda.colSpan = 6;
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
