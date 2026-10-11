"""Clasificación del patrón de demanda (Syntetos y Boylan, 2005).

Los repuestos no se consumen todos igual: el filtro de aceite sale todas las
semanas; la correa de distribución, una vez al mes y de a una. Tratar los
dos con el mismo modelo da malos pronósticos. La clasificación usa dos
medidas:

- **ADI** (intervalo medio entre demandas): semanas de historia dividido
  entre semanas con consumo. 1 = se usa todas las semanas.
- **CV²** (variación del tamaño): qué tanto cambia la cantidad cuando sí
  hay consumo.

              CV² < 0,49        CV² >= 0,49
ADI < 1,32    SUAVE             ERRATICA
ADI >= 1,32   INTERMITENTE      IRREGULAR
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

CORTE_ADI = 1.32
CORTE_CV2 = 0.49

SUAVE = "SUAVE"
ERRATICA = "ERRATICA"
INTERMITENTE = "INTERMITENTE"
IRREGULAR = "IRREGULAR"
SIN_CONSUMO = "SIN_CONSUMO"

DESCRIPCION = {
    SUAVE: "Se usa casi todas las semanas y en cantidades parecidas",
    ERRATICA: "Se usa casi todas las semanas, pero la cantidad cambia mucho",
    INTERMITENTE: "Pasa semanas sin usarse; cuando se usa, la cantidad es parecida",
    IRREGULAR: "Pasa semanas sin usarse y la cantidad cambia mucho",
    SIN_CONSUMO: "No se ha usado en el periodo analizado",
}


@dataclass(frozen=True)
class Patron:
    nombre: str
    adi: float | None
    cv2: float | None

    @property
    def es_intermitente(self) -> bool:
        return self.nombre in (INTERMITENTE, IRREGULAR)


def clasificar(valores: np.ndarray) -> Patron:
    """Clasifica una serie semanal de consumo."""
    con_consumo = valores[valores > 0]
    if len(con_consumo) == 0:
        return Patron(SIN_CONSUMO, None, None)

    adi = len(valores) / len(con_consumo)
    media = float(con_consumo.mean())
    cv2 = float((con_consumo.std(ddof=0) / media) ** 2) if media > 0 else 0.0

    if adi < CORTE_ADI:
        nombre = SUAVE if cv2 < CORTE_CV2 else ERRATICA
    else:
        nombre = INTERMITENTE if cv2 < CORTE_CV2 else IRREGULAR
    return Patron(nombre, round(float(adi), 3), round(cv2, 3))
