"""Utilidades compartidas por las pruebas: series sintéticas con patrón conocido."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pytest

CORTE = date(2026, 10, 12)  # un lunes


def semanas_hasta_el_corte(cantidad: int, corte: date = CORTE) -> list[date]:
    """Los lunes de las ``cantidad`` semanas completas anteriores al corte."""
    return [corte - timedelta(weeks=cantidad - i) for i in range(cantidad)]


def a_consumo(valores, corte: date = CORTE) -> list[dict]:
    """Convierte una serie en el formato del contrato: solo las semanas con consumo."""
    semanas = semanas_hasta_el_corte(len(valores), corte)
    return [{"semana": s.isoformat(), "unidades": float(v)} for s, v in zip(semanas, valores) if v > 0]


def repuesto(identificador: int, valores, **cambios) -> dict:
    base = {
        "id": identificador,
        "sku": f"REP-{identificador:03d}",
        "stockActual": 10,
        "stockMinimo": 3,
        "costo": 10000,
        "diasDeReposicion": 7,
        "consumo": a_consumo(valores),
    }
    if len(valores):
        base["primeraSemana"] = semanas_hasta_el_corte(len(valores))[0].isoformat()
    return {**base, **cambios}


def entrada(*repuestos: dict, **cambios) -> dict:
    return {"version": 1, "fechaDeCorte": CORTE.isoformat(), "horizonteSemanas": 8, "nivelDeServicio": 0.95, "repuestos": list(repuestos), **cambios}


# ----------------------------------------------------------- series con patrón conocido

def serie_constante(semanas: int = 60, nivel: float = 5.0) -> np.ndarray:
    return np.full(semanas, nivel)


def serie_con_tendencia(semanas: int = 80) -> np.ndarray:
    """Crece de 2 a 18 unidades por semana, con un poco de ruido determinista."""
    ruido = np.sin(np.arange(semanas) * 1.7) * 0.4
    return np.round(np.linspace(2, 18, semanas) + ruido, 2)


def serie_estacional(semanas: int = 130) -> np.ndarray:
    """Diciembre y junio (temporada de viajes) piden el triple que el resto del año."""
    fechas = semanas_hasta_el_corte(semanas)
    return np.array([18.0 if f.month in (6, 12) else 6.0 for f in fechas])


def serie_intermitente(semanas: int = 80, cada: int = 4, cantidad: float = 3.0) -> np.ndarray:
    """Sale ``cantidad`` unidades una semana de cada ``cada``."""
    valores = np.zeros(semanas)
    valores[::cada] = cantidad
    return valores


def serie_obsoleta(semanas: int = 80, activas: int = 40) -> np.ndarray:
    """Se usó cada dos semanas y luego dejó de usarse por completo."""
    valores = np.zeros(semanas)
    valores[:activas:2] = 4.0
    return valores


@pytest.fixture
def generador() -> np.random.Generator:
    return np.random.default_rng(20261012)
