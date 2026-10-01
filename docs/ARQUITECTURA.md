# Arquitectura y decisiones técnicas

Este documento explica **por qué** el código está organizado así. Los diagramas del proyecto (clases, secuencia, componentes y despliegue, C4 nivel 1 y 2) describen el sistema completo. Aquí solo se documenta lo que existe en este incremento (HU-01).

## Relación con los diagramas

| Diagrama | Qué se implementó en este incremento |
|---|---|
| Clases | `Repuesto` (sku, nombre, costo, stockActual, stockMinimo, proveedor, ubicacion) y `MovimientoInventario` (tipo, cantidad, fecha, stock resultante) |
| Componentes | Interfaz de usuario → API REST → **Módulo Inventario** → Base de datos |
| C4 nivel 2 | Contenedores *SPA Web* (`public/`), *API REST* (`src/`) y *Base de datos* (SQLite) |
| Casos de uso | "Gestionar inventario de repuestos" con sus `<<include>>`: registrar, consultar, editar/eliminar |

Los contenedores *Servicio de Predicción*, *Tarea Programada (alertas)* y el servicio externo de email/push quedan para historias posteriores.

## Decisiones (ADR resumidos)

### ADR-01 · Node.js 22 + Express 5

- **Contexto:** se necesita una API REST sencilla y un stack que ambos integrantes puedan correr en Windows o macOS sin configuraciones especiales.
- **Decisión:** Node.js 22 LTS con Express 5. Express 5 maneja los errores de las rutas automáticamente, así que no hace falta envolver cada ruta en `try/catch`.
- **Consecuencia:** el mismo lenguaje (JavaScript) en el frontend y el backend. El módulo de predicción será un servicio aparte en Python, como indica el diagrama de despliegue.

### ADR-02 · SQLite integrado (`node:sqlite`) en este incremento, PostgreSQL más adelante

- **Contexto:** el diagrama de despliegue plantea PostgreSQL. Pero exigir un servidor PostgreSQL desde el primer día complica que "alguien ajeno al equipo levante el proyecto siguiendo solo el README", y también complica el pipeline.
- **Alternativa descartada:** la librería `better-sqlite3`. Al probarla, intenta compilar código nativo durante la instalación, y eso falla en equipos Windows sin Visual Studio Build Tools.
- **Decisión:** usar el SQLite que trae Node.js (`node:sqlite`). No hay dependencias nativas y `npm ci` funciona igual en cualquier máquina y en GitHub Actions.
- **Consecuencia:** todo el SQL vive en un solo archivo (`repuesto.repository.js`). Migrar a PostgreSQL implica cambiar ese archivo y `db/connection.js`, sin tocar el servicio, las rutas ni las pruebas de la API.

### ADR-03 · Arquitectura por capas con inyección de dependencias

- Cada capa recibe la de abajo por parámetro: `crearApp({ db })`, `crearServicioInventario(repositorio)`, etc.
- **Beneficio directo para las pruebas:** cada prueba crea su propia base de datos en memoria (`:memory:`). Las pruebas son rápidas, aisladas y no dejan basura.
- El validador es una **función pura** (no toca la base de datos ni HTTP), así que las reglas del criterio de aceptación se prueban de forma unitaria.

### ADR-04 · Bajas lógicas e historial de movimientos

- "Dar de baja" marca `activo = 0`. No borra la fila.
- Cada alta, ajuste de stock, baja o carga por CSV queda registrada en `movimientos_inventario`.
- **Motivo:** la predicción de demanda (HU Should) necesita el historial de consumo. Si se borraran los repuestos, se perdería la materia prima del modelo.

### ADR-05 · Carga CSV "todo o nada"

- Si una fila del CSV es inválida, no se guarda ninguna, y se devuelve el error de **cada** fila con su número.
- **Motivo:** una carga parcial deja el inventario en un estado incierto ("¿qué se cargó y qué no?"). Es mejor corregir el archivo y volver a cargarlo completo.
- Se aceptan `;` o `,` como separador, porque Excel en español exporta con `;`.

### ADR-06 · Defensa en profundidad para la regla de stock no negativo

- La regla se valida en la capa de lógica (`repuesto.validator.js`) con mensajes claros para el usuario.
- Además, la base de datos tiene restricciones `CHECK (stock_actual >= 0)`, así que ningún camino puede dejar stock negativo, aunque se salte el servicio.

## Requisitos no funcionales cubiertos en este incremento

| RNF | Cómo se atiende |
|---|---|
| Facilidad de uso | Una sola pantalla, mensajes de error junto a cada campo y textos en lenguaje del taller |
| Velocidad (< 2 s) | Consultas preparadas, índice sobre el historial y base local |
| Compatibilidad | Web estándar, sin instalar nada en el taller; diseño responsive para PC y tablet |
| Mantenimiento | Capas separadas, código comentado, 28 pruebas y CI |
| Crecimiento a futuro | Módulos por dominio (`modules/inventario`); los siguientes serán `ordenes`, `alertas` y `prediccion` |
| Seguridad | **Pendiente:** autenticación y permisos por rol en una próxima historia |
