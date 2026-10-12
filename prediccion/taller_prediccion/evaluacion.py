"""Evaluación de los modelos con origen móvil y elección del mejor.

Un modelo no se elige por lo bien que explica el pasado, sino por lo bien
que habría pronosticado semanas que no conocía. Para eso se le esconden las
últimas semanas, se le pide el pronóstico y se compara con lo que pasó de
verdad; y se repite desde varios puntos de partida (orígenes)::

    historia ──────────────────────────────────────────────►
    ajuste ████████████████████  prueba ░░░░                   origen 1
    ajuste ████████████████████████  prueba ░░░░               origen 2
    ajuste ████████████████████████████  prueba ░░░░           origen 3
    ...                                                        hasta 13

Con trece orígenes de cuatro semanas la prueba cubre un año completo: así
un modelo estacional tiene que acertar la temporada alta y la baja, y uno
que no la ve no gana solo porque las últimas semanas fueron tranquilas.
Todos los modelos se prueban en exactamente las mismas semanas; el que
necesita más historia de la que hay en el primer origen no compite.

Métricas:

- **RMSSE** (la que decide): raíz del error cuadrático medio del modelo,
  dividida entre la de repetir la semana anterior. Menor que 1 = le gana al
  método ingenuo en un paso. Es la métrica de la competencia M5 de
  pronóstico de ventas.
- **WAPE**: unidades de error por cada unidad consumida. Fácil de explicar.
- **Sesgo**: positivo = el modelo se queda corto; negativo = se pasa.
- **Mejora sobre el ingenuo**: cuánto error menos comete el modelo frente a
  repetir la última semana, medido en las mismas semanas de prueba
  (0,30 = 30 % menos error). Es la cifra que dice si el modelo vale la pena.

¿Por qué error cuadrático y no absoluto (MASE)? Porque muchos repuestos
pasan semanas sin usarse. Con error absoluto, el "mejor" pronóstico para
una serie con más ceros que consumos es siempre cero (el error absoluto lo
minimiza la mediana), y el taller se quedaría sin la pieza el día que la
piden. El error cuadrático lo minimiza el **promedio**, que es lo que
necesita el inventario: cuántas unidades salen por semana a la larga.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

import numpy as np

from .modelos import FABRICAS, INGENUO, MEDIA_MOVIL, NOMBRE_LEGIBLE, SIMPLICIDAD, candidatos
from .patrones import Patron

HORIZONTE_DE_PRUEBA = 4
ORIGENES = 13
SEMANAS_MINIMAS_DE_AJUSTE = 8


@dataclass
class Evaluacion:
    modelo: str
    rmsse: float | None
    wape: float | None
    sesgo: float | None
    semanas_de_prueba: int
    errores: np.ndarray = field(default_factory=lambda: np.array([]))

    def resumen(self) -> dict:
        redondear = lambda valor: None if valor is None else round(float(valor), 3)  # noqa: E731
        return {
            "modelo": self.modelo,
            "modeloNombre": NOMBRE_LEGIBLE[self.modelo],
            "rmsse": redondear(self.rmsse),
            "wape": redondear(self.wape),
            "sesgo": redondear(self.sesgo),
        }


def _escala_ingenua(valores: np.ndarray) -> float:
    """Raíz del error cuadrático medio de pronosticar cada semana con la anterior; es el divisor del RMSSE."""
    if len(valores) < 2:
        return 1.0
    escala = float(np.sqrt(np.mean(np.square(np.diff(valores)))))
    if escala > 0:
        return escala
    media = float(np.mean(valores))
    return media if media > 0 else 1.0


def cantidad_de_origenes(semanas_de_historia: int) -> int:
    """Cuántos orígenes caben dejando al menos ``SEMANAS_MINIMAS_DE_AJUSTE`` para ajustar."""
    return max(0, min(ORIGENES, (semanas_de_historia - SEMANAS_MINIMAS_DE_AJUSTE) // HORIZONTE_DE_PRUEBA))


def primer_ajuste(semanas_de_historia: int) -> int:
    """Semanas con las que se ajusta el modelo en el primer origen (el más antiguo)."""
    return semanas_de_historia - cantidad_de_origenes(semanas_de_historia) * HORIZONTE_DE_PRUEBA


def evaluar(nombre: str, valores: np.ndarray, semanas: list[date]) -> Evaluacion:
    """Evalúa un modelo con origen móvil.

    Devuelve métricas vacías si no hay historia para probar, o si el modelo
    no puede ajustarse en el primer origen (no se le daría un trato justo
    probándolo en menos semanas que a los demás).
    """
    origenes = cantidad_de_origenes(len(valores))
    fabrica = FABRICAS[nombre]
    errores, reales = [], []

    if origenes and primer_ajuste(len(valores)) < fabrica.semanas_minimas:
        return Evaluacion(nombre, None, None, None, 0)

    for i in range(origenes):
        fin = len(valores) - (origenes - i) * HORIZONTE_DE_PRUEBA
        prueba = slice(fin, fin + HORIZONTE_DE_PRUEBA)
        pronostico = fabrica().ajustar(valores[:fin], semanas[:fin]).pronosticar(semanas[prueba])
        errores.extend(valores[prueba] - pronostico)
        reales.extend(valores[prueba])

    if not errores:
        return Evaluacion(nombre, None, None, None, 0)

    errores = np.array(errores, dtype=float)
    reales = np.array(reales, dtype=float)
    escala = _escala_ingenua(valores[: len(valores) - origenes * HORIZONTE_DE_PRUEBA])
    total = float(reales.sum())
    return Evaluacion(
        modelo=nombre,
        rmsse=float(np.sqrt(np.mean(np.square(errores))) / escala),
        wape=float(np.abs(errores).sum() / total) if total > 0 else None,
        sesgo=float(errores.sum() / total) if total > 0 else None,
        semanas_de_prueba=len(errores),
        errores=errores,
    )


def mejora_sobre_el_ingenuo(evaluacion: Evaluacion, valores: np.ndarray, semanas: list[date]) -> float | None:
    """Fracción de error que el modelo ahorra frente a repetir la última semana, en las mismas pruebas.

    ``None`` si no hubo pruebas o si el ingenuo ya acierta siempre (no hay nada que mejorar).
    """
    if evaluacion.rmsse is None:
        return None
    referencia = evaluacion if evaluacion.modelo == INGENUO else evaluar(INGENUO, valores, semanas)
    if referencia.rmsse is None or referencia.rmsse <= 0:
        return None
    return float(1.0 - evaluacion.rmsse / referencia.rmsse)


def elegir(valores: np.ndarray, semanas: list[date], patron: Patron) -> tuple[Evaluacion, list[Evaluacion]]:
    """Compara los candidatos y devuelve ``(el mejor, todas las evaluaciones)``.

    Gana el menor RMSSE; si dos empatan (diferencia menor al 1 %), gana el
    más simple. Sin historia suficiente para probar, se usa la media móvil.
    """
    nombres = candidatos(patron.es_intermitente, len(valores))
    evaluaciones = [evaluar(nombre, valores, semanas) for nombre in nombres]
    probadas = [e for e in evaluaciones if e.rmsse is not None]
    if not probadas:
        return Evaluacion(MEDIA_MOVIL, None, None, None, 0), evaluaciones

    menor = min(e.rmsse for e in probadas)
    empatadas = [e for e in probadas if e.rmsse <= menor * 1.01 + 1e-12]
    mejor = min(empatadas, key=lambda e: SIMPLICIDAD.index(e.modelo))
    return mejor, evaluaciones
