"""Interfaz de línea de comandos: JSON por la entrada estándar, JSON por la salida estándar.

    python -m taller_prediccion < entrada.json > salida.json
    python -m taller_prediccion --entrada entrada.json --salida salida.json --indentado

Códigos de salida:
    0  todo bien; la salida es el resultado.
    2  la entrada no cumple el contrato; la salida es {"error": {...}}.
    1  error inesperado; la salida es {"error": {...}} y el detalle va por stderr.

La aplicación web lo invoca así, sin intérprete de comandos de por medio.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback

from . import __version__
from .contrato import EntradaInvalida


def _leer(ruta: str | None) -> bytes:
    if ruta:
        with open(ruta, "rb") as archivo:
            return archivo.read()
    return sys.stdin.buffer.read()


def _escribir(ruta: str | None, datos: dict, indentado: bool) -> None:
    # Siempre UTF-8, sin depender de la codificación de la consola de Windows.
    texto = json.dumps(datos, ensure_ascii=False, indent=2 if indentado else None).encode("utf-8")
    if ruta:
        with open(ruta, "wb") as archivo:
            archivo.write(texto)
    else:
        sys.stdout.buffer.write(texto)
        sys.stdout.buffer.flush()


def main(argumentos: list[str] | None = None) -> int:
    analizador = argparse.ArgumentParser(prog="taller_prediccion", description="Pronóstico de demanda de repuestos del taller.")
    analizador.add_argument("--entrada", help="Archivo JSON de entrada (por defecto, la entrada estándar)")
    analizador.add_argument("--salida", help="Archivo JSON de salida (por defecto, la salida estándar)")
    analizador.add_argument("--indentado", action="store_true", help="Escribe el JSON con sangría, para leerlo a mano")
    analizador.add_argument("--version", action="version", version=f"taller_prediccion {__version__}")
    opciones = analizador.parse_args(argumentos)

    # El motor (numpy, pandas, statsmodels) se carga aquí y no al inicio: así "--version",
    # que la aplicación usa para comprobar que el modelo está disponible, responde al instante.
    from .motor import predecir

    try:
        crudo = json.loads(_leer(opciones.entrada).decode("utf-8-sig"))
        _escribir(opciones.salida, predecir(crudo), opciones.indentado)
        return 0
    except (EntradaInvalida, json.JSONDecodeError, UnicodeDecodeError) as error:
        _escribir(opciones.salida, {"error": {"codigo": "ENTRADA_INVALIDA", "mensaje": str(error)}}, opciones.indentado)
        return 2
    except Exception as error:  # noqa: BLE001 - la aplicación necesita una respuesta JSON incluso ante lo inesperado
        traceback.print_exc(file=sys.stderr)
        _escribir(opciones.salida, {"error": {"codigo": "ERROR_INTERNO", "mensaje": f"{type(error).__name__}: {error}"}}, opciones.indentado)
        return 1


if __name__ == "__main__":
    sys.exit(main())
