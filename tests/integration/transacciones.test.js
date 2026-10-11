const { crearConexion } = require('../../src/db/connection');
const { crearRepositorioRepuestos } = require('../../src/modules/inventario/repuesto.repository');
const { crearRepositorioOrdenes } = require('../../src/modules/ordenes/orden.repository');
const { crearRepositorioUsuarios } = require('../../src/modules/auth/usuario.repository');
const { crearServicioOrdenes } = require('../../src/modules/ordenes/orden.service');
const { crearServicioAuth } = require('../../src/modules/auth/auth.service');
const { ordenValida, repuestoValido } = require('../helpers/datos');

describe('Transacciones "todo o nada" (integración con la base de datos)', () => {
  let db;

  beforeEach(() => {
    db = crearConexion(':memory:');
  });

  const contar = (tabla) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n;

  test('repositorio de repuestos: si algo falla dentro de la transacción no queda nada guardado', () => {
    const repositorio = crearRepositorioRepuestos(db);

    expect(() => repositorio.enTransaccion(() => {
      repositorio.insertar(repuestoValido());
      throw new Error('fallo a mitad de camino');
    })).toThrow('fallo a mitad de camino');

    expect(contar('repuestos')).toBe(0);
    // La conexión queda utilizable: no hay una transacción abierta colgando.
    expect(repositorio.enTransaccion(() => repositorio.insertar(repuestoValido()))).toBe(1);
  });

  test('repositorio de órdenes: el cliente y el vehículo no quedan huérfanos si la orden falla', () => {
    const repositorio = crearRepositorioOrdenes(db);
    const { cliente, vehiculo } = ordenValida();

    expect(() => repositorio.enTransaccion(() => {
      const clienteId = repositorio.guardarCliente(cliente);
      repositorio.guardarVehiculo({ ...vehiculo, placa: 'ABC123' }, clienteId);
      throw new Error('fallo al crear la orden');
    })).toThrow('fallo al crear la orden');

    expect(contar('clientes')).toBe(0);
    expect(contar('vehiculos')).toBe(0);
  });

  test('si el stock cambia justo mientras se registran repuestos, se responde conflicto y no se guarda nada', () => {
    const usuarios = crearRepositorioUsuarios(db);
    const repuestos = crearRepositorioRepuestos(db);
    const mecanico = crearServicioAuth(usuarios).crearUsuario({
      usuario: 'andres', nombre: 'Andrés', rol: 'mecanico', password: 'clave-solo-para-pruebas',
    });
    const tornillo = repuestos.insertar(repuestoValido({ sku: 'A-1', stockActual: 5 }));
    const filtro = repuestos.insertar(repuestoValido({ sku: 'A-2', stockActual: 5 }));

    // Otro proceso se lleva las unidades del segundo repuesto entre la validación y el descuento.
    const repuestosConCarrera = {
      ...repuestos,
      descontarStock: (id, cantidad) => (id === filtro ? false : repuestos.descontarStock(id, cantidad)),
    };
    const servicio = crearServicioOrdenes(crearRepositorioOrdenes(db), usuarios, repuestosConCarrera);
    const orden = servicio.crear(ordenValida(), mecanico);

    expect(() => servicio.registrarRepuestos(orden.id, {
      items: [{ repuestoId: tornillo, cantidad: 2 }, { repuestoId: filtro, cantidad: 2 }],
    }, mecanico)).toThrow(/cambió mientras se registraba/);

    expect(repuestos.buscarPorId(tornillo).stockActual).toBe(5);
    expect(contar('detalle_repuestos')).toBe(0);
    expect(contar('movimientos_inventario')).toBe(0);
  });
});
