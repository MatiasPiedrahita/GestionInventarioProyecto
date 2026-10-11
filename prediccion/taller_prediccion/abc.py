"""Clasificación ABC del inventario por valor de consumo (principio de Pareto).

Unos pocos repuestos concentran casi todo el dinero que se mueve:

- **A**: los que suman el primer 80 % del valor consumido. Se vigilan de cerca.
- **B**: el siguiente 15 %.
- **C**: el 5 % restante y todo lo que no se movió. Basta revisarlos de vez en cuando.
"""

from __future__ import annotations

import pandas as pd

CORTE_A = 0.80
CORTE_B = 0.95


def clasificar(valor_por_repuesto: dict[int, float]) -> dict[int, str]:
    """Recibe ``{id: valor consumido en el último año}`` y devuelve ``{id: "A" | "B" | "C"}``."""
    if not valor_por_repuesto:
        return {}
    tabla = pd.DataFrame({"id": list(valor_por_repuesto), "valor": list(valor_por_repuesto.values())})
    # Orden estable: a igual valor, primero el id menor (el resultado no depende del orden de entrada).
    tabla = tabla.sort_values(["valor", "id"], ascending=[False, True], kind="mergesort").reset_index(drop=True)
    total = float(tabla["valor"].sum())
    if total <= 0:
        return {int(i): "C" for i in tabla["id"]}

    # La clase la decide el acumulado ANTES de sumar el repuesto: el que cruza el 80 % todavía es A.
    antes = (tabla["valor"].cumsum() - tabla["valor"]) / total
    tabla["clase"] = "C"
    tabla.loc[antes < CORTE_B, "clase"] = "B"
    tabla.loc[antes < CORTE_A, "clase"] = "A"
    tabla.loc[tabla["valor"] <= 0, "clase"] = "C"
    return {int(i): str(c) for i, c in zip(tabla["id"], tabla["clase"])}
