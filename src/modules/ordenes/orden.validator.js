/**
 * Validación de una nueva orden de reparación (función pura).
 * Criterio HU-03: registrar la orden con datos del cliente, del vehículo y
 * la descripción del problema; todos los campos obligatorios deben venir.
 */

// Placas colombianas: carros ABC123, motos ABC12D. Se ignoran espacios y guiones.
const PATRON_PLACA = /^[A-Z]{3}[0-9]{2}[0-9A-Z]$/;
const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PATRON_DOCUMENTO = /^[0-9A-Za-z.\-]{5,20}$/;
const PATRON_TELEFONO = /^[0-9+\s()-]{7,20}$/;

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

/** "abc-123" -> "ABC123". Se usa también para buscar por placa. */
function normalizarPlaca(valor) {
  return texto(valor).toUpperCase().replace(/[\s-]/g, '');
}

function obligatorio(errores, campo, valor, etiqueta, maximo) {
  if (valor === '') {
    errores.push({ campo, mensaje: `${etiqueta} es obligatorio` });
  } else if (valor.length > maximo) {
    errores.push({ campo, mensaje: `${etiqueta} admite máximo ${maximo} caracteres` });
  }
  return valor;
}

/**
 * @param {object} entrada { cliente: {...}, vehiculo: {...}, descripcion, mecanicoId }
 * @returns {{ valido: boolean, errores: {campo: string, mensaje: string}[], valor: object|null }}
 */
function validarNuevaOrden(entrada, { anioActual = new Date().getFullYear() } = {}) {
  const errores = [];
  const datos = entrada && typeof entrada === 'object' ? entrada : {};
  const cliente = datos.cliente && typeof datos.cliente === 'object' ? datos.cliente : {};
  const vehiculo = datos.vehiculo && typeof datos.vehiculo === 'object' ? datos.vehiculo : {};

  // Cliente
  const documento = obligatorio(errores, 'cliente.documento', texto(cliente.documento), 'El documento del cliente', 20);
  if (documento && !errores.some((e) => e.campo === 'cliente.documento') && !PATRON_DOCUMENTO.test(documento)) {
    errores.push({ campo: 'cliente.documento', mensaje: 'El documento solo admite números, letras, punto y guion (5 a 20)' });
  }
  const nombre = obligatorio(errores, 'cliente.nombre', texto(cliente.nombre), 'El nombre del cliente', 120);
  const telefono = obligatorio(errores, 'cliente.telefono', texto(cliente.telefono), 'El teléfono del cliente', 20);
  if (telefono && !errores.some((e) => e.campo === 'cliente.telefono') && !PATRON_TELEFONO.test(telefono)) {
    errores.push({ campo: 'cliente.telefono', mensaje: 'El teléfono no es válido' });
  }
  const email = texto(cliente.email);
  if (email && !PATRON_EMAIL.test(email)) {
    errores.push({ campo: 'cliente.email', mensaje: 'El correo no es válido' });
  }

  // Vehículo
  const placa = normalizarPlaca(vehiculo.placa);
  if (placa === '') {
    errores.push({ campo: 'vehiculo.placa', mensaje: 'La placa es obligatoria' });
  } else if (!PATRON_PLACA.test(placa)) {
    errores.push({ campo: 'vehiculo.placa', mensaje: 'La placa debe tener el formato ABC123 (carro) o ABC12D (moto)' });
  }
  const marca = obligatorio(errores, 'vehiculo.marca', texto(vehiculo.marca), 'La marca', 60);
  const modelo = obligatorio(errores, 'vehiculo.modelo', texto(vehiculo.modelo), 'El modelo', 60);

  let anio = null;
  const anioCrudo = vehiculo.anio;
  if (anioCrudo !== undefined && anioCrudo !== null && String(anioCrudo).trim() !== '') {
    anio = Number(anioCrudo);
    if (!Number.isInteger(anio) || anio < 1950 || anio > anioActual + 1) {
      errores.push({ campo: 'vehiculo.anio', mensaje: `El año debe estar entre 1950 y ${anioActual + 1}` });
    }
  }

  // Orden
  const descripcion = obligatorio(errores, 'descripcion', texto(datos.descripcion), 'La descripción del problema', 1000);

  let mecanicoId = null;
  if (datos.mecanicoId !== undefined && datos.mecanicoId !== null && String(datos.mecanicoId).trim() !== '') {
    mecanicoId = Number(datos.mecanicoId);
    if (!Number.isInteger(mecanicoId) || mecanicoId <= 0) {
      errores.push({ campo: 'mecanicoId', mensaje: 'El mecánico seleccionado no es válido' });
    }
  }

  if (errores.length > 0) return { valido: false, errores, valor: null };

  return {
    valido: true,
    errores: [],
    valor: {
      cliente: { documento, nombre, telefono, email: email || null },
      vehiculo: { placa, marca, modelo, anio },
      descripcion,
      mecanicoId,
    },
  };
}

module.exports = { validarNuevaOrden, normalizarPlaca };
