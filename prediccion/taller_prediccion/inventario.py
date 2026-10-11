"""Del pronóstico a la decisión: cuánto pedir y cuándo.

Un pronóstico por sí solo no le sirve al dueño del taller. Lo que necesita
saber es: ¿me alcanza lo que tengo hasta que llegue el próximo pedido?, ¿en
qué fecha me quedo sin este repuesto?, ¿cuántos pido?

Política de revisión continua (punto de reorden):

- **Demanda durante la reposición**: lo que se espera consumir mientras
  llega un pedido (``dias_de_reposicion``).
- **Stock de seguridad**: colchón para cuando la demanda sale más alta que
  el pronóstico. ``z · σ · √(semanas de reposición)``, donde σ es el error
  semanal del modelo en las pruebas y z sale del nivel de servicio (95 % →
  1,64): con ese colchón, 95 de cada 100 reposiciones no llegan a quiebre.
- **Punto de reorden** = demanda durante la reposición + stock de
  seguridad. Cuando el stock baja hasta ahí, hay que pedir.
- **Cantidad sugerida**: lo que falta para cubrir la reposición más
  ``dias_de_cobertura`` adicionales, con el colchón incluido.
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from statistics import NormalDist

import numpy as np

DIAS_DE_COBERTURA = 30
DIAS_MAXIMOS_DE_PROYECCION = 180


def z_de_servicio(nivel_de_servicio: float) -> float:
    """Cuántas desviaciones estándar de colchón exige el nivel de servicio (0,95 → 1,645)."""
    return NormalDist().inv_cdf(nivel_de_servicio)


def demanda_en_dias(pronostico_semanal: np.ndarray, dias: float) -> float:
    """Unidades esperadas en los próximos ``dias``, repartiendo cada semana en siete días.

    Si los días superan el horizonte del pronóstico, se prolonga la última semana.
    """
    if len(pronostico_semanal) == 0 or dias <= 0:
        return 0.0
    total, restantes = 0.0, float(dias)
    for semanal in pronostico_semanal:
        tomados = min(7.0, restantes)
        total += semanal * tomados / 7.0
        restantes -= tomados
        if restantes <= 0:
            return total
    return total + float(pronostico_semanal[-1]) * restantes / 7.0


def dias_hasta_el_quiebre(pronostico_semanal: np.ndarray, stock: float) -> float | None:
    """Días que dura el stock actual consumiéndose al ritmo pronosticado.

    Devuelve ``None`` si alcanza para más de ``DIAS_MAXIMOS_DE_PROYECCION``
    (o si no se espera consumo): no tiene sentido prometer una fecha tan lejana.
    """
    if stock <= 0:
        return 0.0
    restante = float(stock)
    for dia in range(DIAS_MAXIMOS_DE_PROYECCION):
        semana = min(dia // 7, len(pronostico_semanal) - 1)
        consumo_diario = float(pronostico_semanal[semana]) / 7.0 if len(pronostico_semanal) else 0.0
        if consumo_diario <= 0:
            continue
        if restante <= consumo_diario:
            return round(dia + restante / consumo_diario, 1)
        restante -= consumo_diario
    return None


def politica(
    pronostico_semanal: np.ndarray,
    error_semanal: float,
    stock_actual: float,
    dias_de_reposicion: int,
    nivel_de_servicio: float,
    fecha_de_corte: date,
    dias_de_cobertura: int = DIAS_DE_COBERTURA,
) -> dict:
    """Calcula la política de inventario sugerida para un repuesto."""
    en_reposicion = demanda_en_dias(pronostico_semanal, dias_de_reposicion)
    hay_demanda = float(np.sum(pronostico_semanal)) > 0

    seguridad = 0
    if hay_demanda and error_semanal > 0:
        seguridad = math.ceil(z_de_servicio(nivel_de_servicio) * error_semanal * math.sqrt(max(dias_de_reposicion, 1) / 7.0))

    punto_de_reorden = math.ceil(en_reposicion + seguridad - 1e-9) if hay_demanda else 0
    objetivo = demanda_en_dias(pronostico_semanal, dias_de_reposicion + dias_de_cobertura) + seguridad
    cantidad_sugerida = max(0, math.ceil(objetivo - stock_actual - 1e-9)) if hay_demanda else 0

    dias = dias_hasta_el_quiebre(pronostico_semanal, stock_actual)
    fecha_de_quiebre = None if dias is None else (fecha_de_corte + timedelta(days=math.floor(dias))).isoformat()
    semanas = max(len(pronostico_semanal), 1)

    return {
        "demandaDiaria": round(float(np.sum(pronostico_semanal)) / (semanas * 7.0), 3),
        "demandaEnReposicion": round(en_reposicion, 2),
        "stockDeSeguridad": int(seguridad),
        "puntoDeReorden": int(punto_de_reorden),
        "cantidadSugerida": int(cantidad_sugerida),
        "debePedir": bool(hay_demanda and stock_actual <= punto_de_reorden),
        "diasDeCobertura": dias,
        "fechaDeQuiebre": fecha_de_quiebre,
        # Se agotaría antes de que alcance a llegar un pedido hecho hoy.
        "quiebreAntesDeReponer": bool(dias is not None and dias < dias_de_reposicion),
    }
