const { TIPOS, TIPOS_DE_NIVEL, decidir, nivelDeStock, redactar, redactarCorreo } = require('./alerta.reglas');
const { ACCIONES } = require('../auditoria/acciones');
const { SIN_AUDITORIA } = require('../auditoria/auditoria.service');
const { ErrorDeValidacion, NoEncontrado, Conflicto } = require('../../shared/errors');

const LIMITE_NOTA = 200;
const TAMANO_DEL_HISTORIAL = 20;

function leerNota(entrada, campo) {
  const valor = entrada && typeof entrada === 'object' ? entrada[campo] : undefined;
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw new ErrorDeValidacion([{ campo, mensaje: 'La nota debe ser texto' }]);
  if (valor.trim().length > LIMITE_NOTA) throw new ErrorDeValidacion([{ campo, mensaje: `La nota admite máximo ${LIMITE_NOTA} caracteres` }]);
  return valor.trim() || null;
}

/**
 * Alertas de stock bajo (HU-08).
 *
 * Las alertas se generan de dos formas, con la misma regla:
 *  - al instante, cada vez que cambia el stock de un repuesto;
 *  - por la tarea programada, que revisa todo el inventario cada cierto
 *    tiempo por si algún cambio no pasó por la aplicación.
 * Revisar es idempotente: un repuesto nunca tiene dos alertas abiertas del
 * mismo tipo ni recibe dos veces el mismo aviso.
 *
 * @param {object} repositorio Repositorio de alertas.
 * @param {{ notificaciones: object, destinatarios: () => object[], auditoria?: object, urlDeLaAplicacion?: string }} dependencias
 */
