/**
 * Transporte de correo. Hay dos, con la misma interfaz:
 *
 *  - Simulado (por defecto): no envía nada. El correo queda guardado en la
 *    bandeja de salida y se puede leer en Administración. Sirve para la
 *    demostración y para desarrollar sin cuenta de correo.
 *  - SMTP: si el archivo .env trae SMTP_HOST, los correos salen de verdad.
 *
 * Las credenciales van solo en el .env, que nunca se sube al repositorio.
 */
const REMITENTE_POR_DEFECTO = 'Taller <avisos@taller.local>';

function crearTransporteDeCorreo(entorno = process.env) {
  const remitente = entorno.CORREO_REMITENTE || REMITENTE_POR_DEFECTO;

  if (!entorno.SMTP_HOST) {
    return {
      modo: 'simulado',
      remitente,
      descripcion: 'Simulado: los correos quedan en la bandeja de salida y no se envían',
      enviar: async () => {},
    };
  }

  // nodemailer solo se carga cuando de verdad se va a enviar.
  // eslint-disable-next-line global-require
  const nodemailer = require('nodemailer');
  const puerto = Number(entorno.SMTP_PORT) || 587;
  const transporte = nodemailer.createTransport({
    host: entorno.SMTP_HOST,
    port: puerto,
    secure: puerto === 465,
    auth: entorno.SMTP_USER ? { user: entorno.SMTP_USER, pass: entorno.SMTP_PASS } : undefined,
  });

  return {
    modo: 'smtp',
    remitente,
    descripcion: `SMTP por ${entorno.SMTP_HOST}:${puerto}`,
    async enviar({ para, asunto, texto }) {
      await transporte.sendMail({ from: remitente, to: para, subject: asunto, text: texto });
    },
  };
}

module.exports = { crearTransporteDeCorreo };
