/** Consultas de solo lectura sobre el estado general de la base de datos. */
function crearRepositorioSistema(db) {
  const sentencias = {
    version: db.prepare('PRAGMA user_version'),
    conteos: db.prepare(`
      SELECT (SELECT COUNT(*) FROM usuarios WHERE activo = 1)            AS usuariosActivos,
             (SELECT COUNT(*) FROM usuarios WHERE activo = 0)            AS usuariosInactivos,
             (SELECT COUNT(*) FROM sesiones WHERE expira_en > @ahora)    AS sesionesAbiertas,
             (SELECT COUNT(*) FROM repuestos WHERE activo = 1)           AS repuestosActivos,
             (SELECT COUNT(*) FROM ordenes)                              AS ordenes,
             (SELECT COUNT(*) FROM ordenes WHERE estado = 'EN_PROCESO')  AS ordenesEnProceso,
             (SELECT COUNT(*) FROM movimientos_inventario)               AS movimientos,
             (SELECT COUNT(*) FROM auditoria)                            AS registrosDeAuditoria
    `),
  };

  return {
    versionDelEsquema() {
      return sentencias.version.get().user_version;
    },
    conteos(ahora) {
      return { ...sentencias.conteos.get({ ahora }) };
    },
  };
}

module.exports = { crearRepositorioSistema };
