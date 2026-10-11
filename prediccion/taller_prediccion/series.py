"""Construcción de la serie semanal de consumo de un repuesto."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np

SEMANAS_MAXIMAS = 156  # tres años: más atrás, el taller ya no se parece al de hoy


def lunes_de(fecha: date) -> date:
    """Lunes de la semana a la que pertenece la fecha."""
    return fecha - timedelta(days=fecha.weekday())


def semanas_siguientes(desde: date, cantidad: int) -> list[date]:
    """Los lunes de las próximas ``cantidad`` semanas, empezando en ``desde``."""
    return [desde + timedelta(weeks=i) for i in range(cantidad)]


def construir_serie(
    consumo: list[dict],
    fecha_de_corte: date,
    primera_semana: date | None = None,
) -> tuple[list[date], np.ndarray]:
    """Arma la serie semanal continua de un repuesto.

    La aplicación solo envía las semanas en las que hubo consumo. Aquí se
    rellenan con cero las semanas sin movimiento, porque para el modelo "no
    se usó ninguno" es un dato tan importante como "se usaron cinco".

    - La serie empieza en ``primera_semana`` (cuando el repuesto entró al
      catálogo) o, si no se conoce, en la primera semana con consumo.
    - Termina en la última semana **completa**: la semana de la fecha de
      corte se excluye, porque está a medias y parecería una caída.
    - Un consumo neto negativo (más devoluciones que usos) se toma como cero.

    Devuelve ``(semanas, valores)``; ambas vacías si no hay historia.
    """
    corte = lunes_de(fecha_de_corte)
    por_semana: dict[date, float] = {}
    for registro in consumo:
        semana = lunes_de(registro["semana"])
        if semana < corte:
            por_semana[semana] = por_semana.get(semana, 0.0) + float(registro["unidades"])

    candidatas = list(por_semana)
    if primera_semana is not None and lunes_de(primera_semana) < corte:
        candidatas.append(lunes_de(primera_semana))
    if not candidatas:
        return [], np.array([], dtype=float)

    inicio = max(min(candidatas), corte - timedelta(weeks=SEMANAS_MAXIMAS))
    cantidad = (corte - inicio).days // 7
    semanas = semanas_siguientes(inicio, cantidad)
    valores = np.array([max(0.0, por_semana.get(semana, 0.0)) for semana in semanas], dtype=float)
    return semanas, valores
