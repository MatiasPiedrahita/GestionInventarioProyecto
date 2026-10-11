/**
 * Reglas de las alertas de stock (funciones puras, sin base de datos).
 *
 * HU-08: se alerta cuando el stock de un repuesto llega a su mínimo o baja
 * de él (stock <= mínimo). Si llega a cero, la alerta es de "agotado".
 */
const TIPOS = Object.freeze({
  STOCK_BAJO: 'STOCK_BAJO',
  AGOTADO: 'AGOTADO',
  QUIEBRE_PROYECTADO: 'QUIEBRE_PROYECTADO',
  FALTANTE_REPORTADO: 'FALTANTE_REPORTADO',
});

const NOMBRE_TIPO = Object.freeze({
  STOCK_BAJO: 'Stock bajo',
  AGOTADO: 'Agotado',
  QUIEBRE_PROYECTADO: 'Se agotará pronto',
  FALTANTE_REPORTADO: 'Faltante reportado',
});

const ESTADOS_DE_ALERTA = Object.freeze({ ACTIVA: 'ACTIVA', ATENDIDA: 'ATENDIDA', RESUELTA: 'RESUELTA' });

const NOMBRE_ESTADO_DE_ALERTA = Object.freeze({
  ACTIVA: 'Sin atender',
  ATENDIDA: 'Pedido hecho',
  RESUELTA: 'Resuelta',
});

/** Tipos que dependen del nivel de stock actual; un repuesto tiene como mucho una alerta abierta de este grupo. */
const TIPOS_DE_NIVEL = Object.freeze([TIPOS.STOCK_BAJO, TIPOS.AGOTADO]);

/** @returns {'AGOTADO' | 'STOCK_BAJO' | null} null si el stock está por encima del mínimo. */
function nivelDeStock({ stockActual, stockMinimo }) {
  if (stockActual <= 0) return TIPOS.AGOTADO;
  if (stockActual <= stockMinimo) return TIPOS.STOCK_BAJO;
  return null;
}

/**
 * Qué hacer con la alerta de nivel de un repuesto según su stock de ahora.
 *
 *   CREAR     no había alerta y el stock llegó al mínimo            → se avisa
 *   ESCALAR   había "stock bajo" y ahora está agotado               → se avisa otra vez
 *   REBAJAR   estaba agotado y entró algo, pero sigue en el mínimo  → sin aviso
 *   RESOLVER  el stock volvió a estar por encima del mínimo, o el repuesto se dio de baja
 *   NADA      todo sigue igual: revisar dos veces no duplica alertas
 *
 * @param {{ stockActual: number, stockMinimo: number, activo: boolean }} repuesto
 * @param {{ tipo: string } | null} abierta La alerta de nivel abierta del repuesto, si existe.
 * @returns {{ accion: 'CREAR'|'ESCALAR'|'REBAJAR'|'RESOLVER'|'NADA', tipo: string|null }}
 */
function decidir(repuesto, abierta) {
  const nivel = repuesto.activo ? nivelDeStock(repuesto) : null;
  if (!nivel) return { accion: abierta ? 'RESOLVER' : 'NADA', tipo: null };
  if (!abierta) return { accion: 'CREAR', tipo: nivel };
  if (abierta.tipo === nivel) return { accion: 'NADA', tipo: nivel };
  return { accion: nivel === TIPOS.AGOTADO ? 'ESCALAR' : 'REBAJAR', tipo: nivel };
}

/** Texto de la notificación de una alerta (título corto y mensaje de una línea). */
function redactar(alerta) {
  const { tipo, repuesto } = alerta;
  const cuanto = `mínimo ${repuesto.stockMinimo}`;
  if (tipo === TIPOS.AGOTADO) {
    return { titulo: `Agotado: ${repuesto.sku}`, mensaje: `${repuesto.nombre} se agotó (${cuanto}).` };
  }
  if (tipo === TIPOS.FALTANTE_REPORTADO) {
    return { titulo: `Faltante reportado: ${repuesto.sku}`, mensaje: `${alerta.detalle || `Falta ${repuesto.nombre}`}` };
  }
  if (tipo === TIPOS.QUIEBRE_PROYECTADO) {
    return { titulo: `Se agotará pronto: ${repuesto.sku}`, mensaje: `${repuesto.nombre}: ${alerta.detalle || 'el stock no alcanza hasta el próximo pedido'}` };
  }
  const unidades = repuesto.stockActual === 1 ? 'queda 1 unidad' : `quedan ${repuesto.stockActual} unidades`;
  return { titulo: `Stock bajo: ${repuesto.sku}`, mensaje: `${repuesto.nombre}: ${unidades} (${cuanto}).` };
}

/** Correo que resume varias alertas en un solo mensaje. */
function redactarCorreo(alertas, { nombre, url = null }) {
  const asunto = alertas.length === 1
    ? `[Taller] ${redactar(alertas[0]).titulo}`
    : `[Taller] ${alertas.length} repuestos necesitan atención`;
  const lineas = alertas.map((alerta) => {
    const { repuesto } = alerta;
    const proveedor = repuesto.proveedor ? ` Proveedor: ${repuesto.proveedor}.` : '';
    return `- ${NOMBRE_TIPO[alerta.tipo]} · ${repuesto.sku} ${redactar(alerta).mensaje}${proveedor}`;
  });
  const cuerpo = [
    `Hola, ${nombre}:`,
    '',
    alertas.length === 1 ? 'Este repuesto necesita atención:' : 'Estos repuestos necesitan atención:',
    '',
    ...lineas,
    '',
    url ? `Revísalos en la sección "Alertas": ${url}` : 'Revísalos en la sección "Alertas" de la aplicación.',
    '',
    'Recibes este correo porque activaste los avisos por correo en "Mi cuenta". Puedes desactivarlos ahí mismo.',
  ].join('\n');
  return { asunto, cuerpo };
}

module.exports = {
  TIPOS,
  NOMBRE_TIPO,
  ESTADOS_DE_ALERTA,
  NOMBRE_ESTADO_DE_ALERTA,
  TIPOS_DE_NIVEL,
  nivelDeStock,
  decidir,
  redactar,
  redactarCorreo,
};
