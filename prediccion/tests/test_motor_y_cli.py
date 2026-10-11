import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from taller_prediccion import VERSION_DEL_CONTRATO, __version__, modelos, patrones
from taller_prediccion.contrato import EntradaInvalida, validar
from taller_prediccion.motor import SIN_HISTORIA, predecir

from conftest import CORTE, entrada, repuesto, serie_con_tendencia, serie_constante, serie_estacional, serie_intermitente

RAIZ = Path(__file__).resolve().parent.parent


def uno(valores, **cambios) -> dict:
    """Pronostica un solo repuesto y devuelve su resultado."""
    return predecir(entrada(repuesto(1, valores, **cambios)))["repuestos"][0]


class TestContrato:
    def test_acepta_la_entrada_minima_y_aplica_los_valores_por_defecto(self):
        validada = validar({"version": 1, "fechaDeCorte": "2026-10-12", "repuestos": [{"id": 1, "stockActual": 4}]})

        assert validada.horizonte_semanas == 8
        assert validada.nivel_de_servicio == 0.95
        assert validada.repuestos[0].dias_de_reposicion == 7
        assert validada.repuestos[0].consumo == []

    @pytest.mark.parametrize(
        "cambios, mensaje",
        [
            ({"version": 2}, "Versión del contrato no soportada"),
            ({"fechaDeCorte": "12/10/2026"}, "fechaDeCorte debe ser una fecha AAAA-MM-DD"),
            ({"fechaDeCorte": None}, "fechaDeCorte debe ser una fecha AAAA-MM-DD"),
            ({"horizonteSemanas": 0}, "horizonteSemanas debe ser un entero entre 1 y 26"),
            ({"horizonteSemanas": 27}, "horizonteSemanas debe ser un entero entre 1 y 26"),
            ({"horizonteSemanas": 8.5}, "horizonteSemanas debe ser un entero entre 1 y 26"),
            ({"nivelDeServicio": 1.0}, "nivelDeServicio debe estar entre 0.5 y 0.999"),
            ({"nivelDeServicio": "alto"}, "nivelDeServicio debe ser un número"),
            ({"repuestos": "todos"}, "repuestos debe ser una lista"),
        ],
    )
    def test_rechaza_parametros_generales_invalidos(self, cambios, mensaje):
        with pytest.raises(EntradaInvalida, match=mensaje):
            validar(entrada(repuesto(1, [1, 2, 3]), **cambios))

    @pytest.mark.parametrize(
        "cambios, mensaje",
        [
            ({"id": 0}, r"repuestos\[0\].id debe ser un entero positivo"),
            ({"id": "uno"}, r"repuestos\[0\].id debe ser un entero positivo"),
            ({"stockActual": -1}, r"\(id 1\).stockActual no puede ser menor que 0"),
            ({"stockActual": None}, r"\(id 1\).stockActual debe ser un número"),
            ({"stockActual": True}, r"\(id 1\).stockActual debe ser un número"),
            ({"stockActual": float("nan")}, r"\(id 1\).stockActual debe ser un número"),
            ({"diasDeReposicion": 0}, r"\(id 1\).diasDeReposicion no puede ser menor que 1"),
            ({"consumo": {}}, r"\(id 1\).consumo debe ser una lista"),
            ({"consumo": [{"semana": "2026-09-28"}]}, r"consumo\[0\].unidades debe ser un número"),
            ({"consumo": [{"semana": "ayer", "unidades": 2}]}, r"consumo\[0\].semana debe ser una fecha"),
            ({"primeraSemana": 20260101}, r"primeraSemana debe ser una fecha"),
        ],
    )
    def test_rechaza_un_repuesto_invalido_diciendo_cual_y_que_campo(self, cambios, mensaje):
        with pytest.raises(EntradaInvalida, match=mensaje):
            validar(entrada(repuesto(1, [1, 2, 3], **cambios)))

    def test_rechaza_ids_repetidos_y_entradas_que_no_son_objeto(self):
        with pytest.raises(EntradaInvalida, match="mismo id"):
            validar(entrada(repuesto(1, [1]), repuesto(1, [2])))
        with pytest.raises(EntradaInvalida, match="debe ser un objeto JSON"):
            validar([1, 2, 3])
        with pytest.raises(EntradaInvalida, match=r"repuestos\[0\] debe ser un objeto"):
            validar(entrada("no soy un repuesto"))


