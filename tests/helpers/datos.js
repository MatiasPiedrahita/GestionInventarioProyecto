/** Datos de ejemplo reutilizables en las pruebas. */

function ordenValida(cambios = {}) {
  return {
    cliente: { documento: '1037654321', nombre: 'Camila Ortiz', telefono: '3001234567', email: 'camila@ejemplo.com' },
    vehiculo: { placa: 'abc-123', marca: 'Chevrolet', modelo: 'Spark GT', anio: 2018 },
    descripcion: 'Ruido metálico al frenar y vibración en el timón',
    ...cambios,
  };
}

function repuestoValido(cambios = {}) {
  return {
    sku: 'FIL-ACE-001',
    nombre: 'Filtro de aceite Mann W712',
    costo: 28500,
    stockActual: 10,
    stockMinimo: 3,
    ...cambios,
  };
}

module.exports = { ordenValida, repuestoValido };