function crearServicioAlertas(repositorio, { notificaciones, destinatarios, auditoria = SIN_AUDITORIA, urlDeLaAplicacion = null }) {
  /** Avisa (campana y correo) de las alertas nuevas o que empeoraron, en un solo correo por persona. */
  function avisar(ids) {
    const alertas = ids.map((id) => repositorio.buscarPorId(id));
    if (alertas.length === 0) return;
    notificaciones.enviar(
      destinatarios(),
      alertas.map((alerta) => ({ tipo: alerta.tipo, ...redactar(alerta), vista: 'alertas', alertaId: alerta.id })),
      (usuario) => redactarCorreo(alertas, { nombre: usuario.nombre, url: urlDeLaAplicacion }),
    );
  }

  /** Aplica las reglas a un repuesto. Devuelve los ids de las alertas de las que hay que avisar. */
  function procesar(repuesto, resultado) {
    const abiertas = repositorio.listarAbiertasDe(repuesto.id);
    const deNivel = abiertas.find((a) => TIPOS_DE_NIVEL.includes(a.tipo)) || null;
    const { accion, tipo } = decidir(repuesto, deNivel);

    if (accion === 'CREAR') {
      const id = repositorio.insertar({
        repuestoId: repuesto.id, tipo, stockAlGenerar: repuesto.stockActual, stockMinimo: repuesto.stockMinimo,
      });
      resultado.creadas.push(id);
    } else if (accion === 'ESCALAR') {
      repositorio.cambiarTipo(deNivel.id, tipo);
      resultado.escaladas.push(deNivel.id);
    } else if (accion === 'REBAJAR') {
      repositorio.cambiarTipo(deNivel.id, tipo);
    } else if (accion === 'RESOLVER') {
      repositorio.resolver(deNivel.id);
      resultado.resueltas.push(deNivel.id);
    }

    abiertas.filter((a) => !TIPOS_DE_NIVEL.includes(a.tipo)).forEach((alerta) => {
      const llegoMercancia = alerta.tipo === TIPOS.FALTANTE_REPORTADO && repuesto.stockActual > alerta.stockAlGenerar;
      // Si el stock ya llegó al mínimo, la alerta real reemplaza a la proyección.
      const yaEsReal = alerta.tipo === TIPOS.QUIEBRE_PROYECTADO && nivelDeStock(repuesto) !== null;
      if (!repuesto.activo || llegoMercancia || yaEsReal) {
        repositorio.resolver(alerta.id);
        resultado.resueltas.push(alerta.id);
      }
    });
  }

  return {
    /**
     * Revisa el stock y deja las alertas al día.
     * @param {number[] | null} ids Repuestos a revisar; null revisa todo el inventario.
     * @returns {{ revisados: number, creadas: number, escaladas: number, resueltas: number }}
     */
    revisar(ids = null) {
      const resultado = { creadas: [], escaladas: [], resueltas: [] };
      const repuestos = ids === null
        ? repositorio.listarRepuestos()
        : [...new Set(ids)].map((id) => repositorio.buscarRepuesto(id)).filter(Boolean);

      repositorio.enTransaccion(() => repuestos.forEach((repuesto) => procesar(repuesto, resultado)));
      avisar([...resultado.creadas, ...resultado.escaladas]);

      return {
        revisados: repuestos.length,
        creadas: resultado.creadas.length,
        escaladas: resultado.escaladas.length,
        resueltas: resultado.resueltas.length,
      };
    },

    /**
     * Lo llaman inventario y órdenes después de cambiar el stock. La
     * operación principal ya quedó guardada: si el aviso falla, se registra
     * el error pero no se le devuelve un fallo a quien registró el repuesto.
     */
    alCambiarStock(ids) {
      try {
        this.revisar(ids);
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') console.error('No se pudieron actualizar las alertas de stock:', error);
        else throw error;
      }
    },

    /** El mecánico avisa que un repuesto falta o no alcanza para un trabajo, aunque el sistema diga que hay. */
    reportarFaltante(repuestoId, entrada, usuario) {
      const repuesto = repositorio.buscarRepuesto(repuestoId);
      if (!repuesto || !repuesto.activo) throw new NoEncontrado(`No existe un repuesto activo con id ${repuestoId}`);
      const nota = leerNota(entrada, 'nota');
      if (repositorio.listarAbiertasDe(repuestoId).some((a) => a.tipo === TIPOS.FALTANTE_REPORTADO)) {
        throw new Conflicto(`Ya hay un reporte abierto de ${repuesto.sku}; el dueño ya fue avisado`);
      }

      const id = repositorio.insertar({
        repuestoId,
        tipo: TIPOS.FALTANTE_REPORTADO,
        stockAlGenerar: repuesto.stockActual,
        stockMinimo: repuesto.stockMinimo,
        detalle: `${usuario.nombre} reportó que falta ${repuesto.nombre}${nota ? `: ${nota}` : ''}`,
        creadaPor: usuario.id,
      });
      avisar([id]);
      return repositorio.buscarPorId(id);
    },

    /** Marca la alerta como atendida: ya se hizo el pedido y se espera la mercancía. */
    atender(id, entrada, usuario) {
      const alerta = repositorio.buscarPorId(id);
      if (!alerta) throw new NoEncontrado(`No existe la alerta con id ${id}`);
      const nota = leerNota(entrada, 'nota');
      if (!repositorio.atender(id, usuario.id, nota)) {
        throw new Conflicto(`La alerta de ${alerta.repuesto.sku} ya está ${alerta.estadoNombre.toLowerCase()}`);
      }
      auditoria.registrar({
        usuarioId: usuario.id,
        accion: ACCIONES.ALERTA_ATENDIDA,
        entidad: 'alerta',
        entidadId: id,
        detalle: `${alerta.repuesto.sku} (${alerta.tipoNombre})${nota ? `: ${nota}` : ''}`,
      });
      return repositorio.buscarPorId(id);
    },

    /** Alertas abiertas (por defecto) o el historial de resueltas, paginado. */
    listar(query = {}) {
      const grupo = typeof query.estado === 'string' ? query.estado.trim().toUpperCase() : 'ABIERTAS';
      if (!['ABIERTAS', 'RESUELTAS'].includes(grupo)) {
        throw new ErrorDeValidacion([{ campo: 'estado', mensaje: 'El estado debe ser ABIERTAS o RESUELTAS' }]);
      }
      const conteo = repositorio.contar();
      if (grupo === 'ABIERTAS') {
        const datos = repositorio.listarAbiertas();
        return { estado: grupo, datos, pagina: 1, totalPaginas: 1, total: datos.length, conteo };
      }
      const pedida = Number(query.pagina);
      const pagina = Number.isInteger(pedida) && pedida > 0 ? pedida : 1;
      const { datos, total } = repositorio.listarResueltas({ pagina, tamano: TAMANO_DEL_HISTORIAL });
      return { estado: grupo, datos, pagina, totalPaginas: Math.max(1, Math.ceil(total / TAMANO_DEL_HISTORIAL)), total, conteo };
    },

    conteo() {
      return repositorio.contar();
    },
  };
}

module.exports = { crearServicioAlertas };
