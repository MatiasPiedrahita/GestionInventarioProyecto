/* global window, document */
/**
 * Vista "Mi cuenta": la ve cualquier rol. Permite cambiar la contraseña y
 * cerrar la sesión en todos los dispositivos.
 */
window.Taller.vistas.cuenta = (function crearVistaCuenta() {
  const { api, dom } = window.Taller;
  const $ = (selector) => document.querySelector(selector);

  const formulario = $('#formulario-password');
  const aviso = $('#aviso-password');
  let usuario = null;

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    dom.limpiarErrores(formulario);
    aviso.textContent = '';
    const { actual, nueva, confirmar } = Object.fromEntries(new FormData(formulario));
    if (nueva !== confirmar) {
      dom.marcarErrores(formulario, [{ campo: 'confirmar', mensaje: 'No coincide con la contraseña nueva' }]);
      return;
    }
    try {
      const respuesta = await api.enviar('/api/auth/password', 'POST', { actual, nueva });
      formulario.reset();
      dom.aviso(aviso, 'Contraseña actualizada. Se cerró tu sesión en los demás dispositivos.', 'ok');
      // El enrutador escucha este evento para levantar el bloqueo de la contraseña temporal.
      document.dispatchEvent(new window.CustomEvent('taller:password-cambiada', { detail: respuesta.usuario }));
    } catch (error) {
      const sinCampo = dom.marcarErrores(formulario, error.detalles || []);
      dom.aviso(aviso, error.message, 'error', sinCampo);
    }
  });

  $('#boton-cerrar-todas').addEventListener('click', async () => {
    try {
      await api.pedir('/api/auth/logout-todas', { method: 'POST' });
    } catch { /* si la sesión ya no existía, igual se sale */ }
    document.dispatchEvent(new window.CustomEvent('taller:sesion-cerrada'));
  });

  // ------------------------------------------------------ Avisos por correo
  const formularioAvisos = $('#formulario-avisos');
  const avisoAvisos = $('#aviso-avisos');

  async function cargarPreferencias() {
    dom.limpiarErrores(formularioAvisos);
    avisoAvisos.textContent = '';
    try {
      const preferencias = await api.pedir('/api/notificaciones/preferencias');
      formularioAvisos.elements.email.value = preferencias.email || '';
      formularioAvisos.elements.notificarPorCorreo.checked = preferencias.notificarPorCorreo;
    } catch { /* con contraseña temporal todavía no se pueden consultar */ }
  }

  formularioAvisos.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    dom.limpiarErrores(formularioAvisos);
    avisoAvisos.textContent = '';
    try {
      const guardadas = await api.enviar('/api/notificaciones/preferencias', 'PUT', {
        email: formularioAvisos.elements.email.value,
        notificarPorCorreo: formularioAvisos.elements.notificarPorCorreo.checked,
      });
      dom.aviso(avisoAvisos, guardadas.notificarPorCorreo
        ? `Listo: los avisos también llegarán a ${guardadas.email}.`
        : 'Listo: los avisos llegarán solo a la campana de la aplicación.', 'ok');
    } catch (error) {
      const sinCampo = dom.marcarErrores(formularioAvisos, error.detalles || []);
      dom.aviso(avisoAvisos, error.message, 'error', sinCampo);
    }
  });

  return {
    alMostrar(usuarioActual) {
      usuario = usuarioActual;
      formularioAvisos.closest('section').hidden = usuario.debeCambiarPassword;
      if (!usuario.debeCambiarPassword) cargarPreferencias();
      formulario.reset();
      dom.limpiarErrores(formulario);
      aviso.textContent = '';
      $('#resumen-cuenta').textContent = `${usuario.nombre} · usuario ${usuario.usuario} · ${usuario.nombreRol}`;
      $('#aviso-password-temporal').hidden = !usuario.debeCambiarPassword;
    },
  };
}());
