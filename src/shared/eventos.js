/**
 * Avisos que los servicios de inventario y de órdenes emiten cuando pasa
 * algo que le interesa a otro módulo (alertas, notificaciones). Los
 * servicios no conocen a quién avisan: app.js conecta cada aviso con su
 * destino. Sin conexión (scripts, pruebas unitarias) no hacen nada.
 */
const SIN_EVENTOS = Object.freeze({
  /** Cambió el stock de estos repuestos (ya guardado en la base). */
  stockCambiado() {},
  /** Una orden quedó a cargo de un mecánico por decisión de otra persona. */
  ordenAsignada() {},
});

module.exports = { SIN_EVENTOS };
