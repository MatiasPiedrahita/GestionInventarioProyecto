# Modelo de predicción de demanda (`taller_prediccion`)

Paquete de Python que pronostica cuántas unidades de cada repuesto va a consumir el taller y lo convierte en decisiones de inventario: cuánto pedir, cuándo, y en qué fecha se agotaría lo que hay.

Es una **función pura**: recibe un JSON por la entrada estándar y devuelve otro por la salida estándar. No abre la base de datos ni la red. La aplicación web (Node.js) le entrega el consumo y guarda los resultados (ver ADR-19 en [`docs/ARQUITECTURA.md`](../docs/ARQUITECTURA.md)).

## Requisitos e instalación

Python 3.11 o superior. Desde la raíz del proyecto:

```bash
npm run prediccion:instalar            # crea .venv e instala numpy, pandas y statsmodels
npm run prediccion:instalar -- --dev   # además instala pytest
npm run test:python                    # 198 pruebas
```

A mano, sin npm:

```bash
python -m venv .venv
.venv\Scripts\activate                 # en Linux o macOS: source .venv/bin/activate
pip install -r prediccion/requirements-dev.txt
cd prediccion
python -m pytest
```

## Uso desde la consola

```bash
cd prediccion
python -m taller_prediccion < entrada.json > salida.json
python -m taller_prediccion --entrada entrada.json --salida salida.json --indentado
python -m taller_prediccion --version
```

| Código de salida | Significado |
|---|---|
| 0 | Todo bien: la salida es el resultado |
| 2 | La entrada no cumple el contrato: la salida es `{"error": {"codigo": "ENTRADA_INVALIDA", "mensaje": "..."}}` |
| 1 | Error inesperado: la salida es `{"error": {...}}` y el detalle va por `stderr` |

## Uso desde un cuaderno de Jupyter

```python
import json, pandas as pd
from taller_prediccion.motor import predecir

resultado = predecir(json.load(open("entrada.json", encoding="utf-8")))
tabla = pd.json_normalize(resultado["repuestos"])
tabla[["sku", "patron", "modelo", "metricas.rmsse", "metricas.mejoraSobreIngenuo", "cantidadSugerida"]]
```

Cada módulo se puede usar por separado (`series`, `patrones`, `modelos`, `evaluacion`, `inventario`, `abc`).

## Contrato

### Entrada

```json
{
  "version": 1,
  "fechaDeCorte": "2026-10-12",
  "horizonteSemanas": 8,
  "nivelDeServicio": 0.95,
  "repuestos": [
    {
      "id": 1, "sku": "FIL-ACE-001",
      "stockActual": 14, "stockMinimo": 5, "costo": 28500, "diasDeReposicion": 7,
      "primeraSemana": "2024-03-25",
      "consumo": [ { "semana": "2026-09-28", "unidades": 6 }, { "semana": "2026-10-05", "unidades": 9 } ]
    }
  ]
}
```

- `consumo` trae **solo las semanas con consumo**, ya neto de devoluciones. El modelo rellena con cero las demás.
- `fechaDeCorte` es "hoy". La semana a la que pertenece se excluye porque está incompleta.
- `primeraSemana` (opcional) es cuándo entró el repuesto al catálogo: las semanas sin consumo desde entonces también cuentan.
- `horizonteSemanas`: 1 a 26. `nivelDeServicio`: 0,5 a 0,999.

### Salida (por repuesto)

| Campo | Qué es |
|---|---|
| `patron`, `adi`, `cv2` | Tipo de demanda: `SUAVE`, `ERRATICA`, `INTERMITENTE`, `IRREGULAR` o `SIN_CONSUMO` |
| `modelo`, `modeloNombre` | Modelo ganador |
| `metricas.rmsse` | Error del modelo frente al de repetir la semana anterior (menos es mejor) |
| `metricas.mejoraSobreIngenuo` | Fracción de error que ahorra frente a repetir la última semana, en las mismas semanas de prueba |
| `metricas.wape`, `metricas.sesgo` | Error por unidad consumida; sesgo positivo = se queda corto |
| `comparados` | El resultado de cada modelo candidato |
| `pronostico[]` | Por semana: `unidades`, `inferior`, `superior` (intervalo del 80 %) |
| `stockDeSeguridad`, `puntoDeReorden` | Política de inventario sugerida |
| `cantidadSugerida`, `debePedir` | Cuánto pedir, y si ya toca |
| `diasDeCobertura`, `fechaDeQuiebre` | Cuánto dura el stock actual |
| `quiebreAntesDeReponer` | Se agotaría antes de que alcance a llegar un pedido hecho hoy |
| `tendencia`, `variacionTrimestral` | Último trimestre frente al anterior |
| `claseAbc`, `valorConsumoAnual` | Clasificación por valor consumido en el último año |
| `historia.semanasSinConsumo` | Semanas desde la última vez que se usó |
| `aviso` | Advertencia en lenguaje claro (historia corta, modelo que no supera al ingenuo) |

Además, `resumen` (totales del catálogo) y `motor` (versión del paquete, de Python y de las librerías, para saber con qué se calculó).

## Cómo decide

```
consumo semanal ─► serie continua ─► patrón de demanda ─► modelos candidatos
                                                                 │
                              pronóstico + intervalo ◄── el mejor en la prueba con origen móvil
                                       │
                      política de inventario (reorden, colchón, cantidad, fecha de quiebre)
```