class TestMotor:
    def test_la_respuesta_trae_version_parametros_y_quien_la_calculo(self):
        resultado = predecir(entrada(repuesto(1, serie_constante())))

        assert resultado["version"] == VERSION_DEL_CONTRATO
        assert resultado["motor"]["nombre"] == "taller_prediccion"
        assert resultado["motor"]["version"] == __version__
        assert set(resultado["motor"]["librerias"]) == {"numpy", "pandas", "statsmodels"}
        assert resultado["parametros"] == {"fechaDeCorte": "2026-10-12", "horizonteSemanas": 8, "nivelDeServicio": 0.95, "diasDeCobertura": 30}

    def test_cada_repuesto_trae_todos_los_campos_que_usa_la_aplicacion(self):
        resultado = uno(serie_con_tendencia())

        assert set(resultado) == {
            "id", "sku", "historia", "patron", "patronDescripcion", "adi", "cv2", "modelo", "modeloNombre", "metricas", "comparados",
            "errorSemanal", "pronostico", "demandaTotal", "tendencia", "variacionTrimestral", "demandaDiaria", "demandaEnReposicion", "stockDeSeguridad",
            "puntoDeReorden", "cantidadSugerida", "debePedir", "diasDeCobertura", "fechaDeQuiebre", "quiebreAntesDeReponer", "aviso",
            "claseAbc", "valorConsumoAnual",
        }
        assert set(resultado["metricas"]) == {"rmsse", "wape", "sesgo", "mejoraSobreIngenuo", "semanasDePrueba"}
        assert set(resultado["historia"]) == {"semanas", "semanasConConsumo", "total", "mediaSemanal", "consumoUltimoAnio", "semanasSinConsumo"}

    def test_el_pronostico_empieza_en_la_semana_del_corte_y_cubre_el_horizonte(self):
        resultado = predecir(entrada(repuesto(1, serie_constante()), horizonteSemanas=5))["repuestos"][0]

        assert [p["semana"] for p in resultado["pronostico"]] == ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]

    def test_la_fecha_de_corte_puede_caer_en_cualquier_dia_de_la_semana(self):
        resultado = predecir(entrada(repuesto(1, serie_constante()), fechaDeCorte="2026-10-15"))

        assert resultado["parametros"]["fechaDeCorte"] == "2026-10-12"

    def test_el_intervalo_siempre_contiene_al_pronostico_y_no_baja_de_cero(self, generador):
        repuestos = [repuesto(i + 1, generador.poisson(generador.uniform(0.3, 8), 110)) for i in range(12)]

        for resultado in predecir(entrada(*repuestos))["repuestos"]:
            for punto in resultado["pronostico"]:
                assert 0 <= punto["inferior"] <= punto["unidades"] <= punto["superior"]

    def test_serie_constante_pronostico_exacto_e_intervalo_sin_ancho(self):
        resultado = uno(serie_constante(nivel=5))

        assert [p["unidades"] for p in resultado["pronostico"]] == [5.0] * 8
        assert resultado["pronostico"][0]["inferior"] == resultado["pronostico"][0]["superior"] == 5.0
        assert resultado["metricas"]["rmsse"] == 0.0
        assert resultado["stockDeSeguridad"] == 0
        assert (resultado["tendencia"], resultado["variacionTrimestral"]) == ("ESTABLE", 0.0)
        assert resultado["aviso"] is None

    def test_detecta_la_tendencia_creciente(self):
        resultado = uno(serie_con_tendencia())

        assert resultado["modelo"] == modelos.HOLT
        assert resultado["modeloNombre"] == "Holt con tendencia amortiguada"
        assert resultado["pronostico"][-1]["unidades"] > resultado["pronostico"][0]["unidades"]
        assert {c["modelo"] for c in resultado["comparados"]} >= {modelos.MEDIA_MOVIL, modelos.HOLT}

    def test_la_tendencia_compara_el_ultimo_trimestre_con_el_anterior(self):
        crece = uno([4.0] * 30 + [4.0] * 13 + [6.0] * 13)
        baja = uno([4.0] * 30 + [6.0] * 13 + [3.0] * 13)
        estable = uno([4.0] * 30 + [5.0] * 13 + [5.5] * 13)

        assert (crece["tendencia"], crece["variacionTrimestral"]) == ("CRECE", 0.5)
        assert (baja["tendencia"], baja["variacionTrimestral"]) == ("BAJA", -0.5)
        assert (estable["tendencia"], estable["variacionTrimestral"]) == ("ESTABLE", 0.1)

    def test_sin_dos_trimestres_de_historia_no_opina_sobre_la_tendencia(self):
        resultado = uno([3.0, 4.0] * 10)

        assert (resultado["tendencia"], resultado["variacionTrimestral"]) == ("SIN_DATOS", None)

    def test_informa_cuantas_semanas_lleva_un_repuesto_sin_usarse(self):
        activo = uno([2.0] * 40)
        parado = uno([2.0] * 30 + [0.0] * 10)
        nunca = uno(np.zeros(20))

        assert activo["historia"]["semanasSinConsumo"] == 0
        assert parado["historia"]["semanasSinConsumo"] == 10
        assert nunca["historia"]["semanasSinConsumo"] is None

    def test_un_repuesto_que_dejo_de_usarse_se_pronostica_en_cero_y_no_se_sugiere_comprar(self):
        resultado = uno([3.0, 2.0, 4.0, 3.0] * 15 + [0.0] * 40, stockActual=6)

        assert resultado["demandaTotal"] == pytest.approx(0.0, abs=0.3)
        assert resultado["cantidadSugerida"] == 0 and resultado["debePedir"] is False
        assert resultado["historia"]["semanasSinConsumo"] == 40

    def test_repuesto_estacional_anticipa_la_temporada_alta_de_diciembre(self):
        resultado = predecir(entrada(repuesto(1, serie_estacional()), horizonteSemanas=12))["repuestos"][0]
        por_mes = {}
        for punto in resultado["pronostico"]:
            por_mes.setdefault(punto["semana"][5:7], []).append(punto["unidades"])

        assert resultado["modelo"] == modelos.ESTACIONAL
        assert np.mean(por_mes["12"]) > 1.8 * np.mean(por_mes["11"])

    def test_repuesto_de_baja_rotacion_se_clasifica_y_pronostica_como_intermitente(self):
        resultado = uno(serie_intermitente(cada=4, cantidad=3), stockActual=2, diasDeReposicion=14)

        assert resultado["patron"] == patrones.INTERMITENTE
        assert resultado["adi"] == 4.0
        assert resultado["demandaTotal"] == pytest.approx(6.0, abs=1.5)  # 0,75 por semana en 8 semanas
        assert resultado["cantidadSugerida"] > 0

    def test_repuesto_sin_consumo_no_se_pronostica_ni_se_sugiere_comprar(self):
        resultado = uno([])

        assert resultado["modelo"] == SIN_HISTORIA
        assert resultado["patron"] == patrones.SIN_CONSUMO
        assert resultado["demandaTotal"] == 0.0
        assert resultado["cantidadSugerida"] == 0 and resultado["debePedir"] is False
        assert resultado["aviso"] == "Sin consumo registrado: todavía no hay con qué pronosticar."

    def test_repuesto_que_nunca_se_ha_usado_pero_lleva_tiempo_en_el_catalogo(self):
        resultado = uno(np.zeros(30))

        assert resultado["modelo"] == SIN_HISTORIA
        assert resultado["historia"]["semanas"] == 30

    def test_repuesto_nuevo_usa_el_promedio_y_lo_advierte(self):
        resultado = uno([3, 5, 4])

        assert resultado["modelo"] == modelos.MEDIA_MOVIL
        assert resultado["pronostico"][0]["unidades"] == 4.0
        assert resultado["metricas"] == {"rmsse": None, "wape": None, "sesgo": None, "mejoraSobreIngenuo": None, "semanasDePrueba": 0}
        assert resultado["aviso"].startswith("Historia corta (3 semanas)")

    def test_con_historia_entre_ocho_y_once_semanas_ajusta_pero_avisa_que_no_pudo_probar(self):
        resultado = uno([3, 4, 3, 4, 3, 4, 3, 4, 3])

        assert resultado["metricas"]["rmsse"] is None
        assert "no alcanzó para probar el modelo" in resultado["aviso"]

    def test_cuando_ningun_modelo_le_gana_a_repetir_la_ultima_semana_lo_dice(self):
        # Paseo aleatorio: cada semana es la anterior más ruido, así que copiarla es difícil de superar.
        generador = np.random.default_rng(5)
        valores = np.round(np.abs(50 + np.cumsum(generador.normal(0, 4, 120))), 2)

        resultado = uno(valores)

        assert resultado["modelo"] == modelos.INGENUO
        assert resultado["metricas"]["mejoraSobreIngenuo"] == 0.0
        assert resultado["aviso"] == "Ningún modelo pronostica mejor que repetir la última semana: tome el pronóstico como una orientación."

    def test_informa_cuanto_error_ahorra_el_modelo_frente_a_repetir_la_ultima_semana(self):
        resultado = uno(serie_estacional())

        assert 0 < resultado["metricas"]["mejoraSobreIngenuo"] <= 1
        assert resultado["aviso"] is None

    def test_la_clasificacion_abc_usa_el_valor_consumido_en_el_ultimo_anio(self):
        resultado = predecir(entrada(
            repuesto(1, serie_constante(nivel=10), costo=100000),  # 52 semanas × 10 × 100.000
            repuesto(2, serie_constante(nivel=10), costo=1000),
            repuesto(3, [], costo=999999),
        ))
        por_id = {r["id"]: r for r in resultado["repuestos"]}

        assert por_id[1]["valorConsumoAnual"] == 52_000_000
        assert [por_id[i]["claseAbc"] for i in (1, 2, 3)] == ["A", "C", "C"]

    def test_el_resumen_cuenta_lo_que_hay_que_pedir_y_cuanto_cuesta(self):
        resultado = predecir(entrada(
            repuesto(1, serie_constante(nivel=7), stockActual=2, costo=10000),
            repuesto(2, serie_constante(nivel=7), stockActual=500, costo=10000),
            repuesto(3, []),
        ))
        resumen = resultado["resumen"]
        sugerida = resultado["repuestos"][0]["cantidadSugerida"]

        assert resumen["repuestos"] == 3
        assert resumen["porPedir"] == 1
        assert resumen["quiebresAntesDeReponer"] == 1
        assert resumen["inversionSugerida"] == sugerida * 10000
        assert resumen["porPatron"] == {"SIN_CONSUMO": 1, "SUAVE": 2}
        # En una serie constante el ingenuo ya acierta siempre: no hay mejora que contar.
        assert resumen["evaluados"] == 2 and resumen["superanAlIngenuo"] == 0
        assert resumen["rmsseMediano"] == 0.0

    def test_sin_repuestos_devuelve_un_resultado_vacio_valido(self):
        resultado = predecir(entrada())

        assert resultado["repuestos"] == []
        assert resultado["resumen"]["repuestos"] == 0 and resultado["resumen"]["rmsseMediano"] is None

    def test_es_determinista_los_mismos_datos_dan_el_mismo_resultado(self, generador):
        datos = entrada(*[repuesto(i + 1, generador.poisson(4, 115)) for i in range(5)])

        primero, segundo = predecir(datos), predecir(datos)

        assert primero["repuestos"] == segundo["repuestos"]
        assert primero["resumen"] == segundo["resumen"]

    def test_el_resultado_se_puede_convertir_a_json_sin_tipos_de_numpy(self):
        texto = json.dumps(predecir(entrada(repuesto(1, serie_con_tendencia()), repuesto(2, serie_intermitente()))))

        assert "NaN" not in texto and "Infinity" not in texto

    def test_rendimiento_un_catalogo_de_sesenta_repuestos_se_calcula_en_menos_de_un_minuto(self, generador):
        import time

        datos = entrada(*[repuesto(i + 1, generador.poisson(generador.uniform(0.2, 8), 130)) for i in range(60)])
        inicio = time.perf_counter()

        predecir(datos)

        assert time.perf_counter() - inicio < 60


