from datetime import date

import numpy as np
import pytest

from taller_prediccion import abc, inventario, modelos, patrones
from taller_prediccion.evaluacion import HORIZONTE_DE_PRUEBA, cantidad_de_origenes, elegir, evaluar, mejora_sobre_el_ingenuo

from conftest import (
    CORTE,
    semanas_hasta_el_corte,
    serie_con_tendencia,
    serie_constante,
    serie_estacional,
    serie_intermitente,
    serie_obsoleta,
)


def evaluar_serie(nombre, valores):
    return evaluar(nombre, np.asarray(valores, dtype=float), semanas_hasta_el_corte(len(valores)))


def elegir_para(valores):
    valores = np.asarray(valores, dtype=float)
    return elegir(valores, semanas_hasta_el_corte(len(valores)), patrones.clasificar(valores))


class TestOrigenMovil:
    @pytest.mark.parametrize("semanas, origenes", [(7, 0), (11, 0), (12, 1), (16, 2), (24, 4), (59, 12), (60, 13), (200, 13)])
    def test_cantidad_de_origenes_deja_al_menos_ocho_semanas_para_ajustar(self, semanas, origenes):
        assert cantidad_de_origenes(semanas) == origenes

    def test_con_historia_de_sobra_la_prueba_cubre_un_anio_completo(self):
        evaluacion = evaluar_serie(modelos.MEDIA_MOVIL, serie_constante(semanas=120))

        assert evaluacion.semanas_de_prueba == 52 == 13 * HORIZONTE_DE_PRUEBA

    def test_el_modelo_nunca_ve_las_semanas_que_tiene_que_pronosticar(self):
        # Las primeras 40 semanas valen 5 y las últimas 20 valen 9: quien "viera" el futuro acertaría el salto.
        valores = [5.0] * 40 + [9.0] * 20

        evaluacion = evaluar_serie(modelos.MEDIA_MOVIL, valores)

        # El origen que ajusta con las semanas 0 a 39 solo conoce valores de 5: falla por 4 en sus cuatro semanas.
        del_salto = evaluacion.errores[32:36]
        assert del_salto.tolist() == [4.0, 4.0, 4.0, 4.0]
        # Los orígenes anteriores al salto aciertan; los posteriores van aprendiendo el nivel nuevo.
        assert evaluacion.errores[:32].tolist() == [0.0] * 32
        assert 0 < evaluacion.errores[36:40].mean() < 4

    def test_todos_los_modelos_se_prueban_en_las_mismas_semanas(self):
        valores = serie_estacional(130)

        pruebas = {nombre: evaluar_serie(nombre, valores).semanas_de_prueba for nombre in modelos.FABRICAS}

        assert set(pruebas.values()) == {52}

    def test_un_modelo_que_no_puede_ajustarse_en_el_primer_origen_no_compite(self):
        # Con 100 semanas el primer origen ajusta con 48: al modelo estacional (78) no le alcanza.
        valores = serie_estacional(100)

        assert evaluar_serie(modelos.ESTACIONAL, valores).rmsse is None
        assert evaluar_serie(modelos.HOLT, valores).rmsse is not None
        mejor, evaluaciones = elegir_para(valores)
        assert mejor.modelo != modelos.ESTACIONAL
        assert all(e.semanas_de_prueba in (0, 52) for e in evaluaciones)

    def test_una_serie_perfectamente_predecible_tiene_error_cero(self):
        evaluacion = evaluar_serie(modelos.MEDIA_MOVIL, serie_constante())

        assert evaluacion.rmsse == 0.0
        assert evaluacion.wape == 0.0
        assert evaluacion.sesgo == 0.0

    def test_el_sesgo_es_positivo_cuando_el_modelo_se_queda_corto(self):
        evaluacion = evaluar_serie(modelos.MEDIA_MOVIL, serie_con_tendencia())

        assert evaluacion.sesgo > 0

    def test_el_mase_divide_el_error_entre_el_de_repetir_la_semana_anterior(self):
        # La serie alterna 2 y 12: repetir la semana anterior falla siempre por 10.
        # La media móvil pronostica 7 y falla por 5: su RMSSE es 5 / 10.
        valores = [2.0, 12.0] * 40

        assert evaluar_serie(modelos.MEDIA_MOVIL, valores).rmsse == pytest.approx(0.5)

    def test_la_mejora_sobre_el_ingenuo_se_mide_en_las_mismas_semanas_de_prueba(self):
        valores = np.array([2.0, 12.0] * 40)
        semanas = semanas_hasta_el_corte(len(valores))
        media = evaluar(modelos.MEDIA_MOVIL, valores, semanas)
        ingenuo = evaluar(modelos.INGENUO, valores, semanas)

        # El ingenuo copia el 12 y falla por 10 en dos de cada cuatro semanas: su error cuadrático medio es √50.
        # La media móvil falla siempre por 5. Ahorra 1 − 5/√50 ≈ 29 % del error.
        assert mejora_sobre_el_ingenuo(media, valores, semanas) == pytest.approx(1 - 5 / np.sqrt(50))
        assert mejora_sobre_el_ingenuo(ingenuo, valores, semanas) == pytest.approx(0.0)

    def test_la_mejora_es_positiva_cuando_el_modelo_le_gana_al_ingenuo(self):
        # Ruido alrededor de un nivel fijo: promediar acierta más que copiar la última semana.
        valores = np.array([5.0, 9.0, 4.0, 8.0, 6.0, 10.0, 3.0, 7.0] * 10)
        semanas = semanas_hasta_el_corte(len(valores))

        mejora = mejora_sobre_el_ingenuo(evaluar(modelos.MEDIA_MOVIL, valores, semanas), valores, semanas)

        assert 0 < mejora < 1

    def test_sin_pruebas_o_con_un_ingenuo_perfecto_no_hay_mejora_que_medir(self):
        corta = np.array([3.0, 4.0] * 5)
        constante = serie_constante()

        assert mejora_sobre_el_ingenuo(evaluar_serie(modelos.MEDIA_MOVIL, corta), corta, semanas_hasta_el_corte(10)) is None
        assert mejora_sobre_el_ingenuo(evaluar_serie(modelos.MEDIA_MOVIL, constante), constante, semanas_hasta_el_corte(60)) is None

    def test_sin_historia_suficiente_no_inventa_metricas(self):
        evaluacion = evaluar_serie(modelos.MEDIA_MOVIL, [3, 4, 5, 4, 3, 4, 5, 4, 3, 4])

        assert evaluacion.rmsse is None
        assert evaluacion.semanas_de_prueba == 0

    def test_si_en_las_semanas_de_prueba_no_hubo_consumo_wape_y_sesgo_quedan_vacios(self):
        valores = [4.0] * 30 + [0.0] * 52

        evaluacion = evaluar_serie(modelos.MEDIA_MOVIL, valores)

        assert evaluacion.wape is None and evaluacion.sesgo is None
        assert evaluacion.rmsse is not None

    def test_el_resumen_redondea_a_tres_decimales(self):
        resumen = evaluar_serie(modelos.MEDIA_MOVIL, serie_con_tendencia()).resumen()

        assert set(resumen) == {"modelo", "modeloNombre", "rmsse", "wape", "sesgo"}
        assert resumen["modeloNombre"] == "Media móvil de 8 semanas"
        assert resumen["rmsse"] == round(resumen["rmsse"], 3)