1. **Serie** (`series.py`): semanas sin consumo en cero; se excluye la semana en curso.
2. **Patrón** (`patrones.py`): clasificación de Syntetos y Boylan con ADI y CV².
3. **Candidatos** (`modelos.py`):

   | Modelo | Para qué | Necesita |
   |---|---|---|
   | Media móvil de 8 semanas | Referencia | — |
   | Última semana (ingenuo) | Referencia | — |
   | Suavizado exponencial simple (statsmodels) | Nivel que cambia despacio | 6 semanas |
   | Holt con tendencia amortiguada (statsmodels) | Demanda que crece o baja | 16 semanas |
   | Estacional mensual | Temporadas (viajes, lluvias) | 52 semanas para ajustarse; 104 para competir |
   | Croston, SBA, TSB | Demanda intermitente; TSB detecta obsolescencia | 8 semanas |

4. **Evaluación** (`evaluacion.py`): origen móvil, hasta 13 orígenes de 4 semanas (un año de prueba). Todos los modelos se prueban en las mismas semanas. Gana el menor RMSSE; en un empate, el más simple.
5. **Política** (`inventario.py`): punto de reorden = demanda durante la reposición + stock de seguridad (`z · σ · √semanas`). Se calcula con el pronóstico ya redondeado (el que se publica) y respeta el día de la semana del corte: un jueves, a la semana en curso le quedan cuatro días. Si hay que pedir, la cantidad nunca es cero.
6. **ABC** (`abc.py`): 80 % / 15 % / 5 % del valor consumido.

### El modelo estacional

El perfil de cada mes (cuánto se consume frente a lo normal) se calcula en tres pasos:

1. **Sin tendencia.** Cada semana se divide entre la recta que mejor describe la serie. En un repuesto que crece, los meses que más pesan al final de la historia parecerían temporada alta si no se hiciera.
2. **Perfil crudo:** el promedio de esas razones en las semanas del mes (al menos cuatro semanas, y al menos seis meses vistos).
3. **Encogimiento según la señal** (Bayes empírico): `confianza = señal / (señal + ruido)`, donde el ruido es lo que se mueve el promedio de un mes solo por azar y la señal es lo que varían los meses más allá de eso. Con temporadas claras el perfil casi no se toca; si las diferencias caben en el ruido, queda en 1 y el modelo equivale a un suavizado simple.

Se ajusta con un año de historia. Como la evaluación reserva otro año para probarlo (y exige que todos los modelos se prueben en las mismas semanas), **compite cuando el repuesto tiene dos años de consumo**.

### La política se repite en la aplicación

Lo que este paquete entrega es, sobre todo, el **pronóstico**. Las decisiones (`puntoDeReorden`, `cantidadSugerida`, `debePedir`, `diasDeCobertura`, `fechaDeQuiebre`, `quiebreAntesDeReponer`) dependen del stock, que cambia a cada rato. La aplicación las recalcula cada vez que las muestra, con el stock y la fecha de ese momento, a partir de `pronostico` y `stockDeSeguridad` (`src/modules/prediccion/politica.js`).

Es la misma fórmula de `inventario.py`, con las operaciones en el mismo orden. La prueba de contrato (`tests/integration/prediccion.python.test.js`) ejecuta este paquete y exige que las dos versiones den exactamente lo mismo. **Si cambia una, hay que cambiar la otra.**

### Cómo se midió el modelo

Además de la prueba con origen móvil sobre los datos de cada repuesto, el modelo se midió contra **verdad conocida**: historias simuladas con los perfiles del historial de demostración (tendencia, temporadas, baja rotación), donde se sabe cuál es la demanda esperada. Error del total pronosticado, promedio de los repuestos con demanda (12 historias por perfil):

| Historia | Horizonte | Antes | Ahora |
|---|---|---|---|
| 132 semanas | 5 semanas | 19,5 % | 18,5 % |
| 132 semanas | 13 semanas | 19,7 % | 18,4 % |
| 104 semanas | 5 semanas | 22,6 % | 19,9 % |
| 104 semanas | 13 semanas | 23,5 % | 20,2 % |

La mejora se concentra en los repuestos de temporada: las plumillas, con 104 semanas de historia, pasaron de un error del 48 % al 19 % a cinco semanas. Los repuestos de muy baja rotación (una batería cada seis semanas) siguen con errores cercanos al 40 %: con tan pocos eventos, ningún modelo puede hacerlo mucho mejor.

También se probó agregar el método Theta para seguir tendencias: cambió el error medio en menos de medio punto y no se incluyó.

### Por qué RMSSE y no MASE o MAPE

Muchos repuestos pasan semanas sin usarse. Con error absoluto (MASE), el mejor pronóstico para una serie con más ceros que consumos es siempre cero, porque el error absoluto lo minimiza la **mediana**. El taller se quedaría sin la pieza justo el día que la piden. El error cuadrático lo minimiza el **promedio**, que es lo que necesita el inventario. El MAPE ni siquiera se puede calcular cuando el consumo real es cero. Es la misma razón por la que la competencia M5 usó RMSSE.

## Límites conocidos

- El intervalo tiene el mismo ancho en todo el horizonte; en la realidad la incertidumbre crece con el tiempo.
- No usa variables externas (festivos, precios, clima). La estacionalidad se aprende solo del calendario.
- Cada repuesto se modela por separado: no aprovecha que dos repuestos se suelen usar juntos.
- Con menos de 8 semanas de historia usa el promedio; con menos de 12 no puede probar el modelo; con menos de dos años no reconoce temporadas.
- La tendencia solo se sigue a corto plazo (el nivel se actualiza cada semana): a seis meses, un repuesto que crece queda algo por debajo.
- El tiempo de cálculo crece con el catálogo: unos 0,2 s por repuesto de demanda continua.
