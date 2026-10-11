"""Contrato de entrada entre la aplicación web y el modelo.

La aplicación envía un JSON como este (ver ``prediccion/README.md``)::

    {
      "version": 1,
      "fechaDeCorte": "2026-10-12",
      "horizonteSemanas": 8,
      "nivelDeServicio": 0.95,
      "repuestos": [
        { "id": 1, "sku": "FIL-ACE-001", "stockActual": 14, "stockMinimo": 5, "costo": 28500,
          "diasDeReposicion": 7, "primeraSemana": "2025-01-06",
          "consumo": [ { "semana": "2026-09-28", "unidades": 6 } ] }
      ]
    }

Aquí se valida todo antes de calcular: un dato mal formado produce un
mensaje claro que dice qué repuesto y qué campo, en lugar de un error de
Python a mitad del cálculo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from . import VERSION_DEL_CONTRATO

HORIZONTE_MINIMO, HORIZONTE_MAXIMO = 1, 26
REPUESTOS_MAXIMOS = 5000


class EntradaInvalida(ValueError):
    """La entrada no cumple el contrato."""


@dataclass(frozen=True)
class Repuesto:
    id: int
    sku: str
    stock_actual: float
    stock_minimo: float
    costo: float
    dias_de_reposicion: int
    primera_semana: date | None
    consumo: list[dict]


@dataclass(frozen=True)
class Entrada:
    fecha_de_corte: date
    horizonte_semanas: int
    nivel_de_servicio: float
    repuestos: list[Repuesto]


def _fecha(valor, campo: str) -> date:
    if not isinstance(valor, str):
        raise EntradaInvalida(f"{campo} debe ser una fecha AAAA-MM-DD")
    try:
        return date.fromisoformat(valor[:10])
    except ValueError as error:
        raise EntradaInvalida(f"{campo} debe ser una fecha AAAA-MM-DD (llegó {valor!r})") from error


def _numero(valor, campo: str, minimo: float = 0.0) -> float:
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or valor != valor:
        raise EntradaInvalida(f"{campo} debe ser un número")
    if valor < minimo:
        raise EntradaInvalida(f"{campo} no puede ser menor que {minimo:g}")
    return float(valor)


def _repuesto(crudo, indice: int) -> Repuesto:
    donde = f"repuestos[{indice}]"
    if not isinstance(crudo, dict):
        raise EntradaInvalida(f"{donde} debe ser un objeto")
    identificador = crudo.get("id")
    if isinstance(identificador, bool) or not isinstance(identificador, int) or identificador <= 0:
        raise EntradaInvalida(f"{donde}.id debe ser un entero positivo")
    donde = f"repuestos[{indice}] (id {identificador})"

    consumo = crudo.get("consumo", [])
    if not isinstance(consumo, list):
        raise EntradaInvalida(f"{donde}.consumo debe ser una lista")
    limpio = []
    for j, registro in enumerate(consumo):
        if not isinstance(registro, dict):
            raise EntradaInvalida(f"{donde}.consumo[{j}] debe ser un objeto")
        unidades = registro.get("unidades")
        if isinstance(unidades, bool) or not isinstance(unidades, (int, float)) or unidades != unidades:
            raise EntradaInvalida(f"{donde}.consumo[{j}].unidades debe ser un número")
        limpio.append({"semana": _fecha(registro.get("semana"), f"{donde}.consumo[{j}].semana"), "unidades": float(unidades)})

    primera = crudo.get("primeraSemana")
    return Repuesto(
        id=identificador,
        sku=str(crudo.get("sku", identificador)),
        stock_actual=_numero(crudo.get("stockActual"), f"{donde}.stockActual"),
        stock_minimo=_numero(crudo.get("stockMinimo", 0), f"{donde}.stockMinimo"),
        costo=_numero(crudo.get("costo", 0), f"{donde}.costo"),
        dias_de_reposicion=int(_numero(crudo.get("diasDeReposicion", 7), f"{donde}.diasDeReposicion", minimo=1)),
        primera_semana=None if primera is None else _fecha(primera, f"{donde}.primeraSemana"),
        consumo=limpio,
    )


def validar(crudo) -> Entrada:
    """Convierte el JSON recibido en una ``Entrada`` validada, o lanza ``EntradaInvalida``."""
    if not isinstance(crudo, dict):
        raise EntradaInvalida("La entrada debe ser un objeto JSON")
    if crudo.get("version") != VERSION_DEL_CONTRATO:
        raise EntradaInvalida(f"Versión del contrato no soportada: {crudo.get('version')!r} (se esperaba {VERSION_DEL_CONTRATO})")

    horizonte = crudo.get("horizonteSemanas", 8)
    if isinstance(horizonte, bool) or not isinstance(horizonte, int) or not HORIZONTE_MINIMO <= horizonte <= HORIZONTE_MAXIMO:
        raise EntradaInvalida(f"horizonteSemanas debe ser un entero entre {HORIZONTE_MINIMO} y {HORIZONTE_MAXIMO}")

    servicio = _numero(crudo.get("nivelDeServicio", 0.95), "nivelDeServicio")
    if not 0.5 <= servicio <= 0.999:
        raise EntradaInvalida("nivelDeServicio debe estar entre 0.5 y 0.999")

    repuestos = crudo.get("repuestos")
    if not isinstance(repuestos, list):
        raise EntradaInvalida("repuestos debe ser una lista")
    if len(repuestos) > REPUESTOS_MAXIMOS:
        raise EntradaInvalida(f"Máximo {REPUESTOS_MAXIMOS} repuestos por ejecución")
    validados = [_repuesto(r, i) for i, r in enumerate(repuestos)]
    if len({r.id for r in validados}) != len(validados):
        raise EntradaInvalida("Hay repuestos con el mismo id")

    return Entrada(
        fecha_de_corte=_fecha(crudo.get("fechaDeCorte"), "fechaDeCorte"),
        horizonte_semanas=horizonte,
        nivel_de_servicio=servicio,
        repuestos=validados,
    )
