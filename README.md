# Inventario de repuestos para talleres mecánicos

[![CI](https://github.com/USUARIO/REPOSITORIO/actions/workflows/ci.yml/badge.svg)](https://github.com/USUARIO/REPOSITORIO/actions/workflows/ci.yml)
   ## Roles del equipo en este incremento
   - **Matías Piedrahita:** implementación de la HU-01 (base de datos, API e interfaz).
   - **Luis Carlos Moreno:** pipeline de CI, pruebas automatizadas, documentación y revisión del pull request.
> ⚠️ **Advertencia: este proyecto se desarrolló con apoyo de inteligencia artificial.**
> Usamos **Claude (Anthropic)** como asistente durante el desarrollo. El detalle de qué se hizo con IA y qué hizo el equipo está en la sección [Declaración de uso de IA](#declaración-de-uso-de-inteligencia-artificial).

Proyecto de semestre de **Ingeniería de Software (UPB, 2026-2)**. Es una aplicación web para que los talleres mecánicos pequeños y medianos dejen de llevar el inventario en cuadernos, hojas de Excel sueltas o mensajes de WhatsApp. Este repositorio contiene el primer incremento funcional (MVP) del sistema: **la gestión del inventario de repuestos**.

**Equipo:** Matías Piedrahita · Luis Carlos Moreno

---

## Historia de usuario implementada

| | |
|---|---|
| **ID** | HU-01 (prioridad MoSCoW: **Must**) |
| **Historia** | *Como* dueño del taller, *quiero* gestionar el inventario de repuestos, *para* controlar el stock. |
| **Criterio de aceptación** | CRUD completo de repuestos (SKU, costo, stock, ubicación) y carga masiva por CSV. El sistema **no permite stock negativo ni campos obligatorios vacíos** al guardar. |

### Criterio en formato Dado / Cuando / Entonces

Este criterio de la Entrega 1 se convirtió casi literalmente en la prueba [`tests/aceptacion/HU01.criterio-aceptacion.test.js`](tests/aceptacion/HU01.criterio-aceptacion.test.js):

- **Dado** un inventario vacío, **cuando** el dueño intenta guardar un repuesto con stock negativo, **entonces** el sistema lo rechaza y el inventario sigue vacío.
- **Dado** un inventario vacío, **cuando** intenta guardar un repuesto sin SKU ni nombre, **entonces** el sistema indica cada campo obligatorio que falta y no guarda nada.
- **Dado** un repuesto con 10 unidades, **cuando** intenta editarlo dejando el stock en -1, **entonces** se rechaza el cambio y el stock sigue en 10.

### Qué puede hacer el usuario

- Registrar, consultar, editar y dar de baja repuestos. La baja es lógica: el repuesto sale del catálogo, pero su historial se conserva.
- Buscar por SKU, nombre o proveedor, y filtrar los repuestos que están en el mínimo o por debajo de él.
- Ver el nivel de stock de cada repuesto en una barra con la marca del mínimo.
- Importar repuestos de forma masiva desde un CSV. Si una sola fila tiene un error, no se carga ninguna y se indica el error de cada fila.
- Consultar el historial de movimientos de cada repuesto (alta, ajustes, baja, carga por CSV). Ese historial será la base del módulo de predicción de demanda.

---

## Cómo levantar el proyecto desde cero

### 1. Requisitos

| Herramienta | Versión | Cómo verificar |
|---|---|---|
| [Node.js](https://nodejs.org/) | **22.13 o superior** (LTS) | `node -v` |
| npm | viene con Node | `npm -v` |
| Git | cualquiera reciente | `git --version` |

No hace falta instalar ninguna base de datos. El proyecto usa SQLite a través del módulo `node:sqlite` que ya trae Node.js, así que no hay que compilar nada ni instalar un motor aparte.

### 2. Clonar e instalar

```bash
git clone https://github.com/USUARIO/REPOSITORIO.git
cd REPOSITORIO
npm ci
```

> `npm ci` instala exactamente las versiones que están en `package-lock.json`, igual que el pipeline.

### 3. (Opcional) Cargar datos de ejemplo

```bash
npm run seed
```

Carga los 6 repuestos de [`ejemplos/repuestos-ejemplo.csv`](ejemplos/repuestos-ejemplo.csv). Puede ejecutarse varias veces sin duplicar datos.

### 4. Ejecutar

```bash
npm start
```

Abra **http://localhost:3000** en el navegador. La base de datos se crea automáticamente en `data/inventario.db`.

Si quiere cambiar el puerto o la ruta de la base, copie `.env.example` como `.env` y ajuste los valores. El archivo `.env` nunca se sube al repositorio.

### 5. Probar la carga masiva

En la interfaz, pulse **Importar CSV** y elija [`ejemplos/repuestos-ejemplo.csv`](ejemplos/repuestos-ejemplo.csv). Se aceptan archivos separados por `;` (así exporta Excel en español) o por `,`. Las columnas son:

```
sku;nombre;costo;stock_actual;stock_minimo;proveedor;ubicacion
```

`sku`, `nombre`, `costo` y `stock_actual` son obligatorias. `stock_minimo` vale 0 por defecto.

---

## Cómo correr las pruebas

Todas las pruebas corren con **un solo comando**:

```bash
npm test
```

Para ver además el reporte de cobertura:

```bash
npm run test:cobertura
```

| Suite | Tipo | Qué verifica |
|---|---|---|
| `tests/aceptacion/HU01.criterio-aceptacion.test.js` | Aceptación | Los 3 escenarios Dado/Cuando/Entonces del criterio de la HU-01 |
| `tests/integration/repuestos.api.test.js` | Integración | La API completa (HTTP, lógica y base de datos en memoria): CRUD, SKU único, filtros, historial, CSV "todo o nada", errores 400/404/409 |
| `tests/unit/repuesto.validator.test.js` | Unitaria | Reglas de validación: obligatorios, negativos, enteros, límites, normalización |
| `tests/unit/csv.test.js` | Unitaria | Lectura de CSV con `;` o `,`, comillas, BOM de Excel y filas vacías |

Resultado actual: **28 pruebas, 4 suites, todas en verde** (cobertura de líneas ≈ 95 %).

Cada prueba crea su propia base de datos en memoria, así que las pruebas no dependen unas de otras ni de los datos locales.

---

## Pipeline de integración continua

Archivo: [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Se ejecuta en **cada push y cada pull request**, con dos jobs en paralelo:

| Job | Pasos |
|---|---|
| **Build y pruebas** | `npm ci` → `npm run build` (verifica la sintaxis de todos los archivos y que la app se construya) → `npm run test:cobertura` → publica el reporte de cobertura como artefacto |
| **Análisis de vulnerabilidades** | `npm ci` → `npm audit --audit-level=high` (falla si alguna dependencia tiene vulnerabilidades altas o críticas) |

La versión de Node queda fijada en 22 dentro del workflow, para evitar el problema de "en mi máquina sí pasa".

**Estado:** ver el badge al inicio de este README o la pestaña **Actions** del repositorio.

---

## Arquitectura

La aplicación sigue una arquitectura **por capas**, la misma de los diagramas de componentes y del C4 nivel 2 del proyecto. Cada capa solo conoce a la capa de abajo:

```
Navegador (public/)            HTML + CSS + JavaScript, consume la API REST
        │  HTTP / JSON
        ▼
Rutas (repuesto.routes.js)     Traduce HTTP ↔ servicio. Sin reglas de negocio
        ▼
Servicio (repuesto.service.js) Reglas: SKU único, historial, transacciones, CSV todo-o-nada
        │       └─ Validador (repuesto.validator.js): función pura, criterio de aceptación
        ▼
Repositorio (repuesto.repository.js)  Único archivo con SQL
        ▼
SQLite (schema.sql)            Tablas repuestos y movimientos_inventario
```

```
.
├── .github/
│   ├── workflows/ci.yml            Pipeline de CI
│   └── pull_request_template.md
├── docs/
│   ├── ARQUITECTURA.md             Decisiones técnicas y su justificación
│   └── GUIA_TALLER.md              Roles, flujo de ramas/commits y checklist del taller
├── ejemplos/repuestos-ejemplo.csv
├── public/                         Interfaz web
├── scripts/
│   ├── build.js                    Paso de build del pipeline
│   └── seed.js                     Datos de ejemplo
├── src/
│   ├── app.js                      Construye la app (recibe la BD por parámetro)
│   ├── server.js                   Punto de entrada
│   ├── db/                         Conexión y esquema
│   ├── modules/inventario/         Validador, CSV, repositorio, servicio y rutas
│   └── shared/                     Errores de dominio y manejador de errores
└── tests/
    ├── aceptacion/
    ├── integration/
    └── unit/
```

Las decisiones de diseño (por qué SQLite en esta etapa, por qué bajas lógicas, por qué inyección de la base de datos, etc.) están en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

### API REST

| Método | Ruta | Descripción | Respuestas |
|---|---|---|---|
| GET | `/api/salud` | Verifica que el servidor esté arriba | 200 |
| GET | `/api/repuestos?q=&bajoStock=true` | Lista los repuestos activos, con búsqueda y filtro opcionales | 200 |
| GET | `/api/repuestos/:id` | Consulta un repuesto | 200, 404 |
| POST | `/api/repuestos` | Crea un repuesto | 201, 400, 409 |
| PUT | `/api/repuestos/:id` | Edita un repuesto (registra un AJUSTE si cambia el stock) | 200, 400, 404, 409 |
| DELETE | `/api/repuestos/:id` | Da de baja el repuesto (baja lógica) | 204, 404 |
| GET | `/api/repuestos/:id/movimientos` | Historial del repuesto | 200, 404 |
| POST | `/api/repuestos/importar` | Carga masiva (`Content-Type: text/csv`) | 201, 400 |

Todos los errores tienen la misma forma:

```json
{
  "error": "VALIDACION",
  "mensaje": "Los datos enviados no son válidos",
  "detalles": [{ "campo": "stockActual", "mensaje": "El stock actual no puede ser negativo" }]
}
```

---

## Flujo de trabajo del equipo

- `main` siempre debe estar en verde. Nadie hace push directo a `main`.
- **Una rama por historia:** `feature/HU-01-gestion-inventario`. La configuración del pipeline va en `ci/pipeline-inicial`.
- Todo cambio entra a `main` por **pull request**, que debe tener el CI en verde y la aprobación del otro integrante.
- Los commits son pequeños y descriptivos (`feat:`, `test:`, `ci:`, `docs:`, `fix:`).

El paso a paso del taller está en [`docs/GUIA_TALLER.md`](docs/GUIA_TALLER.md).

---

## Fuera del alcance de este incremento

Estas funciones se trabajarán en las siguientes historias del backlog:

- Alertas automáticas de stock bajo por email o push (HU Must). Por ahora la interfaz ya resalta lo que está en el mínimo.
- Órdenes de trabajo y descuento automático de stock (HU Must).
- Autenticación y permisos por rol (requisito no funcional de seguridad).
- Predicción de demanda (HU Should).

---

## Declaración de uso de inteligencia artificial

> ⚠️ **Este proyecto usó apoyo de IA.** Lo declaramos como lo exige el curso.

**Herramienta:** Claude, asistente de IA de Anthropic, usado desde claude.ai.

**Para qué la usamos:**

- Proponer la arquitectura por capas y la estructura de carpetas a partir de nuestros diagramas (clases, componentes, C4).
- Generar el código base de la HU-01: validador, lector de CSV, repositorio, servicio, rutas e interfaz web.
- Escribir las pruebas automatizadas, incluida la traducción del criterio de aceptación a escenarios Dado/Cuando/Entonces.
- Configurar el workflow de GitHub Actions y el análisis de vulnerabilidades.
- Redactar este README y la documentación en `docs/`.

**Qué hizo el equipo:**

- Definir el problema, las historias de usuario, la priorización MoSCoW y los criterios de aceptación (Entrega 1).
- Revisar, ejecutar y entender todo el código generado antes de subirlo, y ajustarlo donde fue necesario.
- Organizar el trabajo en ramas, commits y pull requests, y revisar el código del compañero.

**Responsabilidad:** el equipo entiende el código entregado, puede explicarlo y es responsable de su contenido. La IA se usó como apoyo y no reemplazó nuestro criterio ni nuestra revisión.

---

## Licencia

[MIT](LICENSE)
