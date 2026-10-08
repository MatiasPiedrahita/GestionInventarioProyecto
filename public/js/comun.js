/* global window, document */
/** Utilidades compartidas por todas las vistas. */
window.Taller.formato = {
  pesos: new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }),
  fechas: new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }),
  /** SQLite guarda "2026-10-07 14:30:00" en UTC; esto lo vuelve fecha local legible. */
  fechaSqlite(texto) {
    if (!texto) return '';
    return this.fechas.format(new Date(`${texto.replace(' ', 'T')}Z`));
  },
};

window.Taller.dom = {
  crear(etiqueta, { clase, texto } = {}) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  },

  /** Muestra un aviso (ok/error) y, si hay detalles, la lista de cada uno. */
  aviso(destino, mensaje, tipo, detalles = []) {
    destino.className = `aviso aviso--${tipo}`;
    destino.textContent = mensaje;
    if (detalles.length > 0) {
      const lista = document.createElement('ul');
      detalles.forEach((d) => {
        const item = document.createElement('li');
        item.textContent = `${d.fila ? `Fila ${d.fila}: ` : ''}${d.mensaje}`;
        lista.appendChild(item);
      });
      destino.appendChild(lista);
    }
  },

  /** Limpia y marca los errores de validación junto a cada campo del formulario. */
  limpiarErrores(formulario) {
    formulario.querySelectorAll('[data-error]').forEach((p) => { p.textContent = ''; });
    formulario.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
  },

  marcarErrores(formulario, detalles) {
    const sinCampo = [];
    detalles.forEach(({ campo, mensaje }) => {
      const destino = formulario.querySelector(`[data-error="${campo}"]`);
      const entrada = formulario.querySelector(`[name="${campo}"]`);
      if (destino && entrada) {
        destino.textContent = mensaje;
        entrada.setAttribute('aria-invalid', 'true');
      } else {
        sinCampo.push({ mensaje });
      }
    });
    const primero = formulario.querySelector('[aria-invalid="true"]');
    if (primero) primero.focus();
    return sinCampo;
  },
};