class TestElegirModelo:
    def test_con_tendencia_clara_gana_holt_sobre_la_media_movil(self):
        mejor, evaluaciones = elegir_para(serie_con_tendencia())
        por_modelo = {e.modelo: e.rmsse for e in evaluaciones}

        assert mejor.modelo == modelos.HOLT
        assert por_modelo[modelos.HOLT] < por_modelo[modelos.MEDIA_MOVIL]

    def test_con_temporadas_marcadas_y_dos_anios_y_medio_gana_el_modelo_estacional(self):
        mejor, _ = elegir_para(serie_estacional())

        assert mejor.modelo == modelos.ESTACIONAL
        assert mejor.rmsse < 1

    def test_en_un_empate_gana_el_modelo_mas_simple(self):
        mejor, evaluaciones = elegir_para(serie_constante())

        assert all(e.rmsse == 0 for e in evaluaciones if e.rmsse is not None)
        assert mejor.modelo == modelos.MEDIA_MOVIL

    def test_con_muchas_semanas_en_cero_no_gana_pronosticar_cero(self):
        # Sale 6 unidades una semana de cada cinco. Con error absoluto ganaría "siempre cero" (acierta 4 de 5);
        # con error cuadrático gana quien pronostica el promedio, que es lo que el inventario necesita.
        valores = np.zeros(100)
        valores[2::5] = 6.0
        semanas = semanas_hasta_el_corte(100)
        mejor, _ = elegir(valores, semanas, patrones.clasificar(valores))

        pronostico = modelos.FABRICAS[mejor.modelo]().ajustar(valores, semanas).pronosticar(semanas[:4])

        assert pronostico.mean() == pytest.approx(1.2, abs=0.35)
        assert mejora_sobre_el_ingenuo(mejor, valores, semanas) > 0

    def test_la_demanda_intermitente_solo_compara_modelos_para_ese_patron(self):
        mejor, evaluaciones = elegir_para(serie_intermitente())

        assert {e.modelo for e in evaluaciones} == {modelos.MEDIA_MOVIL, modelos.SUAVIZADO, modelos.CROSTON, modelos.SBA, modelos.TSB}
        assert mejor.modelo in {e.modelo for e in evaluaciones}

    def test_un_repuesto_que_dejo_de_usarse_no_se_pronostica_con_croston_clasico(self):
        # Croston se queda pegado a la última tasa; cualquier modelo que baje a cero lo supera.
        mejor, evaluaciones = elegir_para(serie_obsoleta())
        por_modelo = {e.modelo: e.rmsse for e in evaluaciones}

        assert mejor.modelo != modelos.CROSTON
        assert por_modelo[modelos.TSB] < por_modelo[modelos.CROSTON]

    def test_sin_historia_para_probar_se_usa_la_media_movil_sin_metricas(self):
        mejor, _ = elegir_para([2, 3, 2, 3, 2, 3, 2, 3, 2])

        assert mejor.modelo == modelos.MEDIA_MOVIL
        assert mejor.rmsse is None


