# Arquitectura y decisiones técnicas

Este documento explica **por qué** el código está organizado así. Los diagramas del proyecto (clases, secuencia, componentes y despliegue, C4 nivel 1 y 2) describen el sistema completo. Aquí solo se documenta lo que existe en el código.

## Relación con los diagramas

| Diagrama | Qué está implementado (Sprints 1 y 2) |
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
- **Decisión:** el esquema vive en archivos numerados (`src/db/migraciones/001_…sql` en adelante). La versión aplicada se guarda en `PRAGMA user_version`; al abrir la base solo se ejecutan las migraciones pendientes, cada una dentro de una transacción.
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
- **Efecto en la HU-07:** su criterio menciona descontar al finalizar. Como el stock ya se descuenta al registrar, finalizar solo cambia el estado (ver ADR-12).

### ADR-11 · Listado paginado con filtros parametrizados e índices

- La consulta se arma solo con los filtros presentes y **siempre con parámetros**, nunca concatenando valores, para evitar inyección SQL.
- La **placa** se normaliza (`abc-123` → `ABC123`) y se compara con igualdad: devuelve solo coincidencias exactas y usa el índice único de la placa.
- Hay índices compuestos `(estado, id)` y `(mecanico_id, id)`, que permiten filtrar y ordenar sin recorrer la tabla. Una prueba automática lo verifica con `EXPLAIN QUERY PLAN`.
- La búsqueda por **nombre de cliente** es parcial (`LIKE '%texto%'`) y no aprovecha índices. Con el volumen de un taller es suficiente; si creciera, el paso natural sería una búsqueda de texto completo (FTS5).

### ADR-12 · Cambio de estado: finalizar no descuenta, cancelar devuelve

- **Contexto:** el criterio de la HU-07 dice "descontar el stock al finalizar la orden". Eso choca con el ADR-10: el stock ya salió cuando el mecánico registró el repuesto. Descontar otra vez al finalizar duplicaría el consumo.
- **Decisión:** finalizar **solo cambia el estado**. La prueba de aceptación traduce el criterio así: una orden con 2 filtros consumidos, al finalizarla, deja en la base exactamente 2 unidades descontadas.
- **Cancelar devuelve los repuestos:** si la reparación no se hizo, las piezas vuelven al estante. Se registra un movimiento `DEVOLUCION` por repuesto y el detalle queda marcado como devuelto (no se borra). Si la pieza ya se instaló, quien cancela desmarca la devolución (`devolverRepuestos: false`).
- **Por qué importa para el Sprint 3:** el modelo de predicción calcula la demanda como `USO_EN_ORDEN − DEVOLUCION`. Sin la devolución, una orden cancelada contaría como consumo real.
- **Transiciones permitidas:** `En proceso → Finalizada | Cancelada`, y `Finalizada | Cancelada → En proceso` (reabrir). Reabrir es solo para dueño y administrador, y exige motivo, igual que cancelar. Las reglas viven en una función pura (`estados.js`) con sus pruebas unitarias.
- **Historial:** cada cambio queda en `historial_estados_orden` (quién, cuándo, motivo). Las órdenes que ya existían recibieron su historial en la migración 007.
- **Concurrencia:** el `UPDATE` del estado incluye el estado que se leyó (`WHERE estado = @estadoActual`). Si dos personas cambian la misma orden a la vez, la segunda recibe un 409 y no se devuelve stock dos veces.

### ADR-13 · Pruebas de interfaz con jsdom contra la API real

- **Contexto:** la interfaz no tenía pruebas automatizadas; un error en el tablero solo se veía probando a mano.
- **Decisión:** `tests/helpers/navegador.js` carga `public/index.html` y sus scripts en jsdom y dirige cada `fetch` a la aplicación Express de la prueba (con Supertest). Así una prueba hace clic en "Finalizar" y verifica el resultado en la pantalla **y** en la base de datos.
- **Alternativa descartada:** un navegador real (Playwright). Es más fiel, pero descarga navegadores en cada ejecución del pipeline y hace las pruebas lentas para lo que se quiere comprobar.
- **Límite conocido:** jsdom no dibuja ni aplica CSS; no detecta problemas visuales. Se fijó en la versión 26 porque las posteriores usan módulos que Jest no carga en Node 22.

### ADR-14 · Seguridad de las cuentas: límite de intentos, contraseña temporal, cabeceras y auditoría

- **Contexto:** el login no tenía límite de intentos, no se podía cambiar la contraseña desde la aplicación y no quedaba registro de quién hacía las acciones delicadas.
- **Límite de intentos:** 5 fallos seguidos bloquean el usuario 15 minutos. El contador se lleva **por el nombre escrito, exista o no**: si solo se bloquearan los usuarios reales, la respuesta `429` delataría cuáles existen. Para los usuarios reales el bloqueo también se guarda en la base, así sobrevive a un reinicio. Hay un segundo límite por dirección IP (30 fallos) contra quien prueba una contraseña común con muchos usuarios.
- **Por qué en memoria y sin librería:** el contador es una defensa, no un dato del negocio. `shared/limitador.js` son 50 líneas con reloj inyectable, lo que permite probar el paso de los 15 minutos sin esperar.
- **Costo aceptado:** alguien puede bloquear a propósito la cuenta de otro. Se prefiere eso a permitir adivinar contraseñas; el administrador puede desbloquear.
- **Cambio de contraseña:** exige la actual (por si alguien encontró la sesión abierta), tiene su propio límite de intentos y cierra las demás sesiones del usuario.
- **Contraseña temporal:** el middleware `exigirPasswordPropia` cierra toda la API, salvo `/api/auth`, mientras el usuario no cambie la contraseña que le asignaron. La interfaz lo acompaña, pero la regla está en el servidor.
- **Cabeceras:** `helmet` con una política de contenido estricta (sin `unsafe-inline`). Una prueba revisa que `index.html` no tenga scripts, estilos ni manejadores en línea, para que la política no se rompa sin darse cuenta. No se fuerza HTTPS porque en el taller la aplicación se abre por HTTP en la red local.
- **Auditoría:** los servicios reciben el registro de auditoría por parámetro y escriben dentro de la misma transacción de la operación: si la operación se deshace, no queda un rastro falso. Del intento fallido no se guarda el texto escrito como usuario, porque a veces la gente escribe ahí su contraseña.

