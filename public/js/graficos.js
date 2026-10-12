/* global window, document */
/**
 * Gráficos propios, sin librerías: SVG y HTML generados a mano. Cumplen la
 * política de contenido de la aplicación (nada de estilos en línea en el
 * marcado) y siguen unas pocas reglas fijas:
 *  - marcas delgadas, con el extremo redondeado y la base recta;
 *  - cuadrícula de líneas finas y continuas, que no compite con los datos;
 *  - el texto usa los colores de texto, nunca el color de la serie;
 *  - cada valor se puede leer sin pasar el ratón: hay etiquetas y una tabla;
 *  - el detalle aparece al pasar el ratón y también con el teclado.
 */
window.Taller.graficos = (function crearGraficos() {
  const SVG = 'http://www.w3.org/2000/svg';
  const ANCHO_POR_DEFECTO = 520;
  const GROSOR_MAXIMO = 24;
  const RADIO = 4;

  function svg(etiqueta, atributos = {}, texto) {
    const el = document.createElementNS(SVG, etiqueta);
    Object.entries(atributos).forEach(([nombre, valor]) => el.setAttribute(nombre, valor));
    if (texto !== undefined) el.textContent = texto;
    return el;
  }

  function html(etiqueta, clase, texto) {
    const el = document.createElement(etiqueta);
    if (clase) el.className = clase;
    if (texto !== undefined && texto !== null) el.textContent = texto;
    return el;
  }

  /** Tope "redondo" del eje: 7 → 8, 23 → 25, 180 → 200, 1.340.000 → 1.500.000. */
  function topeLegible(maximo) {
    if (maximo <= 0) return 1;
    const magnitud = 10 ** Math.floor(Math.log10(maximo));
    const fraccion = maximo / magnitud;
    const paso = [1, 1.5, 2, 2.5, 4, 5, 8, 10].find((p) => fraccion <= p);
    return Math.max(1, paso * magnitud);
  }

  /** Marcas del eje: 0, la mitad y el tope (o solo 0 y el tope si la mitad no es entera y los datos sí). */
  function marcasDelEje(tope, enteros) {
    const mitad = tope / 2;
    return enteros && !Number.isInteger(mitad) ? [0, tope] : [0, mitad, tope];
  }

  /** Recuadro flotante con el detalle de la marca señalada. */
  function crearRecuadro(figura) {
    const recuadro = html('div', 'grafico__recuadro');
    recuadro.hidden = true;
    recuadro.setAttribute('role', 'status');
    figura.appendChild(recuadro);
    return {
      mostrar(valor, etiqueta, x, y) {
        recuadro.replaceChildren(html('strong', '', valor), html('span', '', etiqueta));
        recuadro.hidden = false;
        // Posición calculada: se asigna por código (el marcado no lleva estilos en línea).
        recuadro.style.left = `${x}px`;
        recuadro.style.top = `${y}px`;
      },
      ocultar() { recuadro.hidden = true; },
    };
  }

  /** La misma información en una tabla, para lectores de pantalla y para quien prefiera los números. */
  function crearTabla(columnas, filas) {
    const detalles = html('details', 'grafico__tabla');
    detalles.appendChild(html('summary', '', 'Ver como tabla'));
    const tabla = html('table', 'tabla-compacta');
    const encabezado = html('tr');
    columnas.forEach((columna, i) => {
      const th = html('th', i === 0 ? '' : 'num', columna);
      th.scope = 'col';
      encabezado.appendChild(th);
    });
    const cabeza = html('thead');
    cabeza.appendChild(encabezado);
    tabla.appendChild(cabeza);
    const cuerpo = html('tbody');
    filas.forEach((celdas) => {
      const fila = html('tr');
      celdas.forEach((celda, i) => fila.appendChild(html('td', i === 0 ? '' : 'num', celda)));
      cuerpo.appendChild(fila);
    });
    tabla.appendChild(cuerpo);
    detalles.appendChild(tabla);
    return detalles;
  }

  function sinDatos(contenedor, mensaje) {
    contenedor.replaceChildren(html('p', 'grafico__vacio', mensaje));
  }

  /**
   * Columnas en el tiempo (una sola serie).
   * @param {HTMLElement} contenedor
   * @param {{ datos: {etiqueta: string, descripcion?: string, valor: number}[], columnas: string[],
   *           formatoValor?: Function, formatoEje?: Function, vacio?: string }} opciones
   */
  function columnas(contenedor, { datos, columnas: titulos, formatoValor = String, formatoEje = formatoValor, vacio = 'Todavía no hay datos.' }) {
    if (datos.length === 0 || datos.every((d) => d.valor === 0)) {
      sinDatos(contenedor, vacio);
      return;
    }
    const ancho = contenedor.clientWidth || ANCHO_POR_DEFECTO;
    const alto = 210;
    const margen = { arriba: 22, derecha: 8, abajo: 26, izquierda: 46 };
    const anchoPlano = ancho - margen.izquierda - margen.derecha;
    const altoPlano = alto - margen.arriba - margen.abajo;
    const tope = topeLegible(Math.max(...datos.map((d) => d.valor)));
    const y = (valor) => margen.arriba + altoPlano - (valor / tope) * altoPlano;
    const banda = anchoPlano / datos.length;
    const grosor = Math.min(GROSOR_MAXIMO, Math.max(4, banda - 6));

    const figura = html('div', 'grafico');
    const lienzo = svg('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, class: 'grafico__lienzo', role: 'group' });
    const recuadro = crearRecuadro(figura);

    marcasDelEje(tope, datos.every((d) => Number.isInteger(d.valor))).forEach((marca) => {
      lienzo.appendChild(svg('line', {
        x1: margen.izquierda, x2: ancho - margen.derecha, y1: y(marca), y2: y(marca), class: marca === 0 ? 'grafico__base' : 'grafico__guia',
      }));
      lienzo.appendChild(svg('text', { x: margen.izquierda - 8, y: y(marca) + 4, class: 'grafico__eje grafico__eje--y' }, formatoEje(marca)));
    });

    const maximo = Math.max(...datos.map((d) => d.valor));
    const indiceDelMaximo = datos.findIndex((d) => d.valor === maximo);
    // Si las etiquetas no caben, se muestra una de cada dos (la última siempre).
    const saltar = banda < 46;

    datos.forEach((dato, i) => {
      const centro = margen.izquierda + banda * i + banda / 2;
      const cima = y(dato.valor);
      const base = y(0);
      const grupo = svg('g', { class: 'grafico__marca', tabindex: 0, role: 'img', 'aria-label': `${dato.descripcion || dato.etiqueta}: ${formatoValor(dato.valor)}` });

      if (dato.valor > 0) {
        const radio = Math.min(RADIO, (base - cima), grosor / 2);
        const izq = centro - grosor / 2;
        const der = centro + grosor / 2;
        // Extremo superior redondeado, base recta sobre el eje.
        grupo.appendChild(svg('path', {
          class: 'grafico__columna',
          d: `M${izq},${base} V${cima + radio} Q${izq},${cima} ${izq + radio},${cima} H${der - radio} Q${der},${cima} ${der},${cima + radio} V${base} Z`,
        }));
      }
      // Solo se rotulan el valor más alto y el periodo actual: el resto está en el eje, el recuadro y la tabla.
      if (dato.valor > 0 && (i === indiceDelMaximo || i === datos.length - 1)) {
        grupo.appendChild(svg('text', { x: centro, y: cima - 6, class: 'grafico__valor' }, formatoValor(dato.valor)));
      }
      // Zona sensible: toda la franja, no solo la columna.
      grupo.appendChild(svg('rect', { x: centro - banda / 2, y: margen.arriba, width: banda, height: altoPlano, class: 'grafico__zona' }));

      const mostrar = () => recuadro.mostrar(formatoValor(dato.valor), dato.descripcion || dato.etiqueta, centro, Math.max(cima - 8, 0));
      grupo.addEventListener('pointerenter', mostrar);
      grupo.addEventListener('focus', mostrar);
      grupo.addEventListener('pointerleave', recuadro.ocultar);
      grupo.addEventListener('blur', recuadro.ocultar);
      lienzo.appendChild(grupo);

      if (!saltar || (datos.length - 1 - i) % 2 === 0) {
        lienzo.appendChild(svg('text', { x: centro, y: alto - 8, class: 'grafico__eje grafico__eje--x' }, dato.etiqueta));
      }
    });

    figura.insertBefore(lienzo, figura.firstChild);
    figura.appendChild(crearTabla(titulos, datos.map((d) => [d.descripcion || d.etiqueta, formatoValor(d.valor)])));
    contenedor.replaceChildren(figura);
  }

  /**
   * Barras horizontales para comparar categorías (una sola serie, un solo color).
   * @param {HTMLElement} contenedor
   * @param {{ datos: {etiqueta: string, detalle?: string, valor: number, nota?: string}[], columnas: string[],
   *           formatoValor?: Function, espacioDelValor?: string, vacio?: string }} opciones
   *        espacioDelValor: ancho que se reserva para el número al final de la barra (más para cifras en pesos).
   */
  function barras(contenedor, { datos, columnas: titulos, formatoValor = String, espacioDelValor = '5.5ch', vacio = 'Todavía no hay datos.' }) {
    if (datos.length === 0) {
      sinDatos(contenedor, vacio);
      return;
    }
    const maximo = Math.max(...datos.map((d) => d.valor), 1);
    const figura = html('div', 'grafico');
    const lista = html('ul', 'barras');

    datos.forEach((dato) => {
      const fila = html('li', 'barras__fila');
      fila.tabIndex = 0;
      const rotulo = html('div', 'barras__rotulo');
      rotulo.appendChild(html('span', '', dato.etiqueta));
      if (dato.detalle) rotulo.appendChild(html('span', 'detalle', dato.detalle));
      fila.appendChild(rotulo);

      const pista = html('div', 'barras__pista');
      const relleno = html('div', 'barras__relleno');
      // El ancho deja libre el espacio del número, para que nunca se salga ni se corte.
      relleno.style.width = `calc((100% - ${espacioDelValor}) * ${(dato.valor / maximo).toFixed(4)})`;
      pista.appendChild(relleno);
      pista.appendChild(html('span', 'barras__valor', formatoValor(dato.valor)));
      fila.appendChild(pista);
      if (dato.nota) fila.title = dato.nota;
      lista.appendChild(fila);
    });

    figura.appendChild(lista);
    const conNota = datos.some((d) => d.nota);
    figura.appendChild(crearTabla(
      conNota ? titulos : titulos.slice(0, 2),
      datos.map((d) => [d.detalle ? `${d.etiqueta} (${d.detalle})` : d.etiqueta, formatoValor(d.valor)].concat(conNota ? [d.nota || ''] : [])),
    ));
    contenedor.replaceChildren(figura);
  }

  /**
   * Historia de consumo y pronóstico en una misma línea de tiempo.
   *
   * Dos series, así que lleva leyenda. El pronóstico se distingue por color
   * Y por trazo (línea más su franja de intervalo), no solo por color. Una
   * línea vertical marca "hoy": a la izquierda lo que pasó, a la derecha lo
   * que se espera. Al pasar el ratón (o con las flechas del teclado) una
   * guía se ajusta a la semana más cercana y muestra sus valores.
   *
   * @param {HTMLElement} contenedor
   * @param {{ historia: {semana: string, unidades: number}[],
   *           pronostico: {semana: string, unidades: number, inferior: number, superior: number}[],
   *           formatoFecha: (semana: string, largo?: boolean) => string, formatoValor?: Function }} opciones
   */
  function pronostico(contenedor, { historia, pronostico: futuro, formatoFecha, formatoValor = String }) {
    if (historia.length + futuro.length < 2) {
      sinDatos(contenedor, 'Todavía no hay datos suficientes para dibujar el gráfico.');
      return;
    }
    const ancho = contenedor.clientWidth || 640;
    const alto = 250;
    const margen = { arriba: 18, derecha: 44, abajo: 26, izquierda: 38 };
    const anchoPlano = ancho - margen.izquierda - margen.derecha;
    const altoPlano = alto - margen.arriba - margen.abajo;
    const puntos = [
      ...historia.map((h) => ({ semana: h.semana, real: h.unidades })),
      ...futuro.map((f) => ({ semana: f.semana, estimado: f.unidades, inferior: f.inferior, superior: f.superior })),
    ];
    const tope = topeLegible(Math.max(...historia.map((h) => h.unidades), ...futuro.map((f) => f.superior), 1));
    const x = (i) => margen.izquierda + (puntos.length === 1 ? 0 : (i / (puntos.length - 1)) * anchoPlano);
    const y = (valor) => margen.arriba + altoPlano - (valor / tope) * altoPlano;
    const trazo = (indices, valor) => indices.map((i, n) => `${n === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(valor(i)).toFixed(1)}`).join(' ');

    const figura = html('div', 'grafico');
    const leyenda = html('ul', 'grafico__leyenda');
    [['grafico__clave grafico__clave--real', 'Consumo real'], ['grafico__clave grafico__clave--estimado', 'Pronóstico'], ['grafico__clave grafico__clave--franja', 'Intervalo del 80 %']]
      .forEach(([clase, texto]) => {
        const item = html('li');
        item.appendChild(html('span', clase));
        item.appendChild(document.createTextNode(texto));
        leyenda.appendChild(item);
      });
    figura.appendChild(leyenda);

    const lienzo = svg('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto, class: 'grafico__lienzo', role: 'group' });
    const enteros = historia.every((h) => Number.isInteger(h.unidades));
    marcasDelEje(tope, enteros).forEach((marca) => {
      lienzo.appendChild(svg('line', { x1: margen.izquierda, x2: ancho - margen.derecha, y1: y(marca), y2: y(marca), class: marca === 0 ? 'grafico__base' : 'grafico__guia' }));
      lienzo.appendChild(svg('text', { x: margen.izquierda - 8, y: y(marca) + 4, class: 'grafico__eje grafico__eje--y' }, formatoValor(marca)));
    });

    // Etiquetas del eje del tiempo: unas ocho, repartidas.
    const paso = Math.max(1, Math.ceil(puntos.length / 8));
    puntos.forEach((punto, i) => {
      if ((puntos.length - 1 - i) % paso === 0) lienzo.appendChild(svg('text', { x: x(i), y: alto - 8, class: 'grafico__eje grafico__eje--x' }, formatoFecha(punto.semana)));
    });

    const indicesReales = historia.map((_, i) => i);
    const indicesFuturos = futuro.map((_, i) => historia.length + i);
    if (futuro.length > 0) {
      const ida = indicesFuturos.map((i, n) => `${n === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(puntos[i].superior).toFixed(1)}`).join(' ');
      const vuelta = [...indicesFuturos].reverse().map((i) => `L${x(i).toFixed(1)},${y(puntos[i].inferior).toFixed(1)}`).join(' ');
      lienzo.appendChild(svg('path', { d: `${ida} ${vuelta} Z`, class: 'grafico__franja' }));
    }
    if (historia.length > 0 && futuro.length > 0) {
      const hoy = (x(historia.length - 1) + x(historia.length)) / 2;
      lienzo.appendChild(svg('line', { x1: hoy, x2: hoy, y1: margen.arriba, y2: margen.arriba + altoPlano, class: 'grafico__hoy' }));
      lienzo.appendChild(svg('text', { x: hoy, y: margen.arriba - 6, class: 'grafico__eje grafico__eje--x' }, 'Hoy'));
    }
    if (historia.length > 1) lienzo.appendChild(svg('path', { d: trazo(indicesReales, (i) => puntos[i].real), class: 'grafico__linea grafico__linea--real' }));
    if (futuro.length > 0) {
      // El pronóstico arranca en el último dato real, para que la línea no quede cortada.
      const desde = historia.length > 0 ? [historia.length - 1, ...indicesFuturos] : indicesFuturos;
      lienzo.appendChild(svg('path', { d: trazo(desde, (i) => (puntos[i].real !== undefined ? puntos[i].real : puntos[i].estimado)), class: 'grafico__linea grafico__linea--estimado' }));
      const ultimo = puntos.length - 1;
      lienzo.appendChild(svg('circle', { cx: x(ultimo), cy: y(puntos[ultimo].estimado), r: 4, class: 'grafico__punto grafico__punto--estimado' }));
      lienzo.appendChild(svg('text', { x: x(ultimo) + 9, y: y(puntos[ultimo].estimado) + 4, class: 'grafico__valor grafico__valor--final' }, formatoValor(puntos[ultimo].estimado)));
    }

    // Guía que sigue al puntero y se ajusta a la semana más cercana.
    const guia = svg('line', { y1: margen.arriba, y2: margen.arriba + altoPlano, class: 'grafico__cursor', visibility: 'hidden' });
    const marcador = svg('circle', { r: 4, class: 'grafico__punto', visibility: 'hidden' });
    lienzo.appendChild(guia);
    lienzo.appendChild(marcador);
    const zona = svg('rect', {
      x: margen.izquierda, y: margen.arriba, width: anchoPlano, height: altoPlano, class: 'grafico__zona', tabindex: 0, role: 'img',
      'aria-label': `Consumo de ${historia.length} semanas y pronóstico de ${futuro.length}. Use las flechas para recorrer las semanas.`,
    });
    lienzo.appendChild(zona);
    figura.appendChild(lienzo);
    const recuadro = crearRecuadro(figura);
    let actual = Math.max(0, historia.length - 1);

    function describir(punto) {
      if (punto.real !== undefined) return { valor: formatoValor(punto.real), etiqueta: `Semana del ${formatoFecha(punto.semana, true)}: consumo real` };
      return {
        valor: formatoValor(punto.estimado),
        etiqueta: `Semana del ${formatoFecha(punto.semana, true)}: pronóstico (entre ${formatoValor(punto.inferior)} y ${formatoValor(punto.superior)})`,
      };
    }

    function senalar(i) {
      actual = Math.min(puntos.length - 1, Math.max(0, i));
      const punto = puntos[actual];
      const valor = punto.real !== undefined ? punto.real : punto.estimado;
      guia.setAttribute('x1', x(actual));
      guia.setAttribute('x2', x(actual));
      guia.setAttribute('visibility', 'visible');
      marcador.setAttribute('cx', x(actual));
      marcador.setAttribute('cy', y(valor));
      marcador.setAttribute('class', `grafico__punto ${punto.real !== undefined ? 'grafico__punto--real' : 'grafico__punto--estimado'}`);
      marcador.setAttribute('visibility', 'visible');
      const { valor: texto, etiqueta } = describir(punto);
      recuadro.mostrar(texto, etiqueta, Math.min(Math.max(x(actual), 90), ancho - 90), y(valor) + leyenda.offsetHeight - 10);
    }

    function soltar() {
      guia.setAttribute('visibility', 'hidden');
      marcador.setAttribute('visibility', 'hidden');
      recuadro.ocultar();
    }

    zona.addEventListener('pointermove', (evento) => {
      const caja = lienzo.getBoundingClientRect();
      const escala = caja.width ? ancho / caja.width : 1;
      const posicion = (evento.clientX - caja.left) * escala;
      senalar(Math.round(((posicion - margen.izquierda) / anchoPlano) * (puntos.length - 1)));
    });
    zona.addEventListener('pointerleave', soltar);
    zona.addEventListener('focus', () => senalar(actual));
    zona.addEventListener('blur', soltar);
    zona.addEventListener('keydown', (evento) => {
      if (evento.key !== 'ArrowLeft' && evento.key !== 'ArrowRight') return;
      evento.preventDefault();
      senalar(actual + (evento.key === 'ArrowRight' ? 1 : -1));
    });

    figura.appendChild(crearTabla(
      ['Semana', 'Consumo real', 'Pronóstico', 'Mínimo esperado', 'Máximo esperado'],
      puntos.map((p) => [
        formatoFecha(p.semana, true),
        p.real !== undefined ? formatoValor(p.real) : '',
        p.estimado !== undefined ? formatoValor(p.estimado) : '',
        p.inferior !== undefined ? formatoValor(p.inferior) : '',
        p.superior !== undefined ? formatoValor(p.superior) : '',
      ]),
    ));
    contenedor.replaceChildren(figura);
  }

  return { columnas, barras, pronostico, topeLegible, marcasDelEje };
}());
