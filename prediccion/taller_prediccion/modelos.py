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
  capturar temporadas (vacaciones, lluvias). Se ajusta con un año de historia
  y compite cuando hay dos (un año para aprender y otro para probarlo).
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


def _recta_de_tendencia(valores: np.ndarray) -> np.ndarray:
    """Valor de la recta de mínimos cuadrados en cada semana, sin bajar de un cuarto de la media.

    El piso evita dividir entre casi cero (o entre un negativo) cuando la
    recta de un repuesto que crece mucho corta el eje al principio.
    """
    tiempo = np.arange(len(valores), dtype=float)
    pendiente, origen = np.polyfit(tiempo, valores, 1)
    return np.maximum(origen + pendiente * tiempo, float(valores.mean()) * 0.25)


class EstacionalMensual(Modelo):
    """Suavizado exponencial sobre la serie sin estación, más un perfil por mes del año.

    El perfil de un mes es cuánto se consume ese mes frente a lo normal
    (1,3 = un 30 % más). Se calcula en tres pasos:

    1. **Se quita la tendencia.** Cada semana se divide entre la recta que
       mejor describe la serie. Sin esto, en un repuesto que crece, los
       meses que más pesan al final de la historia parecerían temporada alta.
    2. **Perfil crudo**: el promedio de esas razones en las semanas del mes.
    3. **Se encoge hacia 1 según cuánta señal hay** (Bayes empírico). Si los
       meses se diferencian mucho más de lo que explica el ruido de una
       semana a otra, el perfil casi no se toca; si las diferencias caben en
       el ruido, el perfil queda en 1 y el modelo se comporta como un
       suavizado simple. Así no inventa temporadas donde no las hay ni
       recorta las que sí existen.

    Se ajusta con un año de historia (cada mes visto al menos cuatro
    semanas). La evaluación le exige otro año para probarlo, de modo que
    compite cuando el repuesto tiene dos años de consumo.
    """

    nombre = ESTACIONAL
    semanas_minimas = 52
    SEMANAS_POR_MES = 4
    MESES_MINIMOS = 6

    def _perfil(self, valores: np.ndarray, meses: np.ndarray) -> np.ndarray:
        indices = np.ones(13)
        if float(valores.mean()) <= 0:
            return indices

        razones = valores / _recta_de_tendencia(valores)
        crudos: dict[int, float] = {}
        semanas_del_mes: dict[int, int] = {}
        suma_de_cuadrados, grados = 0.0, 0
        for mes in range(1, 13):
            del_mes = razones[meses == mes]
            if len(del_mes) >= self.SEMANAS_POR_MES:
                crudos[mes] = float(del_mes.mean())
                semanas_del_mes[mes] = len(del_mes)
                suma_de_cuadrados += float(np.square(del_mes - del_mes.mean()).sum())
                grados += len(del_mes) - 1
        if len(crudos) < self.MESES_MINIMOS or grados == 0:
            return indices

        # Ruido: cuánto se mueve el promedio de un mes solo por azar. Señal: lo que varían los meses más allá de ese ruido.
        varianza_semanal = suma_de_cuadrados / grados
        ruido = {mes: varianza_semanal / semanas_del_mes[mes] for mes in crudos}
        senal = max(0.0, float(np.var(list(crudos.values()), ddof=1)) - float(np.mean(list(ruido.values()))))
        centro = float(np.mean(list(crudos.values())))
        for mes, crudo in crudos.items():
            confianza = senal / (senal + ruido[mes]) if senal + ruido[mes] > 0 else 0.0
            indices[mes] = 1.0 + confianza * (crudo / centro - 1.0)
        # Normaliza para que el perfil no cambie el nivel medio del año.
        indices[1:] = indices[1:] / indices[1:].mean()
        return indices

    def ajustar(self, valores, semanas):
        meses = np.array([semana.month for semana in semanas])
        self._indices = self._perfil(valores, meses)
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
