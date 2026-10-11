"""Predicción de demanda de repuestos para el taller.

El paquete es una función pura: recibe por la entrada estándar el consumo
semanal de cada repuesto (JSON) y devuelve por la salida estándar el
pronóstico, la política de inventario sugerida y las métricas del modelo.
No abre la base de datos ni la red: la aplicación web (Node.js) le entrega
los datos y guarda los resultados.
"""

__version__ = "1.0.0"

VERSION_DEL_CONTRATO = 1
