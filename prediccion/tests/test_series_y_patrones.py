from datetime import date

import numpy as np
import pytest

from taller_prediccion import patrones
from taller_prediccion.series import SEMANAS_MAXIMAS, construir_serie, lunes_de, semanas_siguientes

from conftest import CORTE, a_consumo, serie_intermitente


class TestLunesDe:
    @pytest.mark.parametrize(
        "fecha, lunes",
        [
            (date(2026, 10, 12), date(2026, 10, 12)),  # lunes
            (date(2026, 10, 14), date(2026, 10, 12)),  # miércoles
            (date(2026, 10, 18), date(2026, 10, 12)),  # domingo
            (date(2026, 1, 1), date(2025, 12, 29)),  # la semana empezó el año anterior
        ],
    )
    def test_devuelve_el_lunes_de_la_semana(self, fecha, lunes):
        assert lunes_de(fecha) == lunes

    def test_semanas_siguientes_avanza_de_siete_en_siete_dias(self):
        assert semanas_siguientes(date(2026, 12, 21), 3) == [date(2026, 12, 21), date(2026, 12, 28), date(2027, 1, 4)]


class TestConstruirSerie:
    def test_rellena_con_cero_las_semanas_sin_consumo(self):
        consumo = [{"semana": date(2026, 9, 14), "unidades": 3}, {"semana": date(2026, 10, 5), "unidades": 2}]

        semanas, valores = construir_serie(consumo, CORTE)

        assert semanas == [date(2026, 9, 14), date(2026, 9, 21), date(2026, 9, 28), date(2026, 10, 5)]
        assert valores.tolist() == [3.0, 0.0, 0.0, 2.0]

    def test_excluye_la_semana_del_corte_porque_esta_incompleta(self):
        consumo = [{"semana": date(2026, 10, 5), "unidades": 4}, {"semana": date(2026, 10, 12), "unidades": 99}]

        semanas, valores = construir_serie(consumo, date(2026, 10, 14))

        assert semanas == [date(2026, 10, 5)]
        assert valores.tolist() == [4.0]

    def test_empieza_cuando_el_repuesto_entro_al_catalogo_aunque_no_se_usara_al_principio(self):
        consumo = [{"semana": date(2026, 10, 5), "unidades": 1}]

        semanas, valores = construir_serie(consumo, CORTE, primera_semana=date(2026, 9, 16))

        assert semanas[0] == date(2026, 9, 14)
        assert valores.tolist() == [0.0, 0.0, 0.0, 1.0]

    def test_suma_registros_de_la_misma_semana_aunque_no_vengan_en_lunes(self):
        consumo = [{"semana": date(2026, 10, 5), "unidades": 2}, {"semana": date(2026, 10, 8), "unidades": 3}]

        _, valores = construir_serie(consumo, CORTE)

        assert valores.tolist() == [5.0]

    def test_un_consumo_neto_negativo_por_devoluciones_cuenta_como_cero(self):
        consumo = [{"semana": date(2026, 9, 28), "unidades": -2}, {"semana": date(2026, 10, 5), "unidades": 4}]

        _, valores = construir_serie(consumo, CORTE)

        assert valores.tolist() == [0.0, 4.0]

    def test_sin_consumo_ni_fecha_de_alta_devuelve_una_serie_vacia(self):
        semanas, valores = construir_serie([], CORTE)

        assert semanas == [] and len(valores) == 0

    def test_un_repuesto_sin_consumo_pero_con_fecha_de_alta_es_una_serie_de_ceros(self):
        _, valores = construir_serie([], CORTE, primera_semana=date(2026, 9, 14))

        assert valores.tolist() == [0.0, 0.0, 0.0, 0.0]

    def test_no_mira_mas_de_tres_anios_hacia_atras(self):
        consumo = [{"semana": date(2020, 1, 6), "unidades": 5}, {"semana": date(2026, 10, 5), "unidades": 1}]

        semanas, valores = construir_serie(consumo, CORTE)

        assert len(semanas) == SEMANAS_MAXIMAS
        assert valores.sum() == 1.0


class TestClasificarPatron:
    def test_demanda_todas_las_semanas_y_parecida_es_suave(self):
        patron = patrones.clasificar(np.array([5, 6, 5, 4, 6, 5, 5, 6], dtype=float))

        assert patron.nombre == patrones.SUAVE
        assert patron.adi == 1.0
        assert patron.cv2 < patrones.CORTE_CV2
        assert not patron.es_intermitente

    def test_demanda_todas_las_semanas_pero_muy_variable_es_erratica(self):
        patron = patrones.clasificar(np.array([1, 20, 2, 30, 1, 25, 3, 40], dtype=float))

        assert patron.nombre == patrones.ERRATICA
        assert patron.cv2 >= patrones.CORTE_CV2

    def test_demanda_esporadica_de_tamano_parecido_es_intermitente(self):
        patron = patrones.clasificar(serie_intermitente(cada=4))

        assert patron.nombre == patrones.INTERMITENTE
        assert patron.adi == 4.0
        assert patron.cv2 == 0.0
        assert patron.es_intermitente

    def test_demanda_esporadica_y_de_tamano_muy_variable_es_irregular(self):
        valores = np.zeros(40)
        valores[::4] = [1, 30, 2, 25, 1, 40, 3, 20, 1, 35]

        assert patrones.clasificar(valores).nombre == patrones.IRREGULAR

    def test_sin_ningun_consumo_no_hay_patron(self):
        patron = patrones.clasificar(np.zeros(20))

        assert patron.nombre == patrones.SIN_CONSUMO
        assert patron.adi is None and patron.cv2 is None

    def test_el_corte_del_adi_esta_en_1_32(self):
        # 33 semanas con 25 demandas: ADI = 1,32 → ya es intermitente.
        valores = np.zeros(33)
        valores[:25] = 2

        assert patrones.clasificar(valores).nombre == patrones.INTERMITENTE
        assert patrones.clasificar(np.append(valores[:-1], 2)).nombre == patrones.SUAVE

    def test_cada_patron_tiene_su_descripcion_en_lenguaje_del_taller(self):
        assert set(patrones.DESCRIPCION) == {patrones.SUAVE, patrones.ERRATICA, patrones.INTERMITENTE, patrones.IRREGULAR, patrones.SIN_CONSUMO}


def test_a_consumo_solo_incluye_semanas_con_consumo():
    assert len(a_consumo([0, 3, 0, 2])) == 2
