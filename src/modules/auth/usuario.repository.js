function aDominio(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    usuario: fila.usuario,
    nombre: fila.nombre,
    rol: fila.rol,
    email: fila.email,
    activo: fila.activo === 1,
    debeCambiarPassword: fila.debe_cambiar_password === 1,
  };
}

function crearRepositorioUsuarios(db) {
  const sentencias = {
    insertar: db.prepare(`
      INSERT INTO usuarios (usuario, nombre, rol, password_hash, email, debe_cambiar_password)
      VALUES (@usuario, @nombre, @rol, @passwordHash, @email, @debeCambiarPassword)
    `),
    porUsuario: db.prepare('SELECT * FROM usuarios WHERE usuario = ?'),
    porId: db.prepare('SELECT * FROM usuarios WHERE id = ?'),
    porRol: db.prepare('SELECT * FROM usuarios WHERE rol = ? AND activo = 1 ORDER BY nombre COLLATE NOCASE'),
    insertarSesion: db.prepare(`
      INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES (?, ?, ?)
    `),
    sesionVigente: db.prepare(`
      SELECT u.* FROM sesiones s
        JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.token_hash = ? AND s.expira_en > ? AND u.activo = 1
    `),
    borrarSesion: db.prepare('DELETE FROM sesiones WHERE token_hash = ?'),
    borrarVencidas: db.prepare('DELETE FROM sesiones WHERE expira_en <= ?'),
    borrarSesionesDe: db.prepare('DELETE FROM sesiones WHERE usuario_id = ?'),
    borrarOtrasSesiones: db.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND token_hash <> ?'),
    registrarFallo: db.prepare('UPDATE usuarios SET intentos_fallidos = @intentos, bloqueado_hasta = @bloqueadoHasta WHERE id = @id'),
    reiniciarFallos: db.prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?'),
    actualizarPassword: db.prepare(`
      UPDATE usuarios
         SET password_hash = @passwordHash, debe_cambiar_password = @debeCambiarPassword,
             password_actualizada_en = datetime('now'), intentos_fallidos = 0, bloqueado_hasta = NULL
       WHERE id = @id
    `),
  };

  return {
    insertar({ usuario, nombre, rol, passwordHash, email = null, debeCambiarPassword = false }) {
      const fila = { usuario, nombre, rol, passwordHash, email, debeCambiarPassword: debeCambiarPassword ? 1 : 0 };
      return Number(sentencias.insertar.run(fila).lastInsertRowid);
    },
    /** Devuelve el usuario con su hash y su bloqueo: solo lo usa el servicio para verificar. */
    buscarConCredenciales(usuario) {
      const fila = sentencias.porUsuario.get(usuario);
      return fila ? { ...aDominio(fila), passwordHash: fila.password_hash, bloqueadoHasta: fila.bloqueado_hasta } : null;
    },
    buscarPorUsuario(usuario) {
      return aDominio(sentencias.porUsuario.get(usuario));
    },
    buscarPorId(id) {
      return aDominio(sentencias.porId.get(id));
    },
    listarPorRol(rol) {
      return sentencias.porRol.all(rol).map(aDominio);
    },
    crearSesion(tokenHash, usuarioId, expiraEn) {
      sentencias.insertarSesion.run(tokenHash, usuarioId, expiraEn);
    },
    usuarioDeSesion(tokenHash, ahora) {
      return aDominio(sentencias.sesionVigente.get(tokenHash, ahora));
    },
    borrarSesion(tokenHash) {
      sentencias.borrarSesion.run(tokenHash);
    },
    borrarSesionesVencidas(ahora) {
      sentencias.borrarVencidas.run(ahora);
    },
    /** @returns {number} Cuántas sesiones se cerraron. */
    borrarSesionesDe(usuarioId) {
      return Number(sentencias.borrarSesionesDe.run(usuarioId).changes);
    },
    /** Cierra las sesiones del usuario en otros dispositivos y conserva la actual. */
    borrarOtrasSesiones(usuarioId, tokenHashActual) {
      return Number(sentencias.borrarOtrasSesiones.run(usuarioId, tokenHashActual).changes);
    },
    registrarFalloDeLogin(id, intentos, bloqueadoHasta = null) {
      sentencias.registrarFallo.run({ id, intentos, bloqueadoHasta });
    },
    reiniciarFallosDeLogin(id) {
      sentencias.reiniciarFallos.run(id);
    },
    actualizarPassword(id, passwordHash, { debeCambiarPassword = false } = {}) {
      sentencias.actualizarPassword.run({ id, passwordHash, debeCambiarPassword: debeCambiarPassword ? 1 : 0 });
    },
  };
}

module.exports = { crearRepositorioUsuarios };