class TestPoliticaDeInventario:
    SIETE_POR_SEMANA = np.full(8, 7.0)  # una unidad diaria

    def politica(self, pronostico=None, error=2.0, stock=10, reposicion=7, servicio=0.95):
        pronostico = self.SIETE_POR_SEMANA if pronostico is None else pronostico
        return inventario.politica(pronostico, error, stock, reposicion, servicio, CORTE)

    @pytest.mark.parametrize("servicio, z", [(0.5, 0.0), (0.90, 1.2816), (0.95, 1.6449), (0.99, 2.3263)])
    def test_z_de_servicio(self, servicio, z):
        assert inventario.z_de_servicio(servicio) == pytest.approx(z, abs=1e-4)

    @pytest.mark.parametrize(
        "pronostico, dias, esperado",
        [
            ([7, 14], 7, 7.0),
            ([7, 14], 10, 7 + 14 * 3 / 7),
            ([7, 14], 14, 21.0),
            ([7], 14, 14.0),  # más allá del horizonte se prolonga la última semana
            ([7, 14], 0, 0.0),
            ([], 10, 0.0),
        ],
    )
    def test_demanda_en_dias_reparte_cada_semana_en_siete_dias(self, pronostico, dias, esperado):
        assert inventario.demanda_en_dias(np.array(pronostico, dtype=float), dias) == pytest.approx(esperado)

    def test_ejemplo_completo_calculado_a_mano(self):
        # Una unidad diaria, error semanal 2, reposición en 7 días, servicio 95 %, stock 10.
        resultado = self.politica()

        assert resultado["demandaDiaria"] == 1.0
        assert resultado["demandaEnReposicion"] == 7.0
        assert resultado["stockDeSeguridad"] == 4  # techo(1,645 · 2 · √1) = techo(3,29)
        assert resultado["puntoDeReorden"] == 11  # 7 + 4
        assert resultado["cantidadSugerida"] == 31  # 37 días de demanda + 4 de colchón − 10 en stock
        assert resultado["debePedir"] is True  # 10 <= 11
        assert resultado["diasDeCobertura"] == 10.0
        assert resultado["fechaDeQuiebre"] == "2026-10-22"
        assert resultado["quiebreAntesDeReponer"] is False

    def test_con_mas_tiempo_de_reposicion_hacen_falta_mas_colchon_y_un_punto_de_reorden_mas_alto(self):
        corta, larga = self.politica(reposicion=7), self.politica(reposicion=28)

        assert larga["stockDeSeguridad"] == 7  # techo(1,645 · 2 · √4)
        assert larga["stockDeSeguridad"] > corta["stockDeSeguridad"]
        assert larga["puntoDeReorden"] == 28 + 7

    def test_un_nivel_de_servicio_mas_exigente_pide_mas_colchon(self):
        assert self.politica(servicio=0.99)["stockDeSeguridad"] > self.politica(servicio=0.90)["stockDeSeguridad"]

    def test_con_stock_suficiente_no_hay_que_pedir(self):
        resultado = self.politica(stock=60)

        assert resultado["debePedir"] is False
        assert resultado["cantidadSugerida"] == 0
        assert resultado["diasDeCobertura"] == 60.0

    def test_si_se_agota_antes_de_que_llegue_un_pedido_lo_avisa(self):
        resultado = self.politica(stock=3, reposicion=7)

        assert resultado["diasDeCobertura"] == 3.0
        assert resultado["quiebreAntesDeReponer"] is True

    def test_sin_stock_el_quiebre_es_hoy(self):
        resultado = self.politica(stock=0)

        assert resultado["diasDeCobertura"] == 0.0
        assert resultado["fechaDeQuiebre"] == CORTE.isoformat()

    def test_sin_demanda_esperada_no_sugiere_comprar_nada(self):
        resultado = self.politica(pronostico=np.zeros(8), stock=0)

        assert resultado == {
            "demandaDiaria": 0.0, "demandaEnReposicion": 0.0, "stockDeSeguridad": 0, "puntoDeReorden": 0, "cantidadSugerida": 0,
            "debePedir": False, "diasDeCobertura": 0.0, "fechaDeQuiebre": CORTE.isoformat(), "quiebreAntesDeReponer": True,
        }

    def test_si_el_stock_alcanza_para_mas_de_seis_meses_no_promete_fecha(self):
        resultado = self.politica(pronostico=np.full(8, 0.07), stock=50)

        assert resultado["diasDeCobertura"] is None
        assert resultado["fechaDeQuiebre"] is None

    def test_la_fecha_de_quiebre_sigue_el_pronostico_semana_a_semana(self):
        # Semana 1: 7 unidades (1 al día). Semana 2: 14 (2 al día). Con 11 en stock: 7 días + 2 días.
        dias = inventario.dias_hasta_el_quiebre(np.array([7.0, 14.0]), 11)

        assert dias == 9.0

    def test_las_cantidades_son_enteros_no_negativos(self, generador):
        for _ in range(50):
            resultado = self.politica(
                pronostico=generador.uniform(0, 12, 8), error=generador.uniform(0, 6),
                stock=int(generador.integers(0, 80)), reposicion=int(generador.integers(1, 45)),
            )
            for campo in ("stockDeSeguridad", "puntoDeReorden", "cantidadSugerida"):
                assert isinstance(resultado[campo], int) and resultado[campo] >= 0


