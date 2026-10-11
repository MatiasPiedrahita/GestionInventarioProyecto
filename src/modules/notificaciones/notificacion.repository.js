function aNotificacion(fila) {
  return {
    id: fila.id,
    tipo: fila.tipo,
    titulo: fila.titulo,
    mensaje: fila.mensaje,
    vista: fila.vista,
    alertaId: fila.alerta_id,
    leida: fila.leida_en !== null,
    creadaEn: fila.creada_en,
  };
}

/** Acceso a datos de las notificaciones de la aplicación y de la bandeja de salida de correos. */
function crearRepositorioNotificaciones(db) {
  const sentencias = {
    insertar: db.prepare(`
      INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, vista, alerta_id)
      VALUES (@usuarioId, @tipo, @titulo, @mensaje, @vista, @alertaId)
    `),
    // Las no leídas primero; dentro de cada grupo, las más recientes arriba.
    deUsuario: db.prepare(`
      SELECT * FROM notificaciones
       WHERE usuario_id = @usuarioId AND (@soloNoLeidas = 0 OR leida_en IS NULL)
       ORDER BY (leida_en IS NOT NULL), id DESC
       LIMIT @limite
    `),
    noLeidas: db.prepare('SELECT COUNT(*) AS n FROM notificaciones WHERE usuario_id = ? AND leida_en IS NULL'),
    // El usuario va en la condición: nadie marca como leída la notificación de otro.
    marcarLeida: db.prepare(`
      UPDATE notificaciones SET leida_en = datetime('now') WHERE id = @id AND usuario_id = @usuarioId AND leida_en IS NULL
    `),
    existeDeUsuario: db.prepare('SELECT 1 AS existe FROM notificaciones WHERE id = ? AND usuario_id = ?'),
    marcarTodas: db.prepare("UPDATE notificaciones SET leida_en = datetime('now') WHERE usuario_id = ? AND leida_en IS NULL"),
    preferencias: db.prepare('SELECT email, notificar_por_correo FROM usuarios WHERE id = ?'),
    guardarPreferencias: db.prepare('UPDATE usuarios SET email = @email, notificar_por_correo = @notificarPorCorreo WHERE id = @id'),
    conCorreoActivo: db.prepare('SELECT id FROM usuarios WHERE id = ? AND activo = 1 AND notificar_por_correo = 1 AND email IS NOT NULL'),
    insertarCorreo: db.prepare(`
      INSERT INTO correos_salientes (usuario_id, destinatario, asunto, cuerpo, estado)
      VALUES (@usuarioId, @destinatario, @asunto, @cuerpo, @estado)
    `),
    actualizarCorreo: db.prepare('UPDATE correos_salientes SET estado = @estado, error = @error WHERE id = @id'),
    correos: db.prepare(`
      SELECT c.id, c.destinatario, c.asunto, c.cuerpo, c.estado, c.error, c.creado_en, u.nombre AS usuario
        FROM correos_salientes c
        LEFT JOIN usuarios u ON u.id = c.usuario_id
       ORDER BY c.id DESC
       LIMIT ?
    `),
    conteoDeCorreos: db.prepare('SELECT estado, COUNT(*) AS n FROM correos_salientes GROUP BY estado'),
  };

  return {
    insertar({ usuarioId, tipo, titulo, mensaje, vista = null, alertaId = null }) {
      return Number(sentencias.insertar.run({ usuarioId, tipo, titulo, mensaje, vista, alertaId }).lastInsertRowid);
    },
    listarDe(usuarioId, { soloNoLeidas, limite }) {
      return sentencias.deUsuario.all({ usuarioId, soloNoLeidas: soloNoLeidas ? 1 : 0, limite }).map(aNotificacion);
    },
    contarNoLeidas(usuarioId) {
      return sentencias.noLeidas.get(usuarioId).n;
    },
    marcarLeida(id, usuarioId) {
      sentencias.marcarLeida.run({ id, usuarioId });
    },
    perteneceA(id, usuarioId) {
      return Boolean(sentencias.existeDeUsuario.get(id, usuarioId));
    },
    marcarTodasLeidas(usuarioId) {
      return Number(sentencias.marcarTodas.run(usuarioId).changes);
    },
    preferenciasDe(usuarioId) {
      const fila = sentencias.preferencias.get(usuarioId);
      return { email: fila.email, notificarPorCorreo: fila.notificar_por_correo === 1 };
    },
    guardarPreferencias(id, { email, notificarPorCorreo }) {
      sentencias.guardarPreferencias.run({ id, email, notificarPorCorreo: notificarPorCorreo ? 1 : 0 });
    },
    quiereCorreo(usuarioId) {
      return Boolean(sentencias.conCorreoActivo.get(usuarioId));
    },
    insertarCorreo({ usuarioId, destinatario, asunto, cuerpo, estado }) {
      return Number(sentencias.insertarCorreo.run({ usuarioId, destinatario, asunto, cuerpo, estado }).lastInsertRowid);
    },
    actualizarCorreo(id, estado, error = null) {
      sentencias.actualizarCorreo.run({ id, estado, error });
    },
    listarCorreos(limite) {
      return sentencias.correos.all(limite).map((fila) => ({
        id: fila.id,
        destinatario: fila.destinatario,
        usuario: fila.usuario,
        asunto: fila.asunto,
        cuerpo: fila.cuerpo,
        estado: fila.estado,
        error: fila.error,
        creadoEn: fila.creado_en,
      }));
    },
    contarCorreosPorEstado() {
      return Object.fromEntries(sentencias.conteoDeCorreos.all().map((fila) => [fila.estado, fila.n]));
    },
  };
}

module.exports = { crearRepositorioNotificaciones };
