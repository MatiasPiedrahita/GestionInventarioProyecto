"""Modelos de pronóstico candidatos.

Todos comparten la misma interfaz, para que la evaluación los compare sin
saber cuál es cuál::

    modelo = Fabrica().ajustar(valores, semanas)
    pronostico = modelo.pronosticar(semanas_futuras)   # np.ndarray, nunca negativo

Hay cuatro familias:

- **Referencia** (ingenuo, media móvil): simples y difíciles de superar; si
  un modelo elaborado no les gana, no se usa.
- **Suavizado exponencial** (statsmodels): nivel, y nivel con tendencia
  amortiguada. Para demanda que sale casi todas las semanas.
- **Demanda intermitente** (Croston, SBA, TSB): separan "cada cuánto sale"
  de "cuánto sale", que es como se comportan los repuestos de baja rotación.
- **Estacional mensual**: perfil por mes del año sobre un suavizado, para
  capturar temporadas (vacaciones, lluvias) cuando hay año y medio de historia.
"""

from __future__ import annotations

import warnings
from datetime import date

import numpy as np
from statsmodels.tools.sm_exceptions import ConvergenceWarning
from statsmodels.tsa.holtwinters import ExponentialSmoothing, SimpleExpSmoothing

INGENUO = "INGENUO"
MEDIA_MOVIL = "MEDIA_MOVIL"
SUAVIZADO = "SUAVIZADO_EXPONENCIAL"
HOLT = "HOLT_AMORTIGUADO"
ESTACIONAL = "ESTACIONAL_MENSUAL"
CROSTON = "CROSTON"
SBA = "SBA"
TSB = "TSB"

NOMBRE_LEGIBLE = {
    INGENUO: "Última semana",
    MEDIA_MOVIL: "Media móvil de 8 semanas",
    SUAVIZADO: "Suavizado exponencial simple",
    HOLT: "Holt con tendencia amortiguada",
    ESTACIONAL: "Suavizado con estacionalidad mensual",
    CROSTON: "Croston (demanda intermitente)",
    SBA: "Croston corregido (SBA)",
    TSB: "TSB (demanda intermitente que se apaga)",
}

REJILLA_ALFA = (0.05, 0.1, 0.2, 0.3)


def _no_negativo(valores) -> np.ndarray:
    return np.clip(np.asarray(valores, dtype=float), 0.0, None)


class Modelo:
    """Interfaz común. ``semanas_minimas`` es la historia que necesita para ajustarse."""

    nombre = "MODELO"
    semanas_minimas = 1

    def ajustar(self, valores: np.ndarray, semanas: list[date]) -> "Modelo":
        raise NotImplementedError

    def pronosticar(self, semanas_futuras: list[date]) -> np.ndarray:
        raise NotImplementedError


class Ingenuo(Modelo):
    """La próxima semana será como la última."""

    nombre = INGENUO

    def ajustar(self, valores, semanas):
        self._ultimo = float(valores[-1])
        return self

    def pronosticar(self, semanas_futuras):
        return _no_negativo(np.full(len(semanas_futuras), self._ultimo))


class MediaMovil(Modelo):
    """Promedio de las últimas ``ventana`` semanas."""

    nombre = MEDIA_MOVIL

    def __init__(self, ventana: int = 8):
        self.ventana = ventana

    def ajustar(self, valores, semanas):
        self._media = float(valores[-self.ventana:].mean())
        return self

    def pronosticar(self, semanas_futuras):
        return _no_negativo(np.full(len(semanas_futuras), self._media))


class SuavizadoExponencial(Modelo):
    """Suavizado exponencial simple; statsmodels estima el parámetro alfa."""

    nombre = SUAVIZADO
    semanas_minimas = 6

    def ajustar(self, valores, semanas):
        self._respaldo = float(valores[-8:].mean())
        self._ajuste = None
        if np.ptp(valores) > 0:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", ConvergenceWarning)
                    warnings.simplefilter("ignore", RuntimeWarning)
                    self._ajuste = SimpleExpSmoothing(valores, initialization_method="estimated").fit(optimized=True)
            except (ValueError, FloatingPointError, np.linalg.LinAlgError):
                self._ajuste = None
        return self

    def pronosticar(self, semanas_futuras):
        if self._ajuste is None:
            return _no_negativo(np.full(len(semanas_futuras), self._respaldo))
        return _no_negativo(self._ajuste.forecast(len(semanas_futuras)))


