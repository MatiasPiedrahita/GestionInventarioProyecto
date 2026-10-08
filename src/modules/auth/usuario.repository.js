function aDominio(fila) {
  if (!fila) return null;
  return {
    id: fila.id,
    usuario: fila.usuario,
    nombre: fila.nombre,
    rol: fila.rol,
    activo: fila.activo === 1,
  };
}

function crearRepositorioUsuarios(db) {
  const sentencias = {
    insertar: db.prepare(`
      INSERT INTO usuarios (usuario, nombre, rol, password_hash)
      VALUES (@usuario, @nombre, @rol, @passwordHash)
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
  };

  return {
    insertar(datos) {
      return Number(sentencias.insertar.run(datos).lastInsertRowid);
    },
    /** Devuelve el usuario con su hash: solo lo usa el servicio para verificar. */
    buscarConCredenciales(usuario) {
      const fila = sentencias.porUsuario.get(usuario);
      return fila ? { ...aDominio(fila), passwordHash: fila.password_hash } : null;
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
  };
}

module.exports = { crearRepositorioUsuarios };
