/* global window, document */
/**
 * Vista "Clientes y vehículos" (recepción, dueño y administrador): buscar un
 * cliente por nombre, documento, teléfono o placa, corregir su contacto y
 * revisar sus vehículos y el historial de órdenes.
 */
window.Taller.vistas.clientes = (function crearVistaClientes() {
  const { api, dom, formato } = window.Taller;
  const $ = (selector) => document.querySelector(selector);

  const busqueda = $('#busqueda-clientes');
  const cuerpo = $('#cuerpo-clientes');
  const aviso = $('#aviso-clientes');
  const dialogo = $('#dialogo-cliente');
  const formulario = $('#formulario-cliente');
  const avisoContacto = $('#aviso-contacto');
  let pagina = 1;
  let clienteAbierto = null;

  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  function celdaVacia(tabla, columnas, texto) {
    const fila = dom.crear('tr');
    const celda = dom.crear('td', { clase: 'vacio', texto });
    celda.colSpan = columnas;
    fila.appendChild(celda);
    tabla.replaceChildren(fila);
  }

  function construirFila(cliente) {
    const fila = dom.crear('tr');
    const nombre = dom.crear('td', { texto: cliente.nombre });
    nombre.appendChild(dom.crear('span', { clase: 'detalle', texto: `CC ${cliente.documento}` }));
    fila.appendChild(nombre);
    const contacto = dom.crear('td', { texto: cliente.telefono });
    if (cliente.email) contacto.appendChild(dom.crear('span', { clase: 'detalle', texto: cliente.email }));
    fila.appendChild(contacto);
    fila.appendChild(dom.crear('td', { clase: 'num', texto: cliente.vehiculos }));
    fila.appendChild(dom.crear('td', { clase: 'num', texto: cliente.ordenes }));
    fila.appendChild(dom.crear('td', { texto: cliente.ultimaOrden ? formato.fechaSqlite(cliente.ultimaOrden) : 'Sin órdenes' }));
    const acciones = dom.crear('td');
    const ver = dom.crear('button', { clase: 'boton boton--secundario boton--chico', texto: 'Ver' });
    ver.type = 'button';
    ver.dataset.cliente = cliente.id;
    ver.setAttribute('aria-label', `Ver la ficha de ${cliente.nombre}`);
    acciones.appendChild(ver);
    fila.appendChild(acciones);
    return fila;
  }

  async function cargar() {
    aviso.textContent = '';
    const parametros = new URLSearchParams({ pagina });
    if (busqueda.value.trim()) parametros.set('q', busqueda.value.trim());
    try {
      const resultado = await api.pedir(`/api/clientes?${parametros}`);
      if (resultado.datos.length === 0) {
        celdaVacia(cuerpo, 6, busqueda.value.trim()
          ? 'Ningún cliente coincide. Prueba con el documento completo o con la placa.'
          : 'Todavía no hay clientes. Se registran al crear su primera orden.');
      } else {
        cuerpo.replaceChildren(...resultado.datos.map(construirFila));
      }
      $('#resumen-clientes').textContent = plural(resultado.total, 'cliente', 'clientes');
      $('#clientes-pagina').textContent = `Página ${resultado.pagina} de ${resultado.totalPaginas}`;
      $('#clientes-anterior').disabled = resultado.pagina <= 1;
      $('#clientes-siguiente').disabled = resultado.pagina >= resultado.totalPaginas;
      $('#paginacion-clientes').hidden = resultado.totalPaginas <= 1;
    } catch (error) {
      dom.aviso(aviso, `No se pudieron cargar los clientes: ${error.message}`, 'error', error.detalles || []);
    }
  }

  // ------------------------------------------------------------------ Ficha
  function chipEstado(orden) {
    return dom.crear('span', { clase: `estado estado--${orden.estado.toLowerCase()}`, texto: orden.estadoNombre });
  }

  function pintarFicha(cliente) {
    clienteAbierto = cliente;
    $('#titulo-cliente').textContent = cliente.nombre;
    $('#documento-cliente').textContent = `CC ${cliente.documento}`;
    ['nombre', 'telefono'].forEach((campo) => { formulario.elements[campo].value = cliente[campo]; });
    formulario.elements.email.value = cliente.email || '';

    $('#vehiculos-cliente').replaceChildren(...cliente.vehiculos.map((v) => {
      const item = dom.crear('li');
      item.appendChild(dom.crear('span', { clase: 'placa', texto: v.placa }));
      item.appendChild(dom.crear('span', { texto: `${v.marca} ${v.modelo}${v.anio ? ` (${v.anio})` : ''}` }));
      item.appendChild(dom.crear('span', { clase: 'detalle', texto: plural(v.ordenes, 'orden', 'órdenes') }));
      return item;
    }));
    if (cliente.vehiculos.length === 0) {
      $('#vehiculos-cliente').replaceChildren(dom.crear('li', { clase: 'detalle', texto: 'No tiene vehículos a su nombre en este momento.' }));
    }

    const historial = $('#cuerpo-historial-cliente');
    if (cliente.ordenes.length === 0) {
      celdaVacia(historial, 5, 'Sin órdenes registradas.');
    } else {
      historial.replaceChildren(...cliente.ordenes.map((orden) => {
        const fila = dom.crear('tr');
        const numero = dom.crear('td', { clase: 'num-orden', texto: `#${orden.id}` });
        numero.appendChild(dom.crear('span', { clase: 'detalle', texto: formato.fechaSqlite(orden.creadoEn) }));
        fila.appendChild(numero);
        const vehiculo = dom.crear('td');
        vehiculo.appendChild(dom.crear('span', { clase: 'placa', texto: orden.placa }));
        fila.appendChild(vehiculo);
        const problema = dom.crear('td');
        problema.appendChild(dom.crear('span', { clase: 'recortado', texto: orden.descripcion }));
        fila.appendChild(problema);
        fila.appendChild(dom.crear('td', { texto: orden.mecanico }));
        const estado = dom.crear('td');
        estado.appendChild(chipEstado(orden));
        fila.appendChild(estado);
        return fila;
      }));
    }
  }

  async function abrirFicha(id) {
    avisoContacto.textContent = '';
    dom.limpiarErrores(formulario);
    try {
      pintarFicha(await api.pedir(`/api/clientes/${id}`));
      if (!dialogo.open) dialogo.showModal();
    } catch (error) {
      dom.aviso(aviso, error.message, 'error');
    }
  }

  cuerpo.addEventListener('click', (evento) => {
    const boton = evento.target.closest('button[data-cliente]');
    if (boton) abrirFicha(Number(boton.dataset.cliente));
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    dom.limpiarErrores(formulario);
    avisoContacto.textContent = '';
    try {
      const cliente = await api.enviar(`/api/clientes/${clienteAbierto.id}`, 'PUT', Object.fromEntries(new FormData(formulario)));
      pintarFicha(cliente);
      dom.aviso(avisoContacto, 'Datos de contacto guardados.', 'ok');
      await cargar();
    } catch (error) {
      const sinCampo = dom.marcarErrores(formulario, error.detalles || []);
      dom.aviso(avisoContacto, error.message, 'error', sinCampo);
    }
  });

  let temporizador;
  busqueda.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { pagina = 1; cargar(); }, 300);
  });
  $('#clientes-anterior').addEventListener('click', () => { pagina -= 1; cargar(); });
  $('#clientes-siguiente').addEventListener('click', () => { pagina += 1; cargar(); });

  return {
    alMostrar() {
      pagina = 1;
      return cargar();
    },
  };
}());