class HoltAmortiguado(Modelo):
    """Nivel y tendencia; la tendencia se apaga para no proyectar crecimientos eternos."""

    nombre = HOLT
    semanas_minimas = 16

    def ajustar(self, valores, semanas):
        self._respaldo = float(valores[-8:].mean())
        self._ajuste = None
        if np.ptp(valores) > 0:
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", ConvergenceWarning)
                    warnings.simplefilter("ignore", RuntimeWarning)
                    # use_brute=False: sin la búsqueda inicial por rejilla. Da el mismo pronóstico en un tercio menos de tiempo.
                    self._ajuste = ExponentialSmoothing(
                        valores, trend="add", damped_trend=True, initialization_method="estimated"
                    ).fit(optimized=True, use_brute=False)
            except (ValueError, FloatingPointError, np.linalg.LinAlgError):
                self._ajuste = None
        return self

    def pronosticar(self, semanas_futuras):
        if self._ajuste is None:
            return _no_negativo(np.full(len(semanas_futuras), self._respaldo))
        pronostico = np.asarray(self._ajuste.forecast(len(semanas_futuras)), dtype=float)
        if not np.all(np.isfinite(pronostico)):
            return _no_negativo(np.full(len(semanas_futuras), self._respaldo))
        return _no_negativo(pronostico)


class EstacionalMensual(Modelo):
    """Suavizado exponencial sobre la serie sin estación, más un perfil por mes del año.

    El perfil de cada mes es cuánto se consume ese mes frente al promedio
    (1,3 = un 30 % más). Necesita año y medio de historia, y solo calcula
    el perfil de un mes cuando lo ha visto al menos dos veces (seis semanas):
    con menos confundiría un mes raro con una temporada. Los índices se
    encogen hacia 1 para no exagerar.
    """

    nombre = ESTACIONAL
    semanas_minimas = 78
    ENCOGIMIENTO = 0.7

    def ajustar(self, valores, semanas):
        meses = np.array([semana.month for semana in semanas])
        media_global = float(valores.mean())
        self._indices = np.ones(13)
        if media_global > 0:
            for mes in range(1, 13):
                del_mes = valores[meses == mes]
                if len(del_mes) >= 6:
                    crudo = float(del_mes.mean()) / media_global
                    self._indices[mes] = 1.0 + self.ENCOGIMIENTO * (crudo - 1.0)
        # Normaliza para que el perfil no cambie el nivel medio del año.
        self._indices[1:] = self._indices[1:] / self._indices[1:].mean()
        sin_estacion = valores / np.maximum(self._indices[meses], 0.05)
        self._base = SuavizadoExponencial().ajustar(sin_estacion, semanas)
        return self

    def pronosticar(self, semanas_futuras):
        base = self._base.pronosticar(semanas_futuras)
        meses = np.array([semana.month for semana in semanas_futuras])
        return _no_negativo(base * self._indices[meses])


