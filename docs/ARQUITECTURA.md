# Arquitectura y decisiones técnicas

Este documento explica **por qué** el código está organizado así. Los diagramas del proyecto (clases, secuencia, componentes y despliegue, C4 nivel 1 y 2) describen el sistema completo. Aquí solo se documenta lo que existe en este incremento (HU-01).

## Relación con los diagramas

| Diagrama | Qué está implementado (Sprint 1 y mitad del Sprint 2) |
|---|---|
| Clases | `Usuario` con rol, `Repuesto`, `MovimientoInventario`, `Cliente`, `Vehiculo`, `OrdenTrabajo` y `DetalleRepuesto` (composición con la orden) |
| Componentes | Interfaz de usuario → API REST → módulos **Auth**, **Inventario** y **Órdenes** → Base de datos |
| C4 nivel 2 | Contenedores *SPA Web* (`public/`), *API REST* (`src/`) y *Base de datos* (SQLite) |
| Secuencia | El flujo "registrar repuestos y descontar stock" sigue el diagrama: API de órdenes → inventario → base de datos, en una sola transacción |
| Casos de uso | "Gestionar inventario de repuestos" y su `<<include>>` "Descontar stock" desde la orden |

Los contenedores *Servicio de Predicción*, *Tarea Programada (alertas)* y el servicio externo de email/push corresponden al Sprint 3.

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

### ADR-07 · Migraciones versionadas del esquema

- **Contexto:** cada historia agrega tablas. Los integrantes ya tenían una base local con datos del primer incremento, y no se podía pedir que la borraran.
- **Decisión:** el esquema vive en archivos numerados (`src/db/migraciones/001_…sql` a `006_…sql`). La versión aplicada se guarda en `PRAGMA user_version`; al abrir la base solo se ejecutan las migraciones pendientes, cada una dentro de una transacción.
- **Consecuencia:** la migración 004 tuvo que **reconstruir** la tabla de movimientos (SQLite no permite cambiar un `CHECK`), copiando todo el historial. Se probó sobre una base con datos de la versión anterior.

### ADR-08 · Sesiones en base de datos en lugar de JWT

- **Contexto:** el plan de sprints permite "JWT/sesión".
- **Decisión:** al iniciar sesión se entrega un token aleatorio de 32 bytes. En la base solo se guarda su hash SHA-256, con vencimiento de 8 horas (una jornada de taller).
- **Motivo:** con sesiones en base de datos, cerrar sesión invalida el token de inmediato; con JWT habría que mantener una lista de revocados. Además no requiere manejar una clave secreta en el servidor, que es justamente lo que la rúbrica pide no subir al repositorio.
- **Contraseñas:** se guardan con `scrypt` y sal aleatoria. El login responde el mismo mensaje y tarda lo mismo exista o no el usuario, para no revelar qué usuarios existen.

### ADR-09 · Autorización en dos niveles

- **Por rol**, con un middleware en las rutas: por ejemplo, solo dueño y administrador modifican el inventario.
- **Por propiedad**, en el servicio: un mecánico solo ve y trabaja **sus** órdenes, aunque envíe el id o el filtro de otro mecánico.
- El frontend oculta menús y botones según el rol, pero solo por comodidad: la API vuelve a verificar todo.

### ADR-10 · Descuento de stock al registrar repuestos en la orden

- **Decisión:** el stock se descuenta en el momento en que el mecánico registra el repuesto en la orden (HU-04), no al finalizarla.
- **Motivo:** así el inventario refleja de inmediato lo que salió del estante y otro mecánico no puede usar las mismas piezas.
- **Control de concurrencia:** el `UPDATE` incluye la condición `stock_actual >= cantidad`, así dos registros simultáneos nunca dejan el stock negativo.
- **Pendiente para la HU "Actualización del estado":** su criterio menciona descontar al finalizar. Como el stock ya se descuenta al registrar, esa historia solo deberá cambiar el estado, sin volver a descontar.

### ADR-11 · Listado paginado con filtros parametrizados e índices

- La consulta se arma solo con los filtros presentes y **siempre con parámetros**, nunca concatenando valores, para evitar inyección SQL.
- La **placa** se normaliza (`abc-123` → `ABC123`) y se compara con igualdad: devuelve solo coincidencias exactas y usa el índice único de la placa.
- Hay índices compuestos `(estado, id)` y `(mecanico_id, id)`, que permiten filtrar y ordenar sin recorrer la tabla. Una prueba automática lo verifica con `EXPLAIN QUERY PLAN`.
- La búsqueda por **nombre de cliente** es parcial (`LIKE '%texto%'`) y no aprovecha índices. Con el volumen de un taller es suficiente; si creciera, el paso natural sería una búsqueda de texto completo (FTS5).

## Requisitos no funcionales cubiertos

| RNF | Cómo se atiende |
|---|---|
| Facilidad de uso | Una sola pantalla, mensajes de error junto a cada campo y textos en lenguaje del taller |
| Velocidad (< 2 s) | Consultas preparadas, índices para los filtros del listado y paginación (máximo 50 por página) |
| Compatibilidad | Web estándar, sin instalar nada en el taller; diseño responsive para PC y tablet |
| Mantenimiento | Capas y módulos separados, código comentado, migraciones versionadas, 102 pruebas y CI |
| Crecimiento a futuro | Módulos por dominio (`auth`, `inventario`, `ordenes`); los siguientes serán `alertas` y `prediccion` |
| Seguridad | Login con contraseñas cifradas, sesiones con vencimiento, permisos por rol y por propiedad en la API, consultas parametrizadas y ningún secreto en el repositorio |
