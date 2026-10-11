/**
 * Limitador de intentos en memoria, por clave (un usuario, una dirección IP).
 * Cuenta fallos dentro de una ventana de tiempo que empieza con el primero;
 * al llegar al máximo, la clave queda bloqueada hasta que la ventana termina.
 *
 * Vive en memoria a propósito: es una defensa contra la fuerza bruta, no un
 * dato del negocio. Al reiniciar el servidor los contadores empiezan de cero.
 *
 * @param {{ maximo: number, ventanaMs: number, ahora?: () => Date, maximoDeClaves?: number }} opciones
 */
function crearLimitador({ maximo, ventanaMs, ahora = () => new Date(), maximoDeClaves = 5000 }) {
  const registros = new Map();

  function vigente(clave) {
    const registro = registros.get(clave);
    if (!registro) return null;
    if (ahora().getTime() - registro.desde >= ventanaMs) {
      registros.delete(clave);
      return null;
    }
    return registro;
  }

  /** Evita que alguien llene la memoria probando miles de claves distintas. */
  function depurar() {
    if (registros.size < maximoDeClaves) return;
    [...registros.keys()].forEach((clave) => vigente(clave));
    if (registros.size >= maximoDeClaves) registros.delete(registros.keys().next().value);
  }

  return {
    /** Segundos que faltan para poder reintentar; 0 si la clave no está bloqueada. */
    segundosDeBloqueo(clave) {
      const registro = vigente(clave);
      if (!registro || registro.cuenta < maximo) return 0;
      return Math.ceil((registro.desde + ventanaMs - ahora().getTime()) / 1000);
    },
    /** @returns {number} Cuántos fallos lleva la clave en la ventana actual. */
    registrarFallo(clave) {
      const registro = vigente(clave);
      if (registro) {
        registro.cuenta += 1;
        return registro.cuenta;
      }
      depurar();
      registros.set(clave, { cuenta: 1, desde: ahora().getTime() });
      return 1;
    },
    limpiar(clave) {
      registros.delete(clave);
    },
  };
}

module.exports = { crearLimitador };