class Croston(Modelo):
    """Croston (1972): suaviza por separado el tamaño de la demanda y el intervalo entre demandas.

    El pronóstico por semana es tamaño / intervalo. ``correccion`` aplica el
    ajuste de Syntetos y Boylan (SBA), que quita el sesgo hacia arriba del
    método original.
    """

    nombre = CROSTON
    semanas_minimas = 8
    correccion = False

    def _recorrer(self, valores: np.ndarray, alfa: float) -> tuple[float, float]:
        """Devuelve (pronóstico final por semana, error cuadrático medio de un paso)."""
        tamano = None
        intervalo = None
        espera = 1
        errores = []
        for valor in valores:
            if tamano is not None:
                errores.append(valor - self._tasa(tamano, intervalo, alfa))
            if valor > 0:
                if tamano is None:
                    tamano, intervalo = float(valor), float(espera)
                else:
                    tamano = tamano + alfa * (valor - tamano)
                    intervalo = intervalo + alfa * (espera - intervalo)
                espera = 1
            else:
                espera += 1
        if tamano is None:
            return 0.0, 0.0
        ecm = float(np.mean(np.square(errores))) if errores else 0.0
        return self._tasa(tamano, intervalo, alfa), ecm

    def _tasa(self, tamano: float, intervalo: float, alfa: float) -> float:
        tasa = tamano / max(intervalo, 1.0)
        return tasa * (1.0 - alfa / 2.0) if self.correccion else tasa

    def ajustar(self, valores, semanas):
        # Se elige el alfa que mejor habría pronosticado la propia historia.
        resultados = [(self._recorrer(valores, alfa), alfa) for alfa in REJILLA_ALFA]
        (self._pronostico, _), self.alfa = min(resultados, key=lambda r: (r[0][1], r[1]))
        return self

    def pronosticar(self, semanas_futuras):
        return _no_negativo(np.full(len(semanas_futuras), self._pronostico))


class CrostonSBA(Croston):
    nombre = SBA
    correccion = True


class TeunterSyntetosBabai(Modelo):
    """TSB (2011): suaviza la probabilidad de que haya demanda en una semana.

    A diferencia de Croston, la probabilidad se actualiza todas las semanas,
    también cuando no hay consumo. Si un repuesto deja de usarse, el
    pronóstico baja solo en lugar de quedarse pegado al último valor: detecta
    obsolescencia.
    """

    nombre = TSB
    semanas_minimas = 8

    @staticmethod
    def _recorrer(valores: np.ndarray, alfa: float, beta: float) -> tuple[float, float]:
        positivos = valores[valores > 0]
        if len(positivos) == 0:
            return 0.0, 0.0
        tamano = float(positivos[0])
        probabilidad = float((valores > 0).mean())
        errores = []
        for valor in valores:
            errores.append(valor - probabilidad * tamano)
            hubo = 1.0 if valor > 0 else 0.0
            probabilidad = probabilidad + beta * (hubo - probabilidad)
            if valor > 0:
                tamano = tamano + alfa * (valor - tamano)
        return probabilidad * tamano, float(np.mean(np.square(errores)))

    def ajustar(self, valores, semanas):
        resultados = [(self._recorrer(valores, alfa, beta), alfa, beta) for alfa in REJILLA_ALFA for beta in REJILLA_ALFA]
        (self._pronostico, _), self.alfa, self.beta = min(resultados, key=lambda r: (r[0][1], r[1], r[2]))
        return self

    def pronosticar(self, semanas_futuras):
        return _no_negativo(np.full(len(semanas_futuras), self._pronostico))


FABRICAS = {
    INGENUO: Ingenuo,
    MEDIA_MOVIL: MediaMovil,
    SUAVIZADO: SuavizadoExponencial,
    HOLT: HoltAmortiguado,
    ESTACIONAL: EstacionalMensual,
    CROSTON: Croston,
    SBA: CrostonSBA,
    TSB: TeunterSyntetosBabai,
}

# Orden de preferencia ante un empate: primero el más simple.
SIMPLICIDAD = [MEDIA_MOVIL, INGENUO, SUAVIZADO, CROSTON, SBA, TSB, HOLT, ESTACIONAL]


def candidatos(es_intermitente: bool, semanas_de_historia: int) -> list[str]:
    """Modelos que compiten para un repuesto, según su patrón y cuánta historia tiene."""
    if es_intermitente:
        nombres = [MEDIA_MOVIL, SUAVIZADO, CROSTON, SBA, TSB]
    else:
        nombres = [MEDIA_MOVIL, INGENUO, SUAVIZADO, HOLT, ESTACIONAL]
    return [nombre for nombre in nombres if semanas_de_historia >= FABRICAS[nombre].semanas_minimas]