class TestLineaDeComandos:
    def ejecutar(self, texto: str | bytes, *argumentos: str) -> subprocess.CompletedProcess:
        datos = texto.encode("utf-8") if isinstance(texto, str) else texto
        return subprocess.run([sys.executable, "-m", "taller_prediccion", *argumentos], input=datos, capture_output=True, cwd=RAIZ, timeout=120)

    def test_lee_json_por_la_entrada_estandar_y_responde_json_por_la_salida(self):
        proceso = self.ejecutar(json.dumps(entrada(repuesto(1, serie_constante(nivel=5)))))

        assert proceso.returncode == 0
        resultado = json.loads(proceso.stdout.decode("utf-8"))
        assert resultado["repuestos"][0]["pronostico"][0]["unidades"] == 5.0

    def test_la_salida_va_en_utf8_con_las_tildes_intactas(self):
        proceso = self.ejecutar(json.dumps(entrada(repuesto(1, []))))

        assert "todavía no hay con qué pronosticar" in proceso.stdout.decode("utf-8")

    def test_no_escribe_nada_mas_que_el_json_en_la_salida_estandar(self):
        proceso = self.ejecutar(json.dumps(entrada(repuesto(1, serie_con_tendencia()), repuesto(2, serie_intermitente()))))

        assert proceso.stdout.lstrip().startswith(b"{") and proceso.stdout.rstrip().endswith(b"}")
        json.loads(proceso.stdout.decode("utf-8"))

    def test_una_entrada_que_no_cumple_el_contrato_sale_con_codigo_2_y_un_error_legible(self):
        proceso = self.ejecutar(json.dumps(entrada(repuesto(1, [1], stockActual=-3))))

        assert proceso.returncode == 2
        error = json.loads(proceso.stdout.decode("utf-8"))["error"]
        assert error["codigo"] == "ENTRADA_INVALIDA"
        assert "stockActual no puede ser menor que 0" in error["mensaje"]

    @pytest.mark.parametrize("basura", ["", "esto no es json", "{", b"\xff\xfe\x00"])
    def test_una_entrada_que_no_es_json_tambien_sale_con_codigo_2(self, basura):
        proceso = self.ejecutar(basura)

        assert proceso.returncode == 2
        assert json.loads(proceso.stdout.decode("utf-8"))["error"]["codigo"] == "ENTRADA_INVALIDA"

    def test_acepta_archivos_con_marca_de_orden_de_bytes_de_windows(self):
        proceso = self.ejecutar(b"\xef\xbb\xbf" + json.dumps(entrada(repuesto(1, serie_constante()))).encode("utf-8"))

        assert proceso.returncode == 0

    def test_puede_leer_y_escribir_archivos(self, tmp_path):
        archivo_de_entrada, archivo_de_salida = tmp_path / "entrada.json", tmp_path / "salida.json"
        archivo_de_entrada.write_text(json.dumps(entrada(repuesto(1, serie_constante()))), encoding="utf-8")

        proceso = self.ejecutar("", "--entrada", str(archivo_de_entrada), "--salida", str(archivo_de_salida), "--indentado")

        assert proceso.returncode == 0 and proceso.stdout == b""
        assert json.loads(archivo_de_salida.read_text(encoding="utf-8"))["resumen"]["repuestos"] == 1
        assert "\n  " in archivo_de_salida.read_text(encoding="utf-8")

    def test_informa_su_version(self):
        proceso = self.ejecutar("", "--version")

        assert proceso.returncode == 0
        assert proceso.stdout.decode().strip() == f"taller_prediccion {__version__}"


def test_la_fecha_de_corte_de_ejemplo_es_la_de_las_pruebas():
    assert CORTE.isoformat() == "2026-10-12"