### ADR-15 · Administración de usuarios: quién gestiona a quién

- **Contexto:** los usuarios solo se podían crear desde la consola (`npm run usuario:crear`). El taller necesita hacerlo desde la aplicación, pero un panel de usuarios mal diseñado es la forma más fácil de escalar privilegios.
- **Decisión:** dos niveles. El **dueño** gestiona cualquier cuenta. El **administrador** gestiona solo mecánicos y recepcionistas: no puede crear, editar, desactivar ni restablecer cuentas de dueño o de otro administrador, ni ascender a nadie a esos roles. Así un administrador no puede crearse un cómplice con más poder ni dejar al dueño por fuera.
- **Protecciones contra dejar el taller sin acceso:** nadie se desactiva ni se cambia el rol a sí mismo; siempre debe quedar un dueño activo; un mecánico con órdenes en proceso no se desactiva ni cambia de rol hasta reasignarlas.
- **Contraseñas:** el administrador nunca escribe la contraseña de otro. El sistema genera una temporal de 12 caracteres, la muestra una sola vez y obliga a cambiarla (ADR-14). No queda en la auditoría.
- **Sesiones:** desactivar, cambiar el rol o restablecer la contraseña cierra las sesiones del usuario, para que los permisos viejos no sigan vivos hasta 8 horas.
- **Dónde vive la regla:** en `usuario.service.js`. La API marca cada cuenta como `gestionable` o no, y la interfaz solo oculta los botones; si alguien llama la API directamente, el servicio responde 403.
- **Estado del sistema extensible:** `sistema.service.js` permite que otros módulos registren su propia sección (el correo y el modelo de predicción lo usarán en el Sprint 3) sin que el módulo de sistema los conozca.

### ADR-16 · Panel del taller: consultas agregadas y gráficos propios

- **Contexto:** el dueño necesita ver el negocio de un vistazo (cuánto vale el inventario, cuánto se trabaja, qué se gasta) sin exportar nada a Excel.
- **Una sola consulta:** `GET /api/panel/resumen` devuelve todo el panel. Las sumas las hace SQLite (`panel.repository.js`); el servicio solo completa con ceros las semanas y meses sin movimiento, para que el gráfico muestre el hueco en lugar de saltárselo.
- **Fecha de cierre de una orden:** es su último paso a "Finalizada" en el historial de estados. Una orden reabierta y vuelta a cerrar cuenta una sola vez, en la fecha del cierre definitivo.
- **Costo de repuestos:** sale de `detalle_repuestos` (que guarda el costo unitario del momento) y excluye los devueltos por órdenes canceladas.
- **Las fechas se agrupan en UTC**, que es como SQLite las guarda. Una orden cerrada un domingo después de las 7 p. m. (hora de Colombia) cae en la semana siguiente. Para indicadores semanales y mensuales la diferencia es pequeña; se documenta como límite conocido.
- **Gráficos sin librería:** `public/js/graficos.js` genera SVG y HTML a mano. Una librería de gráficos pesa más que toda la interfaz actual y obligaría a relajar la política de contenido (muchas insertan estilos en línea). Dos tipos bastan: columnas en el tiempo y barras para comparar.
- **Reglas de los gráficos:** una sola serie usa un solo color; el texto nunca lleva el color de la serie; se rotulan solo el valor más alto y el periodo actual; cada gráfico tiene una tabla equivalente ("Ver como tabla") y el detalle aparece igual con el ratón que con el teclado. Los colores de las series (`--serie-1`, `--serie-2`) se validaron para daltonismo y contraste sobre el fondo de los paneles.
- **Indicadores como cifras, no como gráficos:** un solo número (valor del inventario, órdenes en proceso) se lee mejor como cifra. El aviso de stock lleva símbolo y texto, no solo color.
- **Acciones del dueño:** reasignar una orden en proceso a otro mecánico (queda en la auditoría) y registrar entradas de mercancía con el movimiento `ENTRADA`, distinto del ajuste manual: el historial distingue "llegó mercancía" de "se corrigió un conteo".

## Requisitos no funcionales cubiertos

| RNF | Cómo se atiende |
|---|---|
| Facilidad de uso | Una sola pantalla, mensajes de error junto a cada campo y textos en lenguaje del taller |
| Velocidad (< 2 s) | Consultas preparadas, índices para los filtros del listado y paginación (máximo 50 por página) |
| Compatibilidad | Web estándar, sin instalar nada en el taller; diseño responsive para PC y tablet |
| Mantenimiento | Capas y módulos separados, código comentado, migraciones versionadas, más de 200 pruebas (unitarias, integración, aceptación e interfaz) y CI |
| Crecimiento a futuro | Módulos por dominio (`auth`, `usuarios`, `auditoria`, `sistema`, `panel`, `inventario`, `ordenes`); los siguientes serán `alertas` y `prediccion` |
| Seguridad | Contraseñas con `scrypt`, sesiones con vencimiento, bloqueo por intentos fallidos, permisos por rol y por propiedad en la API, cabeceras con CSP, auditoría, consultas parametrizadas y ningún secreto en el repositorio (ADR-08, ADR-09, ADR-14) |
