/* global document, FileReader, window */
/**
 * Vista "Inventario" (HU-01): solo para dueño y administrador.
 * Se registra en window.Taller.vistas y el enrutador llama alMostrar().
 */
window.Taller.vistas.inventario = (function crearVistaInventario() {
  const API = '/api/repuestos';
  const { pesos, fechas } = window.Taller.formato;

  const $ = (selector) => document.querySelector(selector);
  const formulario = $('#formulario');
  const cuerpoTabla = $('#cuerpo-tabla');
  const busqueda = $('#busqueda');
  const soloBajoStock = $('#solo-bajo-stock');
  const avisoFormulario = $('#aviso-formulario');
  const avisoTabla = $('#aviso-tabla');
  const resumen = $('#resumen');
  const botonCancelar = $('#boton-cancelar');
  const botonGuardar = $('#boton-guardar');
  const tituloFormulario = $('#titulo-formulario');
  const dialogo = $('#dialogo-historial');

  const ETIQUETAS_MOVIMIENTO = {
    ALTA: 'Registro inicial',
    AJUSTE: 'Ajuste de stock',
    BAJA: 'Dado de baja',
    CARGA_CSV: 'Carga por CSV',
  };

  let repuestosVisibles = [];

  const { pedir } = window.Taller.api;

  function crear(etiqueta, { clase, texto } = {}) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto !== undefined) el.textContent = texto;
    return el;
  }

  function mostrarAviso(destino, mensaje, tipo, detalles = []) {
    destino.className = `aviso aviso--${tipo}`;
    destino.textContent = mensaje;
    if (detalles.length > 0) {
      const lista = crear('ul');
      detalles.forEach((d) => {
        const prefijo = d.fila ? `Fila ${d.fila}: ` : '';
        lista.appendChild(crear('li', { texto: `${prefijo}${d.mensaje}` }));
      });
      destino.appendChild(lista);
    }
  }

  function limpiarErroresDeCampos() {
    formulario.querySelectorAll('[data-error]').forEach((p) => { p.textContent = ''; });
    formulario.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  }

  function marcarErroresDeCampos(detalles) {
    let sinCampo = [];
    detalles.forEach(({ campo, mensaje }) => {
      const destino = formulario.querySelector(`[data-error="${campo}"]`);
      const entrada = formulario.elements[campo];
      if (destino && entrada) {
        destino.textContent = mensaje;
        entrada.setAttribute('aria-invalid', 'true');
      } else {
        sinCampo = sinCampo.concat({ mensaje });
      }
    });
    const primero = formulario.querySelector('[aria-invalid="true"]');
    if (primero) primero.focus();
    return sinCampo;
  }

  function construirVarilla(repuesto) {
    const escala = Math.max(repuesto.stockMinimo * 3, repuesto.stockActual, 1);
    const contenedor = crear('div', { clase: 'varilla' });
    const pista = crear('div', { clase: 'varilla__pista' });
    const nivel = crear('div', { clase: 'varilla__nivel' });
    nivel.style.width = `${(repuesto.stockActual / escala) * 100}%`;
    pista.appendChild(nivel);
    if (repuesto.stockMinimo > 0) {
      const marca = crear('div', { clase: 'varilla__minimo' });
      marca.style.left = `calc(${(repuesto.stockMinimo / escala) * 100}% - 1px)`;
      pista.appendChild(marca);
    }
    pista.setAttribute('role', 'img');
    pista.setAttribute('aria-label', `${repuesto.stockActual} unidades, mínimo ${repuesto.stockMinimo}`);
    contenedor.appendChild(pista);

    const unidades = repuesto.stockActual === 1 ? 'unidad' : 'unidades';
    const texto = repuesto.bajoStock
      ? `${repuesto.stockActual} ${unidades}, por agotarse (mínimo ${repuesto.stockMinimo})`
      : `${repuesto.stockActual} ${unidades}, mínimo ${repuesto.stockMinimo}`;
    contenedor.appendChild(crear('span', { clase: 'varilla__texto', texto }));
    return contenedor;
  }

  function construirFila(repuesto) {
    const fila = crear('tr', { clase: repuesto.bajoStock ? 'bajo' : '' });

    fila.appendChild(crear('td', { clase: 'sku', texto: repuesto.sku }));

    const celdaNombre = crear('td');
    celdaNombre.appendChild(document.createTextNode(repuesto.nombre));
    const extra = [repuesto.proveedor, repuesto.ubicacion].filter(Boolean).join(', ');
    if (extra) celdaNombre.appendChild(crear('span', { clase: 'detalle', texto: extra }));
    fila.appendChild(celdaNombre);

    fila.appendChild(crear('td', { clase: 'num', texto: pesos.format(repuesto.costo) }));

    const celdaStock = crear('td');
    celdaStock.appendChild(construirVarilla(repuesto));
    fila.appendChild(celdaStock);

    const celdaAcciones = crear('td');
    const acciones = crear('div', { clase: 'acciones-fila' });
    [
      ['Editar', 'editar', ''],
      ['Historial', 'historial', ''],
      ['Dar de baja', 'baja', 'peligro'],
    ].forEach(([texto, accion, clase]) => {
      const boton = crear('button', { texto, clase });
      boton.type = 'button';
      boton.dataset.accion = accion;
      boton.dataset.id = repuesto.id;
      boton.setAttribute('aria-label', `${texto}: ${repuesto.nombre}`);
      acciones.appendChild(boton);
    });
    celdaAcciones.appendChild(acciones);
    fila.appendChild(celdaAcciones);

    return fila;
  }

  function pintarTabla() {
    cuerpoTabla.replaceChildren();
    if (repuestosVisibles.length === 0) {
      const fila = crear('tr');
      const celda = crear('td', {
        clase: 'vacio',
        texto: busqueda.value || soloBajoStock.checked
          ? 'Ningún repuesto coincide con el filtro. Prueba con otro término o quita el filtro.'
          : 'El inventario está vacío. Registra el primer repuesto con el formulario o importa un CSV.',
      });
      celda.colSpan = 5;
      fila.appendChild(celda);
      cuerpoTabla.appendChild(fila);
      return;
    }
    repuestosVisibles.forEach((r) => cuerpoTabla.appendChild(construirFila(r)));
  }

  async function actualizarResumen() {
    const todos = await pedir(API);
    const bajos = todos.filter((r) => r.bajoStock).length;
    resumen.replaceChildren(
      document.createTextNode(`${todos.length} repuestos en catálogo. `),
    );
    if (bajos > 0) {
      resumen.appendChild(crear('strong', { texto: `${bajos} por debajo del mínimo.` }));
    } else {
      resumen.appendChild(document.createTextNode('Ninguno por debajo del mínimo.'));
    }
  }

  async function cargar() {
    const parametros = new URLSearchParams();
    if (busqueda.value.trim()) parametros.set('q', busqueda.value.trim());
    if (soloBajoStock.checked) parametros.set('bajoStock', 'true');
    try {
      repuestosVisibles = await pedir(`${API}?${parametros}`);
      pintarTabla();
      await actualizarResumen();
    } catch (error) {
      mostrarAviso(avisoTabla, `No se pudo cargar el inventario: ${error.message}`, 'error');
    }
  }

  function modoCrear() {
    formulario.reset();
    formulario.elements.id.value = '';
    tituloFormulario.textContent = 'Registrar repuesto';
    botonGuardar.textContent = 'Guardar repuesto';
    botonCancelar.hidden = true;
    limpiarErroresDeCampos();
  }

  function modoEditar(repuesto) {
    limpiarErroresDeCampos();
    avisoFormulario.textContent = '';
    ['id', 'sku', 'nombre', 'costo', 'stockActual', 'stockMinimo', 'proveedor', 'ubicacion'].forEach((campo) => {
      formulario.elements[campo].value = repuesto[campo] ?? '';
    });
    tituloFormulario.textContent = `Editar ${repuesto.sku}`;
    botonGuardar.textContent = 'Guardar cambios';
    botonCancelar.hidden = false;
    formulario.elements.nombre.focus();
  }

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    limpiarErroresDeCampos();
    avisoFormulario.textContent = '';

    const datos = Object.fromEntries(new FormData(formulario));
    const id = datos.id;
    delete datos.id;

    try {
      const guardado = await pedir(id ? `${API}/${id}` : API, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
      });
      modoCrear();
      mostrarAviso(avisoFormulario, `${guardado.sku} guardado.`, 'ok');
      await cargar();
    } catch (error) {
      const sinCampo = marcarErroresDeCampos(error.detalles || []);
      mostrarAviso(avisoFormulario, error.message, 'error', sinCampo);
    }
  });

  botonCancelar.addEventListener('click', () => {
    modoCrear();
    avisoFormulario.textContent = '';
  });

  cuerpoTabla.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const id = Number(boton.dataset.id);
    const repuesto = repuestosVisibles.find((r) => r.id === id);
    if (!repuesto) return;

    if (boton.dataset.accion === 'editar') {
      modoEditar(repuesto);
    }

    if (boton.dataset.accion === 'baja') {
      if (!window.confirm(`¿Dar de baja ${repuesto.sku}? Dejará de aparecer en el catálogo, pero su historial se conserva.`)) return;
      try {
        await pedir(`${API}/${id}`, { method: 'DELETE' });
        mostrarAviso(avisoTabla, `${repuesto.sku} dado de baja.`, 'ok');
        if (formulario.elements.id.value === String(id)) modoCrear();
        await cargar();
      } catch (error) {
        mostrarAviso(avisoTabla, error.message, 'error');
      }
    }

    if (boton.dataset.accion === 'historial') {
      try {
        const movimientos = await pedir(`${API}/${id}/movimientos`);
        $('#titulo-historial').textContent = `Historial de ${repuesto.sku}`;
        const lista = $('#lista-historial');
        lista.replaceChildren();
        movimientos.forEach((m) => {
          const item = crear('li');
          item.appendChild(crear('span', { texto: ETIQUETAS_MOVIMIENTO[m.tipo] || m.tipo }));
          const signo = m.cantidad > 0 && m.tipo === 'AJUSTE' ? '+' : '';
          item.appendChild(crear('span', { clase: 'cantidad', texto: `${signo}${m.cantidad} (queda ${m.stockResultante})` }));
          item.appendChild(crear('span', { clase: 'fecha', texto: fechas.format(new Date(`${m.fecha.replace(' ', 'T')}Z`)) }));
          lista.appendChild(item);
        });
        dialogo.showModal();
      } catch (error) {
        mostrarAviso(avisoTabla, error.message, 'error');
      }
    }
  });

  let temporizador;
  busqueda.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(cargar, 250);
  });
  soloBajoStock.addEventListener('change', cargar);

  $('#archivo-csv').addEventListener('change', (evento) => {
    const archivo = evento.target.files[0];
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = async () => {
      try {
        const resultado = await pedir(`${API}/importar`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/csv' },
          body: lector.result,
        });
        mostrarAviso(avisoTabla, `Se importaron ${resultado.cantidad} repuestos desde ${archivo.name}.`, 'ok');
        await cargar();
      } catch (error) {
        mostrarAviso(avisoTabla, error.message, 'error', error.detalles || []);
      } finally {
        evento.target.value = '';
      }
    };
    lector.readAsText(archivo, 'utf-8');
  });

  return { alMostrar: cargar };
}());
