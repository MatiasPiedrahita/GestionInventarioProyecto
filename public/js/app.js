/* global window, document */
/**
 * Arranque y enrutador de la aplicación.
 * - Sin sesión: muestra el login.
 * - Con sesión: muestra solo las vistas permitidas para el rol y abre la
 *   vista inicial que indica el servidor (redirección por rol).
 * El backend vuelve a verificar el rol en cada petición: ocultar una vista
 * aquí es comodidad, la seguridad real está en la API.
 */
(function iniciarAplicacion() {
  const { api, dom, vistas } = window.Taller;
  const $ = (selector) => document.querySelector(selector);

  /** Qué roles ven cada vista del menú (en orden de aparición). */
  const MENU = [
    { vista: 'ordenes', etiqueta: 'Órdenes de trabajo', roles: ['mecanico', 'recepcionista', 'dueno', 'administrador'] },
    { vista: 'inventario', etiqueta: 'Inventario', roles: ['dueno', 'administrador'] },
  ];

  let usuarioActual = null;
  let vistaInicial = null;

  const pantallaLogin = $('#pantalla-login');
  const pantallaApp = $('#pantalla-app');
  const formularioLogin = $('#formulario-login');
  const avisoLogin = $('#aviso-login');
  const menu = $('#menu');

  function vistasPermitidas() {
    return MENU.filter((item) => item.roles.includes(usuarioActual.rol));
  }

  function mostrarVista(nombre) {
    const permitidas = vistasPermitidas().map((item) => item.vista);
    const destino = permitidas.includes(nombre) ? nombre : vistaInicial;

    document.querySelectorAll('.vista').forEach((seccion) => {
      seccion.hidden = seccion.dataset.vista !== destino;
    });
    menu.querySelectorAll('a').forEach((enlace) => {
      if (enlace.dataset.vista === destino) enlace.setAttribute('aria-current', 'page');
      else enlace.removeAttribute('aria-current');
    });
    if (window.location.hash !== `#${destino}`) window.history.replaceState(null, '', `#${destino}`);
    if (vistas[destino] && vistas[destino].alMostrar) vistas[destino].alMostrar(usuarioActual);
  }

  function construirMenu() {
    menu.replaceChildren();
    vistasPermitidas().forEach((item) => {
      const enlace = dom.crear('a', { texto: item.etiqueta });
      enlace.href = `#${item.vista}`;
      enlace.dataset.vista = item.vista;
      menu.appendChild(enlace);
    });
  }

  function entrar(usuario, inicial) {
    usuarioActual = usuario;
    vistaInicial = inicial;
    $('#nombre-usuario').textContent = usuario.nombre;
    $('#rol-usuario').textContent = usuario.nombreRol;
    document.body.dataset.rol = usuario.rol;
    construirMenu();
    pantallaLogin.hidden = true;
    pantallaApp.hidden = false;
    const pedida = window.location.hash.slice(1);
    mostrarVista(pedida || inicial);
  }

  function salir(mensaje) {
    usuarioActual = null;
    api.guardarToken(null);
    pantallaApp.hidden = true;
    pantallaLogin.hidden = false;
    formularioLogin.reset();
    avisoLogin.textContent = '';
    if (mensaje) dom.aviso(avisoLogin, mensaje, 'error');
    window.history.replaceState(null, '', window.location.pathname);
    formularioLogin.elements.usuario.focus();
  }

  formularioLogin.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    avisoLogin.textContent = '';
    const datos = Object.fromEntries(new FormData(formularioLogin));
    try {
      const sesion = await api.enviar('/api/auth/login', 'POST', datos);
      api.guardarToken(sesion.token);
      window.history.replaceState(null, '', window.location.pathname);
      entrar(sesion.usuario, sesion.vistaInicial);
    } catch (error) {
      dom.aviso(avisoLogin, error.message, 'error');
      formularioLogin.elements.password.select();
    }
  });

  $('#boton-salir').addEventListener('click', async () => {
    try { await api.pedir('/api/auth/logout', { method: 'POST' }); } catch { /* la sesión ya no existía */ }
    salir();
  });

  window.addEventListener('hashchange', () => {
    if (usuarioActual) mostrarVista(window.location.hash.slice(1));
  });

  api.alPerderSesion((mensaje) => salir(mensaje || 'Tu sesión terminó. Inicia sesión de nuevo.'));

  // Si ya había una sesión en esta pestaña, se retoma sin pedir login.
  (async function retomarSesion() {
    if (!api.token()) return salir();
    try {
      const { usuario, vistaInicial: inicial } = await api.pedir('/api/auth/yo');
      return entrar(usuario, inicial);
    } catch {
      return salir();
    }
  }());
}());
