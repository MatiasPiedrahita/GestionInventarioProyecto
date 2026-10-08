/* global window, fetch, sessionStorage */
/**
 * Cliente HTTP del frontend. Agrega el token de sesión a cada petición y,
 * si el servidor responde 401, avisa para volver a la pantalla de login.
 *
 * El token se guarda en sessionStorage: se borra al cerrar la pestaña,
 * que es lo prudente en computadores compartidos del taller.
 */
window.Taller = window.Taller || { vistas: {} };

window.Taller.api = (function crearApi() {
  const CLAVE = 'taller.token';
  let alPerderSesion = () => {};

  function token() {
    return sessionStorage.getItem(CLAVE);
  }

  function guardarToken(valor) {
    if (valor) sessionStorage.setItem(CLAVE, valor);
    else sessionStorage.removeItem(CLAVE);
  }

  async function pedir(url, opciones = {}) {
    const cabeceras = { ...(opciones.headers || {}) };
    if (token()) cabeceras.Authorization = `Bearer ${token()}`;

    const respuesta = await fetch(url, { ...opciones, headers: cabeceras });
    if (respuesta.status === 204) return null;
    const cuerpo = await respuesta.json().catch(() => ({}));

    if (respuesta.status === 401 && !url.endsWith('/api/auth/login')) {
      guardarToken(null);
      alPerderSesion(cuerpo.mensaje);
    }
    if (!respuesta.ok) {
      const error = new Error(cuerpo.mensaje || `Error ${respuesta.status}`);
      error.status = respuesta.status;
      error.detalles = cuerpo.detalles || [];
      throw error;
    }
    return cuerpo;
  }

  /** Atajo para enviar JSON. */
  function enviar(url, metodo, datos) {
    return pedir(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
  }

  return {
    pedir,
    enviar,
    token,
    guardarToken,
    alPerderSesion: (fn) => { alPerderSesion = fn; },
  };
}());
