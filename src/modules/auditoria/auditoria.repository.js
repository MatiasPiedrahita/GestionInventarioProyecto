/** Acceso a datos del registro de auditoría. Solo inserta y consulta: nunca edita ni borra. */
function crearRepositorioAuditoria(db) {
  const sentencias = {
    insertar: db.prepare(`
      INSERT INTO auditoria (usuario_id, accion, entidad, entidad_id, detalle, ip)
      VALUES (@usuarioId, @accion, @entidad, @entidadId, @detalle, @ip)
    `),
  };

  return {
    insertar({ usuarioId, accion, entidad, entidadId, detalle, ip }) {
      sentencias.insertar.run({ usuarioId, accion, entidad, entidadId, detalle, ip });
    },
  };
}

module.exports = { crearRepositorioAuditoria };
