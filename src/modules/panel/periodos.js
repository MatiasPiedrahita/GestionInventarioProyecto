/**
 * Cálculo de los periodos del panel (funciones puras, en UTC, que es como
 * SQLite guarda las fechas con datetime('now')).
 */
const DIA_MS = 24 * 3600 * 1000;

/** "2026-10-12 08:30:00": el formato de fecha de la base de datos. */
function aFechaSql(fecha) {
  return fecha.toISOString().slice(0, 19).replace('T', ' ');
}

/** Medianoche (UTC) del lunes de la semana de la fecha. */
function lunesDe(fecha) {
  const diasDesdeLunes = (fecha.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate() - diasDesdeLunes));
}

/** Los lunes de las últimas `cantidad` semanas (la actual incluida), del más antiguo al más reciente, como "AAAA-MM-DD". */
function ultimasSemanas(ahora, cantidad) {
  const actual = lunesDe(ahora).getTime();
  return Array.from({ length: cantidad }, (_, i) => new Date(actual - (cantidad - 1 - i) * 7 * DIA_MS).toISOString().slice(0, 10));
}

/** Los últimos `cantidad` meses (el actual incluido), del más antiguo al más reciente, como "AAAA-MM". */
function ultimosMeses(ahora, cantidad) {
  return Array.from({ length: cantidad }, (_, i) => {
    const mes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - (cantidad - 1 - i), 1));
    return mes.toISOString().slice(0, 7);
  });
}

function haceDias(ahora, dias) {
  return new Date(ahora.getTime() - dias * DIA_MS);
}

module.exports = { aFechaSql, lunesDe, ultimasSemanas, ultimosMeses, haceDias };
