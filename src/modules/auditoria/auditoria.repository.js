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

    /**
     * Consulta paginada, de lo más reciente a lo más antiguo. La consulta se
     * arma solo con los filtros presentes y siempre con parámetros.
     */
    buscar({ usuarioId, accion, desde, hasta, pagina, tamano }) {
      const condiciones = [];
      const parametros = {};

      if (usuarioId) {
        condiciones.push('a.usuario_id = @usuarioId');
        parametros.usuarioId = usuarioId;
      }
      if (accion) {
        condiciones.push('a.accion = @accion');
        parametros.accion = accion;
      }
      if (desde) {
        condiciones.push('a.fecha >= @desde');
        parametros.desde = `${desde} 00:00:00`;
      }
      if (hasta) {
        condiciones.push('a.fecha <= @hasta');
        parametros.hasta = `${hasta} 23:59:59`;
      }
      const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM auditoria a ${where}`).get(parametros);
      const filas = db
        .prepare(`
          SELECT a.id, a.fecha, a.accion, a.entidad, a.entidad_id, a.detalle, a.ip,
                 u.id AS usuario_id, u.usuario, u.nombre AS usuario_nombre
            FROM auditoria a
            LEFT JOIN usuarios u ON u.id = a.usuario_id
            ${where}
           ORDER BY a.id DESC
           LIMIT @limite OFFSET @desplazamiento`)
        .all({ ...parametros, limite: tamano, desplazamiento: (pagina - 1) * tamano });

      return {
        total,
        datos: filas.map((fila) => ({
          id: fila.id,
          fecha: fila.fecha,
          accion: fila.accion,
          entidad: fila.entidad,
          entidadId: fila.entidad_id,
          detalle: fila.detalle,
          ip: fila.ip,
          usuario: fila.usuario_id ? { id: fila.usuario_id, usuario: fila.usuario, nombre: fila.usuario_nombre } : null,
        })),
      };
    },
  };
}

module.exports = { crearRepositorioAuditoria };
