const { ErrorDeDominio } = require('./errors');

/** Convierte cualquier error en una respuesta JSON consistente. */
// eslint-disable-next-line no-unused-vars
function manejadorDeErrores(error, req, res, next) {
  if (error instanceof ErrorDeDominio) {
    return res.status(error.status).json({
      error: error.codigo,
      mensaje: error.message,
      detalles: error.detalles || [],
    });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON_INVALIDO', mensaje: 'El cuerpo de la petición no es JSON válido', detalles: [] });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'ARCHIVO_GRANDE', mensaje: 'El archivo supera el tamaño máximo (1 MB)', detalles: [] });
  }

  if (process.env.NODE_ENV !== 'test') {
    console.error(error);
  }
  return res.status(500).json({ error: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado', detalles: [] });
}

module.exports = { manejadorDeErrores };
