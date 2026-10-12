"""Orquesta el pronóstico de todos los repuestos: serie → patrón → modelo → política.

Para cada repuesto:

1. arma la serie semanal (``series``);
2. clasifica su patrón de demanda (``patrones``);
3. hace competir a los modelos candidatos y elige el mejor (``evaluacion``);
4. pronostica el horizonte pedido con el ganador, con un intervalo del 80 %;
5. convierte el pronóstico en decisiones de inventario (``inventario``).

Al final clasifica el catálogo por valor de consumo (``abc``).
"""

from __future__ import annotations

import platform
from datetime import datetime, timezone

import numpy as np

from . import VERSION_DEL_CONTRATO, __version__, abc, inventario
from .contrato import Entrada, Repuesto, validar
from .evaluacion import elegir, mejora_sobre_el_ingenuo
from .modelos import FABRICAS, MEDIA_MOVIL, NOMBRE_LEGIBLE
from .patrones import DESCRIPCION, SIN_CONSUMO, clasificar
from .series import construir_serie, lunes_de, semanas_siguientes

SIN_HISTORIA = "SIN_HISTORIA"
SEMANAS_MINIMAS_PARA_MODELAR = 8
SEMANAS_DEL_ANIO = 52
SEMANAS_DEL_TRIMESTRE = 13
Z_INTERVALO_80 = 1.2816
ERRORES_MINIMOS_PARA_CUANTILES = 8


def _intervalo(pronostico: np.ndarray, errores: np.ndarray, sigma: float) -> tuple[np.ndarray, np.ndarray]:
    """Intervalo del 80 % alrededor del pronóstico.

    Con suficientes errores de prueba se usan sus cuantiles 10 y 90 (no
    supone que el error sea simétrico, y con demanda intermitente no lo es);
    con pocos, se aproxima con la desviación estándar.
    """
    if len(errores) >= ERRORES_MINIMOS_PARA_CUANTILES:
        abajo, arriba = np.quantile(errores, [0.10, 0.90])
    else:
        abajo, arriba = -Z_INTERVALO_80 * sigma, Z_INTERVALO_80 * sigma
    inferior = np.clip(pronostico + min(abajo, 0.0), 0.0, None)
    superior = pronostico + max(arriba, 0.0)
    return inferior, superior


def _tendencia(valores: np.ndarray) -> tuple[str, float | None]:
    """Compara el consumo del último trimestre (13 semanas) con el del trimestre anterior.

    Es una descripción de lo que pasó, no un pronóstico: "en los últimos tres
    meses se usó un 30 % más que en los tres anteriores". Devuelve
    ``(etiqueta, variación)``; sin dos trimestres de historia no se opina.
    """
    if len(valores) < 2 * SEMANAS_DEL_TRIMESTRE:
        return "SIN_DATOS", None
    reciente = float(valores[-SEMANAS_DEL_TRIMESTRE:].mean())
    anterior = float(valores[-2 * SEMANAS_DEL_TRIMESTRE:-SEMANAS_DEL_TRIMESTRE].mean())
    if anterior <= 0:
        return ("CRECE", None) if reciente > 0 else ("ESTABLE", 0.0)
    variacion = reciente / anterior - 1.0
    etiqueta = "CRECE" if variacion > 0.15 else "BAJA" if variacion < -0.15 else "ESTABLE"
    return etiqueta, round(variacion, 3)


def _semanas_sin_consumo(valores: np.ndarray) -> int | None:
    """Semanas completas desde la última vez que se usó; ``None`` si nunca se ha usado."""
    con_consumo = np.flatnonzero(valores > 0)
    return None if len(con_consumo) == 0 else int(len(valores) - 1 - con_consumo[-1])


