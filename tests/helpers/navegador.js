const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const request = require('supertest');
const { CLAVE_DE_PRUEBA } = require('./contexto');

const PUBLICO = path.join(__dirname, '..', '..', 'public');

/**
 * Abre la interfaz real (public/index.html y sus scripts) en un navegador
 * simulado con jsdom. Las peticiones fetch van a la aplicación Express de la
 * prueba, así que se ejercita el recorrido completo: interfaz → API → base
 * de datos en memoria, sin levantar un servidor ni un navegador de verdad.
 *
 *   const ctx = crearContexto();
 *   const nav = await abrirNavegador(ctx.app);
 *   await nav.iniciarSesion(ctx.usuario('mecanico'));
 */
async function abrirNavegador(app, { hash = '' } = {}) {
  const html = fs.readFileSync(path.join(PUBLICO, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  // Los scripts se evalúan a mano (en orden) y las hojas de estilo no hacen falta.
  const sinRecursos = html.replace(/<script src="[^"]+"><\/script>/g, '').replace(/<link [^>]+>/g, '');

  const dom = new JSDOM(sinRecursos, { url: `http://localhost/${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;

  // jsdom todavía no implementa la apertura de <dialog>.
  const prototipo = window.HTMLDialogElement.prototype;
  if (typeof prototipo.showModal !== 'function') {
    prototipo.showModal = function showModal() { this.setAttribute('open', ''); };
    prototipo.close = function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new window.Event('close'));
    };
  }

  const peticiones = [];
  window.fetch = async (url, opciones = {}) => {
    const metodo = (opciones.method || 'GET').toUpperCase();
    peticiones.push(`${metodo} ${url}`);
    let peticion = request(app)[metodo.toLowerCase()](url);
    Object.entries(opciones.headers || {}).forEach(([nombre, valor]) => { peticion = peticion.set(nombre, valor); });
    if (opciones.body !== undefined) peticion = peticion.send(opciones.body);
    const respuesta = await peticion;
    return {
      status: respuesta.status,
      ok: respuesta.status >= 200 && respuesta.status < 300,
      headers: { get: (nombre) => respuesta.headers[nombre.toLowerCase()] || null },
      json: async () => JSON.parse(respuesta.text),
      text: async () => respuesta.text,
    };
  };

  const errores = [];
  window.addEventListener('error', (evento) => errores.push(evento.error || evento.message));
  window.addEventListener('unhandledrejection', (evento) => errores.push(evento.reason));

  scripts.forEach((src) => window.eval(fs.readFileSync(path.join(PUBLICO, src), 'utf8')));

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  /** Espera a que la condición se cumpla (la interfaz responde de forma asíncrona). */
  async function esperar(condicion, descripcion = 'la condición', limiteMs = 2000) {
    const inicio = Date.now();
    for (;;) {
      let valor;
      try { valor = condicion(); } catch { valor = false; }
      if (valor) return valor;
      if (Date.now() - inicio > limiteMs) {
        throw new Error(`No se cumplió a tiempo: ${descripcion}${errores.length ? `. Errores de la página: ${errores.join(' | ')}` : ''}`);
      }
      await new Promise((resolver) => { setTimeout(resolver, 5); });
    }
  }

  function escribir(selector, valor) {
    const campo = $(selector);
    if (campo.type === 'checkbox') campo.checked = Boolean(valor);
    else campo.value = valor;
    campo.dispatchEvent(new window.Event('input', { bubbles: true }));
    campo.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  function clic(destino) {
    const elemento = typeof destino === 'string' ? $(destino) : destino;
    if (!elemento) throw new Error(`No existe el elemento para hacer clic: ${destino}`);
    elemento.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function enviar(selector) {
    $(selector).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  }

  /** Dispara un evento de arrastre con un dataTransfer mínimo (jsdom no lo trae). */
  function arrastre(tipo, elemento) {
    const evento = new window.Event(tipo, { bubbles: true, cancelable: true });
    evento.dataTransfer = { setData() {}, getData: () => '', effectAllowed: '', dropEffect: '' };
    elemento.dispatchEvent(evento);
    return evento;
  }

  const visible = (selector) => {
    let elemento = $(selector);
    if (!elemento) return false;
    for (; elemento && elemento !== document; elemento = elemento.parentElement) {
      if (elemento.hidden) return false;
      if (elemento.tagName === 'DIALOG' && !elemento.hasAttribute('open')) return false;
    }
    return true;
  };

  async function iniciarSesion(usuario, password = CLAVE_DE_PRUEBA) {
    await esperar(() => !$('#pantalla-login').hidden, 'que aparezca el login');
    escribir('#login-usuario', usuario.usuario);
    escribir('#login-password', password);
    enviar('#formulario-login');
    await esperar(() => !$('#pantalla-app').hidden || $('#aviso-login').textContent !== '', 'la respuesta del login');
  }

  return {
    window,
    document,
    $,
    $$,
    esperar,
    escribir,
    clic,
    enviar,
    arrastre,
    visible,
    iniciarSesion,
    peticiones,
    errores,
    textos: (selector) => $$(selector).map((el) => el.textContent.trim()),
    cerrar: () => window.close(),
  };
}

module.exports = { abrirNavegador };
