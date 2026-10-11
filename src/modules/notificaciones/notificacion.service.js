const { normalizarEmail } = require('../auth/email');
const { ErrorDeValidacion, NoEncontrado } = require('../../shared/errors');

const LIMITE_POR_DEFECTO = 20;
const LIMITE_MAXIMO = 50;
const CORREOS_EN_BANDEJA = 30;

/**
 * Notificaciones a los usuarios, por dos canales:
 *  - dentro de la aplicación (la campana), siempre;
 *  - por correo, solo a quien lo activó en "Mi cuenta" y tiene correo.
 *
 * El envío del correo no detiene la operación que lo originó: la
 * notificación queda guardada al instante y el correo se entrega aparte.
 * Si el servidor de correo falla, queda marcado como ERROR en la bandeja.
 *
 * @param {object} repositorio Repositorio de notificaciones.
 * @param {{ transporte: { modo: string, descripcion: string, remitente: string, enviar: Function } }} dependencias
 */
function crearServicioNotificaciones(repositorio, { transporte }) {
  const enviosEnCurso = new Set();

  function despachar(correoId, mensaje) {
    const envio = Promise.resolve()
      .then(() => transporte.enviar(mensaje))
      .then(() => repositorio.actualizarCorreo(correoId, 'ENVIADO'))
      .catch((error) => repositorio.actualizarCorreo(correoId, 'ERROR', String(error && error.message ? error.message : error).slice(0, 300)))
      .finally(() => enviosEnCurso.delete(envio));
    enviosEnCurso.add(envio);
  }

  function enviarCorreo(usuario, { asunto, cuerpo }) {
    const { email } = repositorio.preferenciasDe(usuario.id);
    const simulado = transporte.modo === 'simulado';
    const correoId = repositorio.insertarCorreo({
      usuarioId: usuario.id,
      destinatario: email,
      asunto,
      cuerpo,
      estado: simulado ? 'SIMULADO' : 'PENDIENTE',
    });
    if (simulado) {
      if (process.env.NODE_ENV !== 'test') console.log(`[correo simulado] Para: ${email} · Asunto: ${asunto}`);
      return;
    }
    despachar(correoId, { para: email, asunto, texto: cuerpo });
  }

  return {
    /**
     * Avisa a varios usuarios. Cada uno recibe todas las notificaciones en
     * la campana y, si lo pidió, UN correo que las resume (no uno por aviso).
     *
     * @param {{ id: number, nombre: string }[]} destinatarios
     * @param {{ tipo: string, titulo: string, mensaje: string, vista?: string, alertaId?: number }[]} notificaciones
     * @param {(usuario: object) => { asunto: string, cuerpo: string }} [armarCorreo]
     */
    enviar(destinatarios, notificaciones, armarCorreo = null) {
      if (notificaciones.length === 0) return;
      destinatarios.forEach((usuario) => {
        notificaciones.forEach((notificacion) => repositorio.insertar({ usuarioId: usuario.id, ...notificacion }));
        if (armarCorreo && repositorio.quiereCorreo(usuario.id)) enviarCorreo(usuario, armarCorreo(usuario));
      });
    },

    listar(usuario, query = {}) {
      const pedido = Number(query.limite);
      const limite = Number.isInteger(pedido) && pedido > 0 ? Math.min(pedido, LIMITE_MAXIMO) : LIMITE_POR_DEFECTO;
      return {
        noLeidas: repositorio.contarNoLeidas(usuario.id),
        datos: repositorio.listarDe(usuario.id, { soloNoLeidas: query.soloNoLeidas === 'true', limite }),
      };
    },

    resumen(usuario) {
      return { noLeidas: repositorio.contarNoLeidas(usuario.id) };
    },

    marcarLeida(id, usuario) {
      if (!repositorio.perteneceA(id, usuario.id)) throw new NoEncontrado('No existe esa notificación');
      repositorio.marcarLeida(id, usuario.id);
      return this.resumen(usuario);
    },

    marcarTodasLeidas(usuario) {
      repositorio.marcarTodasLeidas(usuario.id);
      return this.resumen(usuario);
    },

    preferencias(usuario) {
      return repositorio.preferenciasDe(usuario.id);
    },

    /** Cada usuario guarda su correo y decide si quiere recibir ahí los avisos. */
    guardarPreferencias(usuario, entrada) {
      const datos = entrada && typeof entrada === 'object' && !Array.isArray(entrada) ? entrada : {};
      const errores = [];
      const correo = normalizarEmail(datos.email);
      if (correo.error) errores.push({ campo: 'email', mensaje: correo.error });
      if (typeof datos.notificarPorCorreo !== 'boolean') {
        errores.push({ campo: 'notificarPorCorreo', mensaje: 'Indica si quieres recibir los avisos por correo (true o false)' });
      } else if (datos.notificarPorCorreo && !correo.error && !correo.valor) {
        errores.push({ campo: 'email', mensaje: 'Escribe tu correo para poder enviarte los avisos' });
      }
      if (errores.length > 0) throw new ErrorDeValidacion(errores);

      repositorio.guardarPreferencias(usuario.id, { email: correo.valor, notificarPorCorreo: datos.notificarPorCorreo });
      return repositorio.preferenciasDe(usuario.id);
    },

    /** Bandeja de salida para Administración: qué correos salieron (o saldrían) y a quién. */
    bandejaDeSalida() {
      return { modo: transporte.modo, descripcion: transporte.descripcion, correos: repositorio.listarCorreos(CORREOS_EN_BANDEJA) };
    },

    /** Sección "correo" del estado del sistema. */
    estadoDelCorreo() {
      return {
        modo: transporte.modo,
        descripcion: transporte.descripcion,
        remitente: transporte.remitente,
        porEstado: repositorio.contarCorreosPorEstado(),
      };
    },

    /** Espera a que terminen los envíos en curso (para las pruebas y para un cierre ordenado). */
    async esperarEnvios() {
      await Promise.all([...enviosEnCurso]);
    },
  };
}

module.exports = { crearServicioNotificaciones };