def _pronosticar_repuesto(repuesto: Repuesto, entrada: Entrada) -> dict:
    corte = lunes_de(entrada.fecha_de_corte)
    semanas, valores = construir_serie(repuesto.consumo, corte, repuesto.primera_semana)
    futuras = semanas_siguientes(corte, entrada.horizonte_semanas)
    patron = clasificar(valores)
    aviso = None
    errores = np.array([])
    comparados: list[dict] = []
    metricas = {"rmsse": None, "wape": None, "sesgo": None, "mejoraSobreIngenuo": None, "semanasDePrueba": 0}

    if len(valores) == 0 or patron.nombre == SIN_CONSUMO:
        modelo = SIN_HISTORIA
        pronostico = np.zeros(entrada.horizonte_semanas)
        aviso = "Sin consumo registrado: todavía no hay con qué pronosticar."
    elif len(valores) < SEMANAS_MINIMAS_PARA_MODELAR:
        modelo = MEDIA_MOVIL
        pronostico = np.full(entrada.horizonte_semanas, float(valores.mean()))
        aviso = f"Historia corta ({len(valores)} semanas): se usa el promedio. El pronóstico mejorará con más datos."
    else:
        mejor, evaluaciones = elegir(valores, semanas, patron)
        modelo = mejor.modelo
        pronostico = FABRICAS[modelo]().ajustar(valores, semanas).pronosticar(futuras)
        errores = mejor.errores
        comparados = [e.resumen() for e in evaluaciones if e.rmsse is not None]
        mejora = mejora_sobre_el_ingenuo(mejor, valores, semanas)
        metricas = {
            **mejor.resumen(),
            "mejoraSobreIngenuo": None if mejora is None else round(mejora, 3),
            "semanasDePrueba": mejor.semanas_de_prueba,
        }
        metricas.pop("modelo")
        metricas.pop("modeloNombre")
        if mejor.rmsse is None:
            aviso = f"Historia corta ({len(valores)} semanas): no alcanzó para probar el modelo."
        elif mejora is not None and mejora <= 0:
            aviso = "Ningún modelo pronostica mejor que repetir la última semana: tome el pronóstico como una orientación."

    tendencia, variacion = _tendencia(valores)
    sigma = float(np.sqrt(np.mean(np.square(errores)))) if len(errores) else (float(valores.std()) if len(valores) else 0.0)
    inferior, superior = _intervalo(pronostico, errores, sigma)
    ultimo_anio = valores[-SEMANAS_DEL_ANIO:]

    return {
        "id": repuesto.id,
        "sku": repuesto.sku,
        "historia": {
            "semanas": int(len(valores)),
            "semanasConConsumo": int((valores > 0).sum()),
            "total": round(float(valores.sum()), 2),
            "mediaSemanal": round(float(valores.mean()), 3) if len(valores) else 0.0,
            "consumoUltimoAnio": round(float(ultimo_anio.sum()), 2),
            "semanasSinConsumo": _semanas_sin_consumo(valores),
        },
        "patron": patron.nombre,
        "patronDescripcion": DESCRIPCION[patron.nombre],
        "adi": patron.adi,
        "cv2": patron.cv2,
        "modelo": modelo,
        "modeloNombre": NOMBRE_LEGIBLE.get(modelo, "Sin modelo"),
        "metricas": metricas,
        "comparados": comparados,
        "errorSemanal": round(sigma, 3),
        "pronostico": [
            {"semana": semana.isoformat(), "unidades": round(float(p), 2), "inferior": round(float(i), 2), "superior": round(float(s), 2)}
            for semana, p, i, s in zip(futuras, pronostico, inferior, superior)
        ],
        "demandaTotal": round(float(pronostico.sum()), 2),
        "tendencia": tendencia,
        "variacionTrimestral": variacion,
        **inventario.politica(
            pronostico, sigma, repuesto.stock_actual, repuesto.dias_de_reposicion, entrada.nivel_de_servicio, entrada.fecha_de_corte
        ),
        "aviso": aviso,
        "_valorAnual": float(ultimo_anio.sum()) * repuesto.costo,
        "_costo": repuesto.costo,
    }


def _resumen(resultados: list[dict]) -> dict:
    por_pedir = [r for r in resultados if r["debePedir"]]
    errores = [r["metricas"]["rmsse"] for r in resultados if r["metricas"]["rmsse"] is not None]
    conteo = lambda campo: {valor: sum(1 for r in resultados if r[campo] == valor) for valor in sorted({r[campo] for r in resultados})}  # noqa: E731
    return {
        "repuestos": len(resultados),
        "porPedir": len(por_pedir),
        "quiebresAntesDeReponer": sum(1 for r in resultados if r["quiebreAntesDeReponer"]),
        "inversionSugerida": round(sum(r["cantidadSugerida"] * r["_costo"] for r in por_pedir), 2),
        "porPatron": conteo("patron"),
        "porModelo": conteo("modelo"),
        "rmsseMediano": round(float(np.median(errores)), 3) if errores else None,
        "superanAlIngenuo": sum(1 for r in resultados if (r["metricas"]["mejoraSobreIngenuo"] or 0) > 0),
        "evaluados": len(errores),
    }


def predecir(crudo: dict) -> dict:
    """Punto de entrada: recibe el JSON de la aplicación y devuelve el JSON de resultados."""
    entrada = validar(crudo)
    resultados = [_pronosticar_repuesto(repuesto, entrada) for repuesto in entrada.repuestos]

    clases = abc.clasificar({r["id"]: r["_valorAnual"] for r in resultados})
    resumen = _resumen(resultados)
    for resultado in resultados:
        resultado["claseAbc"] = clases[resultado["id"]]
        resultado["valorConsumoAnual"] = round(resultado.pop("_valorAnual"), 2)
        resultado.pop("_costo")

    import pandas  # solo para informar la versión instalada
    import statsmodels

    return {
        "version": VERSION_DEL_CONTRATO,
        "generadoEn": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "motor": {
            "nombre": "taller_prediccion",
            "version": __version__,
            "python": platform.python_version(),
            "librerias": {"numpy": np.__version__, "pandas": pandas.__version__, "statsmodels": statsmodels.__version__},
        },
        "parametros": {
            "fechaDeCorte": lunes_de(entrada.fecha_de_corte).isoformat(),
            "horizonteSemanas": entrada.horizonte_semanas,
            "nivelDeServicio": entrada.nivel_de_servicio,
            "diasDeCobertura": inventario.DIAS_DE_COBERTURA,
        },
        "resumen": resumen,
        "repuestos": resultados,
    }
