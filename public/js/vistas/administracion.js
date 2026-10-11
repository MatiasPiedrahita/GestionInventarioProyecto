/* global window, document */
/**
 * Vista "Administración" (dueño y administrador): usuarios, auditoría y
 * estado del sistema. Qué puede hacer cada uno con cada cuenta lo decide la
 * API; aquí solo se ocultan las acciones que el servidor rechazaría.
 */
window.Taller.vistas.administracion = (function crearVistaAdministracion() {
  const { api, dom, formato } = window.Taller;
  const $ = (selector) => document.querySelector(selector);

  let usuarios = [];

  // ------------------------------------------------------------- Pestañas
  const PESTANAS = ['usuarios', 'auditoria', 'sistema'];
  const cargadores = {};

  function mostrarPestana(nombre) {
    PESTANAS.forEach((pestana) => {
      $(`#pestana-${pestana}`).setAttribute('aria-selected', String(pestana === nombre));
      $(`#panel-${pestana}`).hidden = pestana !== nombre;
    });
    cargadores[nombre]();
  }

  $('#pestanas-administracion').addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-pestana]');
    if (boton) mostrarPestana(boton.dataset.pestana);
  });

  // -------------------------------------------------------------- Usuarios
  const formulario = $('#formulario-usuario');
  const aviso = $('#aviso-usuario');
  const avisoTabla = $('#aviso-usuarios');
  const cuerpo = $('#cuerpo-usuarios');
  const selectRol = $('#usuario-rol');
  const credencial = $('#credencial-temporal');

  function estadoDe(usuario) {
    if (!usuario.activo) return { texto: 'Inactivo', clase: 'estado estado--cancelada' };
    if (usuario.bloqueado) return { texto: 'Bloqueado', clase: 'estado estado--alerta' };
    if (usuario.debeCambiarPassword) return { texto: 'Contraseña temporal', clase: 'estado estado--en_proceso' };
    return { texto: 'Activo', clase: 'estado estado--finalizada' };
  }

  function accionesDe(usuario) {
    if (!usuario.gestionable) return [];
    return [
      ['Editar', 'editar', ''],
      ['Nueva contraseña', 'password', ''],
      usuario.sesionesAbiertas > 0 ? ['Cerrar sesiones', 'sesiones', ''] : null,
      usuario.bloqueado ? ['Desbloquear', 'desbloquear', ''] : null,
      usuario.activo ? ['Desactivar', 'desactivar', 'peligro'] : ['Activar', 'activar', ''],
    ].filter(Boolean);
  }

  function construirFila(usuario) {
    const fila = dom.crear('tr', { clase: usuario.activo ? '' : 'inactivo' });
    fila.dataset.usuario = usuario.usuario;

    fila.appendChild(dom.crear('td', { clase: 'sku', texto: usuario.usuario }));
    const nombre = dom.crear('td', { texto: usuario.nombre });
    nombre.appendChild(dom.crear('span', { clase: 'detalle', texto: usuario.email || 'Sin correo' }));
    fila.appendChild(nombre);
    fila.appendChild(dom.crear('td', { texto: usuario.esYo ? `${usuario.nombreRol} (tú)` : usuario.nombreRol }));

    const estado = estadoDe(usuario);
    const celdaEstado = dom.crear('td');
    celdaEstado.appendChild(dom.crear('span', { clase: estado.clase, texto: estado.texto }));
    fila.appendChild(celdaEstado);
    fila.appendChild(dom.crear('td', { clase: 'num', texto: usuario.sesionesAbiertas }));

    const celdaAcciones = dom.crear('td');
    const acciones = dom.crear('div', { clase: 'acciones-fila' });
    accionesDe(usuario).forEach(([texto, accion, clase]) => {
      const boton = dom.crear('button', { texto, clase });
      boton.type = 'button';
      boton.dataset.accion = accion;
      boton.dataset.id = usuario.id;
      boton.setAttribute('aria-label', `${texto}: ${usuario.nombre}`);
      acciones.appendChild(boton);
    });
    celdaAcciones.appendChild(acciones);
    fila.appendChild(celdaAcciones);
    return fila;
  }

  function modoCrear() {
    formulario.reset();
    formulario.elements.id.value = '';
    formulario.elements.usuario.readOnly = false;
    dom.limpiarErrores(formulario);
    $('#titulo-formulario-usuario').textContent = 'Nuevo usuario';
    $('#boton-guardar-usuario').textContent = 'Crear usuario';
    $('#boton-cancelar-usuario').hidden = true;
    $('#ayuda-usuario').hidden = false;
  }

  function modoEditar(usuario) {
    dom.limpiarErrores(formulario);
    aviso.textContent = '';
    ['id', 'usuario', 'nombre', 'rol'].forEach((campo) => { formulario.elements[campo].value = usuario[campo]; });
    formulario.elements.email.value = usuario.email || '';
    // El nombre de usuario no se cambia: aparece en la auditoría y en las órdenes.
    formulario.elements.usuario.readOnly = true;
    $('#titulo-formulario-usuario').textContent = `Editar ${usuario.usuario}`;
    $('#boton-guardar-usuario').textContent = 'Guardar cambios';
    $('#boton-cancelar-usuario').hidden = false;
    $('#ayuda-usuario').hidden = true;
    formulario.elements.nombre.focus();
  }

  function mostrarCredencial(usuario, passwordTemporal) {
    $('#credencial-usuario').textContent = usuario.usuario;
    $('#credencial-valor').textContent = passwordTemporal;
    credencial.hidden = false;
  }

  async function cargarUsuarios() {
    try {
      const respuesta = await api.pedir('/api/usuarios');
      usuarios = respuesta.usuarios;
      const rolElegido = selectRol.value;
      selectRol.replaceChildren(...respuesta.rolesAsignables.map(({ rol, nombre }) => {
        const opcion = dom.crear('option', { texto: nombre });
        opcion.value = rol;
        return opcion;
      }));
      if (rolElegido) selectRol.value = rolElegido;
      cuerpo.replaceChildren(...usuarios.map(construirFila));
      const activos = usuarios.filter((u) => u.activo).length;
      $('#resumen-administracion').textContent = `${usuarios.length} usuarios, ${activos} activos.`;
    } catch (error) {
      dom.aviso(avisoTabla, `No se pudieron cargar los usuarios: ${error.message}`, 'error');
    }
  }

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    dom.limpiarErrores(formulario);
    aviso.textContent = '';
    const datos = Object.fromEntries(new FormData(formulario));
    const { id } = datos;
    delete datos.id;
    try {
      if (id) {
        const editado = await api.enviar(`/api/usuarios/${id}`, 'PUT', datos);
        modoCrear();
        dom.aviso(aviso, `Se guardaron los cambios de ${editado.usuario}.`, 'ok');
      } else {
        const { usuario, passwordTemporal } = await api.enviar('/api/usuarios', 'POST', datos);
        modoCrear();
        dom.aviso(aviso, `Usuario ${usuario.usuario} creado.`, 'ok');
        mostrarCredencial(usuario, passwordTemporal);
      }
      await cargarUsuarios();
    } catch (error) {
      const sinCampo = dom.marcarErrores(formulario, error.detalles || []);
      dom.aviso(aviso, error.message, 'error', sinCampo);
    }
  });

  $('#boton-cancelar-usuario').addEventListener('click', () => {
    modoCrear();
    aviso.textContent = '';
  });

  $('#boton-ocultar-credencial').addEventListener('click', () => {
    credencial.hidden = true;
    $('#credencial-valor').textContent = '';
  });

  const ACCIONES = {
    async password(usuario) {
      if (!window.confirm(`¿Asignar una contraseña temporal a ${usuario.nombre}? La actual dejará de servir y se cerrarán sus sesiones.`)) return null;
      const { passwordTemporal } = await api.pedir(`/api/usuarios/${usuario.id}/password`, { method: 'POST' });
      mostrarCredencial(usuario, passwordTemporal);
      return `Contraseña temporal asignada a ${usuario.usuario}.`;
    },
    async sesiones(usuario) {
      const { cerradas } = await api.pedir(`/api/usuarios/${usuario.id}/sesiones`, { method: 'DELETE' });
      return `Se cerraron ${cerradas} sesión(es) de ${usuario.usuario}.`;
    },
    async desbloquear(usuario) {
      await api.pedir(`/api/usuarios/${usuario.id}/desbloqueo`, { method: 'POST' });
      return `${usuario.usuario} ya puede volver a iniciar sesión.`;
    },
    async desactivar(usuario) {
      if (!window.confirm(`¿Desactivar a ${usuario.nombre}? No podrá iniciar sesión, pero su historial se conserva.`)) return null;
      await api.enviar(`/api/usuarios/${usuario.id}/estado`, 'PATCH', { activo: false });
      return `${usuario.usuario} quedó inactivo.`;
    },
    async activar(usuario) {
      await api.enviar(`/api/usuarios/${usuario.id}/estado`, 'PATCH', { activo: true });
      return `${usuario.usuario} quedó activo.`;
    },
  };

  cuerpo.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const usuario = usuarios.find((u) => u.id === Number(boton.dataset.id));
    if (!usuario) return;
    avisoTabla.textContent = '';
    if (boton.dataset.accion === 'editar') {
      modoEditar(usuario);
      return;
    }
    try {
      const mensaje = await ACCIONES[boton.dataset.accion](usuario);
      if (mensaje === null) return;
      await cargarUsuarios();
      dom.aviso(avisoTabla, mensaje, 'ok');
    } catch (error) {
      dom.aviso(avisoTabla, error.message, 'error', error.detalles || []);
    }
  });

  // ------------------------------------------------------------- Auditoría
  const filtrosAuditoria = $('#filtros-auditoria');
  const cuerpoAuditoria = $('#cuerpo-auditoria');
  const avisoAuditoria = $('#aviso-auditoria');
  let paginaAuditoria = 1;
  let catalogoCargado = false;

  function llenar(select, opciones, textoVacio) {
    const vacia = dom.crear('option', { texto: textoVacio });
    vacia.value = '';
    select.replaceChildren(vacia, ...opciones.map(([valor, texto]) => {
      const opcion = dom.crear('option', { texto });
      opcion.value = valor;
      return opcion;
    }));
  }

  async function cargarCatalogoDeAuditoria() {
    if (catalogoCargado) return;
    const [acciones, respuesta] = await Promise.all([api.pedir('/api/auditoria/acciones'), api.pedir('/api/usuarios')]);
    llenar($('#auditoria-accion'), acciones.map((a) => [a.accion, a.nombre]), 'Todas');
    llenar($('#auditoria-usuario'), respuesta.usuarios.map((u) => [u.id, `${u.nombre} (${u.usuario})`]), 'Todos');
    catalogoCargado = true;
  }

  function construirRegistro(registro) {
    const fila = dom.crear('tr');
    fila.appendChild(dom.crear('td', { clase: 'num-orden', texto: formato.fechaSqlite(registro.fecha) }));
    const quien = dom.crear('td', { texto: registro.usuario ? registro.usuario.nombre : 'Desconocido' });
    if (registro.usuario) quien.appendChild(dom.crear('span', { clase: 'detalle', texto: registro.usuario.usuario }));
    fila.appendChild(quien);
    fila.appendChild(dom.crear('td', { texto: registro.accionNombre }));
    const detalle = dom.crear('td', { texto: registro.detalle || '' });
    if (registro.ip) detalle.appendChild(dom.crear('span', { clase: 'detalle', texto: `Desde ${registro.ip}` }));
    fila.appendChild(detalle);
    return fila;
  }

  async function cargarAuditoria() {
    avisoAuditoria.textContent = '';
    try {
      await cargarCatalogoDeAuditoria();
      const parametros = new URLSearchParams();
      new FormData(filtrosAuditoria).forEach((valor, clave) => {
        if (String(valor).trim() !== '') parametros.set(clave, String(valor).trim());
      });
      parametros.set('pagina', paginaAuditoria);
      const resultado = await api.pedir(`/api/auditoria?${parametros}`);
      cuerpoAuditoria.replaceChildren(...resultado.datos.map(construirRegistro));
      if (resultado.datos.length === 0) {
        const fila = dom.crear('tr');
        const celda = dom.crear('td', { clase: 'vacio', texto: 'No hay registros con esos filtros.' });
        celda.colSpan = 4;
        fila.appendChild(celda);
        cuerpoAuditoria.appendChild(fila);
      }
      $('#info-auditoria').textContent = `${resultado.total} ${resultado.total === 1 ? 'registro' : 'registros'}`;
      $('#auditoria-pagina').textContent = `Página ${resultado.pagina} de ${resultado.totalPaginas}`;
      $('#auditoria-anterior').disabled = resultado.pagina <= 1;
      $('#auditoria-siguiente').disabled = resultado.pagina >= resultado.totalPaginas;
    } catch (error) {
      dom.aviso(avisoAuditoria, `No se pudo cargar la auditoría: ${error.message}`, 'error', error.detalles || []);
    }
  }

  filtrosAuditoria.addEventListener('change', () => { paginaAuditoria = 1; cargarAuditoria(); });
  filtrosAuditoria.addEventListener('submit', (evento) => { evento.preventDefault(); paginaAuditoria = 1; cargarAuditoria(); });
  filtrosAuditoria.addEventListener('reset', () => setTimeout(() => { paginaAuditoria = 1; cargarAuditoria(); }, 0));
  $('#auditoria-anterior').addEventListener('click', () => { paginaAuditoria -= 1; cargarAuditoria(); });
  $('#auditoria-siguiente').addEventListener('click', () => { paginaAuditoria += 1; cargarAuditoria(); });

  // --------------------------------------------------------------- Sistema
  function dato(lista, termino, valor) {
    lista.appendChild(dom.crear('dt', { texto: termino }));
    lista.appendChild(dom.crear('dd', { texto: valor }));
  }

  async function cargarSistema() {
    const ficha = $('#ficha-sistema');
    ficha.replaceChildren();
    try {
      const estado = await api.pedir('/api/sistema/estado');
      const { datos } = estado;
      dato(ficha, 'Versión de la aplicación', estado.version);
      dato(ficha, 'Versión de la base de datos', `Migración ${estado.versionDelEsquema}`);
      dato(ficha, 'Node.js', estado.node);
      dato(ficha, 'Encendido hace', `${estado.minutosEncendido} min`);
      dato(ficha, 'Usuarios', `${datos.usuariosActivos} activos, ${datos.usuariosInactivos} inactivos`);
      dato(ficha, 'Sesiones abiertas', datos.sesionesAbiertas);
      dato(ficha, 'Repuestos en catálogo', datos.repuestosActivos);
      dato(ficha, 'Órdenes', `${datos.ordenes} en total, ${datos.ordenesEnProceso} en proceso`);
      dato(ficha, 'Movimientos de inventario', datos.movimientos);
      dato(ficha, 'Registros de auditoría', datos.registrosDeAuditoria);
      if (estado.alertas) {
        dato(ficha, 'Alertas de stock', `${estado.alertas.activas} sin atender, ${estado.alertas.atendidas} con pedido hecho`);
      }
      if (estado.correo) dato(ficha, 'Correo', estado.correo.descripcion);
      (estado.tareas || []).forEach((tarea) => {
        const ultima = tarea.ultimaEjecucion ? `última vez ${formato.fechas.format(new Date(tarea.ultimaEjecucion))}` : 'todavía no ha corrido';
        dato(ficha, `Tarea: ${tarea.nombre}`, `Cada ${tarea.cadaMinutos} min, ${ultima}${tarea.ultimoError ? `. Error: ${tarea.ultimoError}` : ''}`);
      });
    } catch (error) {
      dato(ficha, 'Estado', `No disponible: ${error.message}`);
    }
    await cargarCorreos();
  }

  const ESTADO_DE_CORREO = { SIMULADO: 'Simulado (no se envió)', PENDIENTE: 'Enviando', ENVIADO: 'Enviado', ERROR: 'Falló' };

  async function cargarCorreos() {
    const cuerpoCorreos = $('#cuerpo-correos');
    try {
      const bandeja = await api.pedir('/api/correos');
      $('#modo-correo').textContent = bandeja.descripcion;
      cuerpoCorreos.replaceChildren(...bandeja.correos.map((correo) => {
        const fila = dom.crear('tr');
        fila.appendChild(dom.crear('td', { texto: formato.fechaSqlite(correo.creadoEn) }));
        const para = dom.crear('td', { texto: correo.destinatario });
        if (correo.usuario) para.appendChild(dom.crear('span', { clase: 'detalle', texto: correo.usuario }));
        fila.appendChild(para);
        const asunto = dom.crear('td');
        const detalles = dom.crear('details');
        detalles.appendChild(dom.crear('summary', { texto: correo.asunto }));
        detalles.appendChild(dom.crear('pre', { clase: 'correo__cuerpo', texto: correo.cuerpo }));
        asunto.appendChild(detalles);
        fila.appendChild(asunto);
        const estadoDelCorreo = dom.crear('td', { texto: ESTADO_DE_CORREO[correo.estado] || correo.estado });
        if (correo.error) estadoDelCorreo.appendChild(dom.crear('span', { clase: 'detalle', texto: correo.error }));
        fila.appendChild(estadoDelCorreo);
        return fila;
      }));
      if (bandeja.correos.length === 0) {
        const fila = dom.crear('tr');
        const celda = dom.crear('td', { clase: 'vacio', texto: 'Todavía no se ha generado ningún correo.' });
        celda.colSpan = 4;
        fila.appendChild(celda);
        cuerpoCorreos.appendChild(fila);
      }
    } catch (error) {
      $('#modo-correo').textContent = `No se pudo cargar la bandeja: ${error.message}`;
    }
  }

  cargadores.usuarios = cargarUsuarios;
  cargadores.auditoria = cargarAuditoria;
  cargadores.sistema = cargarSistema;

  return {
    alMostrar() {
      modoCrear();
      aviso.textContent = '';
      avisoTabla.textContent = '';
      credencial.hidden = true;
      catalogoCargado = false;
      paginaAuditoria = 1;
      mostrarPestana('usuarios');
    },
  };
}());
