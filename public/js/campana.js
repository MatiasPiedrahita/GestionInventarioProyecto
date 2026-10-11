/* global window, document */
/**
 * La campana de notificaciones de la barra superior. Muestra cuántos avisos
 * sin leer tiene el usuario, los lista al abrirla y lleva a la vista de cada
 * uno. Consulta el contador cada minuto mientras haya sesión.
 */
window.Taller.campana = (function crearCampana() {
  const { api, dom, formato } = window.Taller;
  const $ = (selector) => document.querySelector(selector);

  const SEGUNDOS_ENTRE_CONSULTAS = 60;
  const boton = $('#boton-campana');
  const contador = $('#contador-campana');
  const panel = $('#panel-notificaciones');
  const lista = $('#lista-notificaciones');
  let irA = () => {};
  let temporizador = null;

  function pintarContador(noLeidas) {
    contador.hidden = noLeidas === 0;
    contador.textContent = noLeidas > 99 ? '99+' : String(noLeidas);
    boton.setAttribute('aria-label', noLeidas === 0 ? 'Notificaciones' : `Notificaciones: ${noLeidas} sin leer`);
    $('#boton-leer-todas').hidden = noLeidas === 0;
  }

  async function refrescar() {
    try {
      pintarContador((await api.pedir('/api/notificaciones/resumen')).noLeidas);
    } catch { /* sin conexión o sin sesión: se intenta en la próxima consulta */ }
  }

  function construirItem(notificacion) {
    const item = dom.crear('li', { clase: notificacion.leida ? 'aviso-campana' : 'aviso-campana aviso-campana--nuevo' });
    const enlace = dom.crear('button', { clase: 'aviso-campana__boton' });
    enlace.type = 'button';
    enlace.dataset.notificacion = notificacion.id;
    enlace.dataset.vista = notificacion.vista || '';
    enlace.dataset.leida = String(notificacion.leida);
    enlace.appendChild(dom.crear('strong', { texto: notificacion.titulo }));
    enlace.appendChild(dom.crear('span', { texto: notificacion.mensaje }));
    enlace.appendChild(dom.crear('span', { clase: 'detalle', texto: `${notificacion.leida ? '' : 'Sin leer · '}${formato.fechaSqlite(notificacion.creadaEn)}` }));
    item.appendChild(enlace);
    return item;
  }

  async function cargarLista() {
    try {
      const { datos, noLeidas } = await api.pedir('/api/notificaciones');
      pintarContador(noLeidas);
      if (datos.length === 0) lista.replaceChildren(dom.crear('li', { clase: 'aviso-campana__vacio', texto: 'No tienes notificaciones.' }));
      else lista.replaceChildren(...datos.map(construirItem));
    } catch (error) {
      lista.replaceChildren(dom.crear('li', { clase: 'aviso-campana__vacio', texto: `No se pudieron cargar: ${error.message}` }));
    }
  }

  function cerrar() {
    panel.hidden = true;
    boton.setAttribute('aria-expanded', 'false');
  }

  async function abrir() {
    panel.hidden = false;
    boton.setAttribute('aria-expanded', 'true');
    await cargarLista();
  }

  boton.addEventListener('click', () => (panel.hidden ? abrir() : cerrar()));

  lista.addEventListener('click', async (evento) => {
    const enlace = evento.target.closest('button[data-notificacion]');
    if (!enlace) return;
    if (enlace.dataset.leida !== 'true') {
      try {
        pintarContador((await api.pedir(`/api/notificaciones/${enlace.dataset.notificacion}/leida`, { method: 'PATCH' })).noLeidas);
      } catch { /* si no se pudo marcar, igual se abre la vista */ }
    }
    cerrar();
    if (enlace.dataset.vista) irA(enlace.dataset.vista);
  });

  $('#boton-leer-todas').addEventListener('click', async () => {
    try {
      pintarContador((await api.pedir('/api/notificaciones/leer-todas', { method: 'POST' })).noLeidas);
      await cargarLista();
    } catch { /* se reintenta al volver a abrir */ }
  });

  // Se cierra con Escape o al hacer clic fuera, como cualquier menú desplegable.
  document.addEventListener('keydown', (evento) => { if (evento.key === 'Escape' && !panel.hidden) { cerrar(); boton.focus(); } });
  document.addEventListener('click', (evento) => { if (!panel.hidden && !evento.target.closest('#campana')) cerrar(); });

  return {
    /** @param {(vista: string) => void} navegar Función del enrutador para abrir una vista. */
    iniciar(navegar) {
      irA = navegar;
      this.detener();
      $('#campana').hidden = false;
      refrescar();
      temporizador = window.setInterval(refrescar, SEGUNDOS_ENTRE_CONSULTAS * 1000);
    },
    detener() {
      if (temporizador) window.clearInterval(temporizador);
      temporizador = null;
      cerrar();
      pintarContador(0);
      lista.replaceChildren();
      $('#campana').hidden = true;
    },
    refrescar,
  };
}());