class TestClasificacionAbc:
    def test_el_ochenta_por_ciento_del_valor_es_a_el_quince_siguiente_b_y_el_resto_c(self):
        clases = abc.clasificar({1: 800, 2: 150, 3: 40, 4: 10})

        assert clases == {1: "A", 2: "B", 3: "C", 4: "C"}

    def test_el_repuesto_que_cruza_el_ochenta_por_ciento_todavia_es_a(self):
        assert abc.clasificar({1: 500, 2: 400, 3: 100}) == {1: "A", 2: "A", 3: "B"}

    def test_lo_que_no_se_movio_siempre_es_c(self):
        assert abc.clasificar({1: 1000, 2: 0, 3: 0}) == {1: "A", 2: "C", 3: "C"}
        assert abc.clasificar({1: 0, 2: 0}) == {1: "C", 2: "C"}

    def test_no_depende_del_orden_de_entrada(self):
        valores = {1: 10, 2: 800, 3: 40, 4: 150}

        assert abc.clasificar(valores) == abc.clasificar(dict(reversed(list(valores.items()))))

    def test_sin_repuestos_devuelve_vacio(self):
        assert abc.clasificar({}) == {}


def test_la_fecha_de_corte_de_las_pruebas_es_lunes():
    assert CORTE.weekday() == 0 and CORTE == date(2026, 10, 12)
