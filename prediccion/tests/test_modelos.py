from datetime import timedelta

import numpy as np
import pytest

from taller_prediccion import modelos
from taller_prediccion.modelos import (
    FABRICAS,
    Croston,
    CrostonSBA,
    EstacionalMensual,
    HoltAmortiguado,
    Ingenuo,
    MediaMovil,
    SuavizadoExponencial,
    TeunterSyntetosBabai,
    candidatos,
)

from conftest import CORTE, semanas_hasta_el_corte, serie_con_tendencia, serie_constante, serie_estacional, serie_intermitente, serie_obsoleta

FUTURAS = [CORTE + timedelta(weeks=i) for i in range(8)]


def ajustar(fabrica, valores):
    return fabrica().ajustar(np.asarray(valores, dtype=float), semanas_hasta_el_corte(len(valores)))


class TestModelosDeReferencia:
    def test_ingenuo_repite_la_ultima_semana(self):
        assert ajustar(Ingenuo, [3, 5, 9]).pronosticar(FUTURAS[:3]).tolist() == [9.0, 9.0, 9.0]

    def test_media_movil_promedia_las_ultimas_ocho_semanas(self):
        valores = [100] * 5 + [2, 4, 6, 8, 2, 4, 6, 8]

        assert ajustar(MediaMovil, valores).pronosticar(FUTURAS[:2]).tolist() == [5.0, 5.0]

    def test_media_movil_con_menos_semanas_que_la_ventana_usa_las_que_hay(self):
        assert ajustar(MediaMovil, [2, 4]).pronosticar(FUTURAS[:1]).tolist() == [3.0]


class TestSuavizadoExponencial:
    def test_una_serie_constante_se_pronostica_en_su_nivel(self):
        pronostico = ajustar(SuavizadoExponencial, serie_constante(nivel=5)).pronosticar(FUTURAS)

        assert pronostico == pytest.approx(np.full(8, 5.0))

    def test_sigue_el_nivel_reciente_cuando_la_serie_cambia_de_escalon(self):
        valores = [2.0] * 30 + [10.0] * 30

        pronostico = ajustar(SuavizadoExponencial, valores).pronosticar(FUTURAS)

        assert pronostico[0] == pytest.approx(10.0, abs=0.5)

    def test_holt_proyecta_la_tendencia_por_encima_del_ultimo_nivel(self):
        valores = serie_con_tendencia()

        pronostico = ajustar(HoltAmortiguado, valores).pronosticar(FUTURAS)

        assert pronostico[0] > valores[-8:].mean()
        assert np.all(np.diff(pronostico) >= -1e-9), "con tendencia creciente el pronóstico no debe bajar"

    def test_holt_amortigua_la_tendencia_cada_semana_crece_menos(self):
        pronostico = ajustar(HoltAmortiguado, serie_con_tendencia()).pronosticar(FUTURAS)
        incrementos = np.diff(pronostico)

        assert incrementos[-1] <= incrementos[0] + 1e-9


class TestEstacionalMensual:
    def test_pronostica_mas_en_los_meses_de_temporada(self):
        modelo = ajustar(EstacionalMensual, serie_estacional())
        # De mediados de octubre a comienzos de enero: cruza diciembre (temporada alta).
        futuras = [CORTE + timedelta(weeks=i) for i in range(12)]

        pronostico = modelo.pronosticar(futuras)
        diciembre = pronostico[[f.month == 12 for f in futuras]]
        noviembre = pronostico[[f.month == 11 for f in futuras]]

        assert diciembre.mean() > 1.8 * noviembre.mean()

    def test_el_perfil_no_cambia_el_nivel_medio_del_anio(self):
        modelo = ajustar(EstacionalMensual, serie_estacional())

        assert modelo._indices[1:].mean() == pytest.approx(1.0)

    def test_sin_estacionalidad_se_comporta_como_el_suavizado_simple(self):
        pronostico = ajustar(EstacionalMensual, serie_constante(semanas=120, nivel=7)).pronosticar(FUTURAS)

        assert pronostico == pytest.approx(np.full(8, 7.0), rel=0.01)

    def test_necesita_anio_y_medio_de_historia(self):
        assert EstacionalMensual.semanas_minimas == 78

    def test_el_perfil_de_un_mes_solo_se_calcula_si_se_ha_visto_dos_veces(self):
        def indice_de_diciembre(semanas):
            valores = np.array([20.0 if s.month == 12 else 5.0 for s in semanas_hasta_el_corte(semanas)])
            return ajustar(EstacionalMensual, valores)._indices[12]

        # 100 semanas atrás desde octubre de 2026 incluyen diciembre de 2024 y de 2025; 80 semanas, solo el de 2025.
        assert indice_de_diciembre(100) > 1.5
        assert indice_de_diciembre(80) < 1.2, "un solo diciembre alto puede ser casualidad: no se toma como temporada"


class TestDemandaIntermitente:
    def test_croston_calcula_tamano_sobre_intervalo(self):
        # Demandas de 2 y 4 separadas por tres semanas, con alfa 0,1:
        # tamaño = 2 + 0,1·(4−2) = 2,2 ; intervalo = 1 + 0,1·(3−1) = 1,2 ; tasa = 2,2 / 1,2
        tasa, _ = Croston()._recorrer(np.array([2.0, 0, 0, 4.0]), alfa=0.1)

        assert tasa == pytest.approx(2.2 / 1.2)

    def test_sba_corrige_el_sesgo_de_croston_hacia_abajo(self):
        valores = np.array([2.0, 0, 0, 4.0])
        croston, _ = Croston()._recorrer(valores, alfa=0.1)
        sba, _ = CrostonSBA()._recorrer(valores, alfa=0.1)

        assert sba == pytest.approx(croston * (1 - 0.1 / 2))

    def test_tsb_calcula_probabilidad_por_tamano(self):
        # probabilidad inicial 0,5 → 0,55 → 0,495 → 0,4455 → 0,50095 ; tamaño 2 → 2,2
        tasa, _ = TeunterSyntetosBabai._recorrer(np.array([2.0, 0, 0, 4.0]), alfa=0.1, beta=0.1)

        assert tasa == pytest.approx(0.50095 * 2.2)

    @pytest.mark.parametrize("fabrica", [Croston, CrostonSBA, TeunterSyntetosBabai])
    def test_demanda_regular_cada_cuatro_semanas_se_pronostica_cerca_de_su_tasa_real(self, fabrica):
        pronostico = ajustar(fabrica, serie_intermitente(cada=4, cantidad=3)).pronosticar(FUTURAS)

        assert pronostico[0] == pytest.approx(0.75, abs=0.12)
        assert np.all(pronostico == pronostico[0]), "el pronóstico intermitente es una tasa plana por semana"

    def test_tsb_detecta_la_obsolescencia_y_croston_no(self):
        valores = serie_obsoleta()
        tsb = ajustar(TeunterSyntetosBabai, valores).pronosticar(FUTURAS)[0]
        croston = ajustar(Croston, valores).pronosticar(FUTURAS)[0]

        assert tsb < 0.25 * croston
        assert croston > 1.0

    @pytest.mark.parametrize("fabrica", [Croston, CrostonSBA, TeunterSyntetosBabai])
    def test_sin_ninguna_demanda_pronostican_cero(self, fabrica):
        assert ajustar(fabrica, np.zeros(20)).pronosticar(FUTURAS).tolist() == [0.0] * 8


class TestPropiedadesComunes:
    @pytest.mark.parametrize("nombre", list(FABRICAS))
    def test_el_pronostico_tiene_el_largo_pedido_y_nunca_es_negativo_ni_infinito(self, nombre, generador):
        for _ in range(8):
            valores = generador.poisson(generador.uniform(0.2, 9), 120).astype(float)
            valores[generador.random(120) < generador.uniform(0, 0.7)] = 0

            pronostico = ajustar(FABRICAS[nombre], valores).pronosticar(FUTURAS)

            assert pronostico.shape == (8,)
            assert np.all(np.isfinite(pronostico))
            assert np.all(pronostico >= 0)

    @pytest.mark.parametrize("nombre", list(FABRICAS))
    def test_una_serie_de_ceros_no_rompe_ningun_modelo(self, nombre):
        pronostico = ajustar(FABRICAS[nombre], np.zeros(120)).pronosticar(FUTURAS)

        assert pronostico.tolist() == [0.0] * 8

    @pytest.mark.parametrize("nombre", list(FABRICAS))
    def test_el_mismo_dato_produce_el_mismo_pronostico(self, nombre):
        valores = serie_con_tendencia(120)

        primero = ajustar(FABRICAS[nombre], valores).pronosticar(FUTURAS)
        segundo = ajustar(FABRICAS[nombre], valores).pronosticar(FUTURAS)

        assert primero.tolist() == segundo.tolist()

    def test_cada_modelo_tiene_un_nombre_legible_para_la_interfaz(self):
        assert set(modelos.NOMBRE_LEGIBLE) == set(FABRICAS)
        assert set(modelos.SIMPLICIDAD) == set(FABRICAS)


class TestCandidatos:
    def test_la_demanda_intermitente_compite_con_croston_sba_y_tsb(self):
        assert candidatos(es_intermitente=True, semanas_de_historia=80) == [
            modelos.MEDIA_MOVIL, modelos.SUAVIZADO, modelos.CROSTON, modelos.SBA, modelos.TSB,
        ]

    def test_la_demanda_continua_compite_con_holt_y_con_el_estacional_si_hay_anio_y_medio(self):
        assert candidatos(es_intermitente=False, semanas_de_historia=110) == [
            modelos.MEDIA_MOVIL, modelos.INGENUO, modelos.SUAVIZADO, modelos.HOLT, modelos.ESTACIONAL,
        ]

    def test_con_poca_historia_solo_entran_los_modelos_que_pueden_ajustarse(self):
        assert candidatos(es_intermitente=False, semanas_de_historia=10) == [modelos.MEDIA_MOVIL, modelos.INGENUO, modelos.SUAVIZADO]
        assert candidatos(es_intermitente=True, semanas_de_historia=5) == [modelos.MEDIA_MOVIL]
