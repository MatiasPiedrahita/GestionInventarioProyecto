# Gestión de inventario y órdenes para talleres mecánicos

[![CI](https://github.com/MatiasPiedrahita/GestionInventarioProyecto/actions/workflows/ci.yml/badge.svg)](https://github.com/MatiasPiedrahita/GestionInventarioProyecto/actions/workflows/ci.yml)

> ⚠️ **Advertencia: este proyecto se desarrolló con apoyo de inteligencia artificial.**
> Usamos **Claude (Anthropic)** como asistente durante el desarrollo. El detalle de qué se hizo con IA y qué hizo el equipo está en la sección [Declaración de uso de IA](#declaración-de-uso-de-inteligencia-artificial).

Proyecto de semestre de **Ingeniería de Software (UPB, 2026-2)**. Es una aplicación web para que los talleres mecánicos pequeños y medianos dejen de llevar el inventario y las órdenes de trabajo en cuadernos, hojas de Excel sueltas o mensajes de WhatsApp.

**Equipo:** Matías Piedrahita · Luis Carlos Moreno

---

## Estado del proyecto

El repositorio cubre los **Sprints 1 y 2 completos** del plan de trabajo.

| Sprint | ID | Historia de usuario | Rol | Estado |
|---|---|---|---|---|
| 1 | HU-02 | Iniciar sesión | Todos | ✅ |
| 1 | HU-01 | Gestión de inventario de repuestos | Dueño | ✅ |
| 1 | HU-03 | Crear orden de reparación | Mecánico | ✅ |
| 2 | HU-04 | Registrar repuestos usados en una reparación | Mecánico | ✅ |
| 2 | HU-05 | Agregar notas o detalles de la reparación | Mecánico | ✅ |
| 2 | HU-06 | Ver listado de órdenes de trabajo | Recepcionista | ✅ |
| 2 | HU-07 | Actualización del estado de órdenes | Mecánico | ✅ |
| 3 | — | Alertas de stock bajo | Dueño | Pendiente |
| 3 | — | Predicción de demanda de repuestos | Administrador | Pendiente |

### Criterios de aceptación y su prueba automática

Cada historia tiene una prueba de aceptación escrita como **Dado / Cuando / Entonces**. Esa prueba es la traducción directa de la "prueba de funcionalidad" del plan de sprints.

| Historia | Prueba de funcionalidad del plan | Archivo |
|---|---|---|
| HU-01 Inventario | No permitir stock negativo ni campos obligatorios vacíos | `tests/aceptacion/HU01.criterio-aceptacion.test.js` |
| HU-02 Iniciar sesión | Un mecánico no puede acceder a las vistas exclusivas del dueño | `tests/aceptacion/HU02.iniciar-sesion.test.js` |
| HU-03 Crear orden | La orden creada aparece en el listado con estado "En proceso" | `tests/aceptacion/HU03.crear-orden.test.js` |
| HU-04 Repuestos usados | Registrar 2 unidades reduce el stock en 2 | `tests/aceptacion/HU04.registrar-repuestos-usados.test.js` |
| HU-05 Notas | La nota se guarda y se ve igual al recargar | `tests/aceptacion/HU05.notas-de-reparacion.test.js` |
| HU-06 Listado | Filtrar por placa devuelve solo coincidencias exactas | `tests/aceptacion/HU06.listado-ordenes.test.js` |
| HU-07 Estado de órdenes | Finalizar una orden con 2 filtros consumidos deja descontadas 2 unidades en la base | `tests/aceptacion/HU07.actualizacion-estado.test.js` |

> **Sobre la HU-07:** el plan decía "descontar el stock al finalizar". En este sistema el stock se descuenta cuando el mecánico registra el repuesto (HU-04), para que el inventario siempre muestre lo que hay en el estante. Finalizar solo cambia el estado; la prueba confirma que el descuento en la base es de exactamente 2 unidades, una sola vez. Ver ADR-10 y ADR-12.

### Qué puede hacer cada rol

| Rol | Al iniciar sesión entra a | Puede |
|---|---|---|
| **Dueño del taller** | Inventario | Gestionar el inventario (crear, editar, dar de baja, importar CSV, ver historial). Crear órdenes asignándolas a un mecánico. Ver todas las órdenes y trabajar en ellas. Cambiar el estado de cualquier orden y **reabrir** las que ya se cerraron. Entra también al panel de administración y es el **único** que crea o modifica dueños y administradores |
| **Administrador** | Administración | **Panel de administración:** crear usuarios (mecánicos y recepcionistas), editarlos, activarlos o desactivarlos, asignarles una contraseña temporal, cerrar sus sesiones y desbloquearlos; consultar la auditoría y el estado del sistema. Además gestiona el inventario y las órdenes. No puede tocar cuentas de dueño ni de otros administradores |
| **Mecánico** | Órdenes de trabajo | Crear órdenes, que quedan a su nombre. Ver **solo sus** órdenes. Registrar repuestos usados (se descuentan del stock) y escribir notas de la reparación. Finalizar o cancelar sus órdenes desde el tablero. Consultar el inventario, pero no modificarlo |
| **Recepcionista** | Órdenes de trabajo | Consultar el listado global con filtros por placa, cliente, mecánico y estado. No puede modificar nada |
| **Todos** | — | "Mi cuenta": cambiar su contraseña y cerrar su sesión en todos los dispositivos |

Reglas de protección de las cuentas: nadie se desactiva ni se cambia el rol a sí mismo; siempre queda al menos un dueño activo; un mecánico con órdenes en proceso no se puede desactivar ni cambiar de rol hasta reasignarlas.

La interfaz oculta lo que cada rol no puede usar, pero **la seguridad real está en la API**: cada petición verifica la sesión y el rol, y responde `401` o `403` si no corresponde.

---

## Cómo levantar el proyecto desde cero

### 1. Requisitos

| Herramienta | Versión | Cómo verificar |
|---|---|---|
| [Node.js](https://nodejs.org/) | **22.13 o superior** (LTS) | `node -v` |
| npm | viene con Node | `npm -v` |
| Git | cualquiera reciente | `git --version` |

No hace falta instalar ninguna base de datos. El proyecto usa SQLite a través del módulo `node:sqlite` que ya trae Node.js.

### 2. Clonar e instalar

```bash
git clone https://github.com/MatiasPiedrahita/GestionInventarioProyecto.git
cd GestionInventarioProyecto
npm ci
```

### 3. Cargar datos de ejemplo y crear usuarios

```bash
npm run seed
```

Crea 6 repuestos, 12 órdenes de ejemplo y estos usuarios:

| Usuario | Rol |
|---|---|
| `dueno` | Dueño del taller |
| `admin` | Administrador |
| `mecanico1`, `mecanico2` | Mecánico |
| `recepcion` | Recepcionista |

**Contraseñas:** por seguridad no están en el repositorio. El seed genera una contraseña aleatoria por usuario y **la muestra una sola vez en la consola**; anótala. Si prefieren una contraseña común para pruebas, copien `.env.example` como `.env` y escriban un valor en `DEMO_PASSWORD` **antes** de correr el seed. El archivo `.env` nunca se sube al repositorio.

El seed se puede correr varias veces: no duplica nada.

Para crear otro usuario:

```bash
npm run usuario:crear -- --usuario luis --nombre "Luis Carlos" --rol mecanico --password "una-clave-de-8-o-mas"
```

### 4. Ejecutar

```bash
npm start
```

Abra **http://localhost:3000** e inicie sesión. La base de datos se crea en `data/inventario.db`.

> **Si ya tenían una base de datos de la versión anterior**, no hay que borrarla. Al arrancar, el sistema aplica solo las migraciones que le faltan y conserva el inventario y su historial.

### 5. Recorrido sugerido para probar a mano

1. Entrar como **`mecanico1`**: llega a "Mis órdenes". Crear una orden con la placa `abc123`.
2. Abrir la orden y registrar 2 unidades de un repuesto: el texto del selector muestra cómo baja el stock.
3. Escribir una nota, guardarla y recargar la página: la nota sigue ahí.
4. En el tablero, arrastrar la tarjeta a "Finalizadas" (o usar el botón **Finalizar**): el stock no cambia. Cancelar otra orden con repuestos: vuelven al inventario.
5. Intentar entrar a `http://localhost:3000/#inventario`: lo devuelve a órdenes, porque no es su vista.
6. Entrar como **`recepcion`**: filtrar por placa `ABC123` (solo salen esas), por estado "Históricas" y por mecánico.
7. Entrar como **`dueno`**: en Inventario, abrir el historial del repuesto usado y ver los movimientos "Usado en la orden #N" y "Devuelto al cancelar la orden #N". En Órdenes, reabrir una orden finalizada.

---

## Cómo correr las pruebas

```bash
npm test                 # todas las pruebas
npm run test:cobertura   # con reporte de cobertura
```

Resultado actual: **351 pruebas en 32 suites, todas en verde.**

| Tipo | Carpeta | Qué verifican |
|---|---|---|
| Aceptación | `tests/aceptacion/` | Un archivo por historia, con escenarios Dado/Cuando/Entonces |
| Integración | `tests/integration/` | La API completa (HTTP, lógica y base de datos en memoria): login y sesiones, permisos por rol, inventario, órdenes, repuestos usados, notas, cambios de estado, filtros, paginación, índices, migraciones, respuestas de error seguridad (bloqueo por intentos, cambio de contraseña, cabeceras, auditoría) y administración de usuarios |
| Interfaz | `tests/interfaz/` | La pantalla real (`public/`) cargada en un navegador simulado (jsdom) y conectada a la API: inicio de sesión, menú por rol, "Mi cuenta", panel de administración, tablero Kanban y cambio de estado |
| Unitarias | `tests/unit/` | Validadores (repuesto, orden, repuestos usados, filtros, cambio de estado), reglas de transición, lector de CSV, política y hash de contraseñas, y limitador de intentos |

Cada prueba crea su propia base de datos en memoria y sus propios usuarios (`tests/helpers/contexto.js`), así que las pruebas no dependen unas de otras.

---

## Pipeline de integración continua

Archivo: [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Se ejecuta en **cada push y cada pull request**, con dos jobs en paralelo:

| Job | Pasos |
|---|---|
| **Build y pruebas** | `npm ci` → `npm run build` (verifica la sintaxis de todos los archivos y que la app se construya) → `npm run test:cobertura` → publica el reporte de cobertura como artefacto |
| **Análisis de vulnerabilidades** | `npm ci` → `npm audit --audit-level=high` |

---

## Arquitectura

Arquitectura **por capas y por módulos de dominio**, la misma de los diagramas de componentes y del C4 nivel 2 del proyecto:

```
Navegador (public/)        Login, menú por rol y vistas (inventario, órdenes)
        │  HTTP / JSON + Authorization: Bearer <token>
        ▼
Middleware de sesión y rol (modules/auth)   401 sin sesión, 403 sin permiso
        ▼
Rutas → Servicios → Repositorios            por módulo: auth, inventario, ordenes
        ▼
SQLite + migraciones versionadas (src/db/migraciones/001…008)
```

```
src/
├── app.js                       Composición de módulos y permisos por rol
├── server.js
├── db/
│   ├── connection.js            Aplica las migraciones pendientes al abrir la base
│   └── migraciones/             001 inventario · 002 usuarios y sesiones · 003 órdenes
│                                004 repuestos usados · 005 notas · 006 índices
│                                007 estado de órdenes · 008 seguridad de cuentas
├── modules/
│   ├── auditoria/               Registro de acciones sensibles (quién, qué y cuándo)
│   ├── auth/                    Roles, contraseñas, sesiones, límite de intentos, middleware y rutas
│   ├── inventario/              Repuestos, CSV e historial de movimientos
│   ├── ordenes/                 Órdenes, clientes, vehículos, repuestos usados, notas, filtros y estados
│   ├── sistema/                 Estado del sistema para el panel de administración
│   └── usuarios/                Administración de usuarios (quién gestiona a quién)
└── shared/                      Errores de dominio, manejador de errores y limitador de intentos
public/
├── index.html, styles.css
└── js/                          api.js (token), comun.js, app.js (enrutador por rol), vistas/
tests/
├── aceptacion/  integration/  interfaz/  unit/  helpers/
scripts/
└── build.js · seed.js · crear-usuario.js
```

Las decisiones de diseño están en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

### API REST

Todas las rutas, salvo `/api/salud` y `/api/auth/login`, exigen la cabecera `Authorization: Bearer <token>`.

| Método | Ruta | Quién | Descripción |
|---|---|---|---|
| POST | `/api/auth/login` | Público | Inicia sesión: devuelve token, usuario y vista inicial según el rol |
| POST | `/api/auth/logout` | Con sesión | Cierra la sesión (el token deja de servir) |
| GET | `/api/auth/yo` | Con sesión | Usuario de la sesión actual |
| POST | `/api/auth/password` | Con sesión | Cambia la contraseña propia: `{ actual, nueva }`. Cierra las demás sesiones del usuario |
| POST | `/api/auth/logout-todas` | Con sesión | Cierra la sesión en todos los dispositivos |
| GET | `/api/repuestos?q=&bajoStock=true` | Con sesión | Catálogo de repuestos |
| GET | `/api/repuestos/:id` | Con sesión | Un repuesto |
| POST · PUT · DELETE | `/api/repuestos[/:id]` | Dueño, admin | Crear, editar, dar de baja |
| POST | `/api/repuestos/importar` | Dueño, admin | Carga masiva por CSV |
| GET | `/api/repuestos/:id/movimientos` | Dueño, admin | Historial del repuesto |
| GET | `/api/usuarios/mecanicos` | Con sesión | Mecánicos activos |
| GET | `/api/usuarios` | Dueño, admin | Todas las cuentas con su estado (activa, bloqueada, sesiones abiertas) y los roles que el actor puede asignar |
| POST | `/api/usuarios` | Dueño, admin | Crea un usuario y devuelve su contraseña temporal una sola vez. El admin solo crea mecánicos y recepcionistas |
| PUT | `/api/usuarios/:id` | Dueño, admin | Edita nombre, rol y correo |
| PATCH | `/api/usuarios/:id/estado` | Dueño, admin | Activa o desactiva la cuenta: `{ activo }` |
| POST | `/api/usuarios/:id/password` | Dueño, admin | Asigna una contraseña temporal nueva y cierra las sesiones |
| POST | `/api/usuarios/:id/desbloqueo` | Dueño, admin | Quita el bloqueo por intentos fallidos |
| DELETE | `/api/usuarios/:id/sesiones` | Dueño, admin | Cierra todas las sesiones del usuario |
| GET | `/api/auditoria?usuarioId=&accion=&desde=&hasta=&pagina=&tamano=` | Dueño, admin | Registro de auditoría paginado |
| GET | `/api/sistema/estado` | Dueño, admin | Versiones, tiempo encendido y tamaño de los datos |
| GET | `/api/ordenes?placa=&cliente=&mecanicoId=&estado=&pagina=&tamano=` | Con sesión | Listado paginado. `estado`: `ACTIVAS`, `HISTORICAS`, `EN_PROCESO`, `FINALIZADA` o `CANCELADA`. El mecánico solo recibe las suyas |
| POST | `/api/ordenes` | Mecánico, dueño, admin | Crea una orden en estado "En proceso" |
| GET | `/api/ordenes/:id` | Con sesión (el mecánico, solo las suyas) | Detalle con repuestos usados, total y notas |
| POST | `/api/ordenes/:id/repuestos` | Mecánico (suyas), dueño, admin | Registra repuestos usados y descuenta stock |
| PATCH | `/api/ordenes/:id/notas` | Mecánico (suyas), dueño, admin | Guarda las notas de la reparación |
| PATCH | `/api/ordenes/:id/estado` | Mecánico (suyas), dueño, admin | Cambia el estado: `{ estado, motivo?, devolverRepuestos? }`. Cancelar y reabrir exigen `motivo`. Reabrir es solo para dueño y admin |
| GET | `/api/ordenes/:id/historial` | Con sesión (el mecánico, solo las suyas) | Cambios de estado de la orden: quién, cuándo y por qué |

Todos los errores tienen la misma forma:

```json
{ "error": "VALIDACION", "mensaje": "Los datos enviados no son válidos", "detalles": [{ "campo": "vehiculo.placa", "mensaje": "La placa es obligatoria" }] }
```

| Código | Significado |
|---|---|
| 400 | Datos inválidos (`VALIDACION`) |
| 401 | Sin sesión o sesión vencida (`NO_AUTENTICADO`) |
| 403 | El rol no tiene permiso (`SIN_PERMISO`), o hay que cambiar la contraseña temporal antes de seguir (`CAMBIO_DE_PASSWORD_REQUERIDO`) |
| 404 | No existe (`NO_ENCONTRADO`) |
| 429 | Demasiados intentos fallidos; la cabecera `Retry-After` dice cuánto esperar (`DEMASIADOS_INTENTOS`) |
| 409 | Conflicto: SKU repetido, stock insuficiente, orden que ya no está en proceso o cambio de estado que no existe (`CONFLICTO`) |

### Seguridad

| Medida | Cómo funciona |
|---|---|
| Contraseñas | Se guardan con `scrypt` y sal aleatoria. Mínimo 8 caracteres, máximo 128; no pueden ser el nombre de usuario |
| Fuerza bruta | 5 contraseñas incorrectas bloquean ese usuario 15 minutos (responde `429`). Pasa lo mismo si el usuario no existe, así el bloqueo no revela qué usuarios hay. Una misma dirección IP con 30 fallos también queda bloqueada |
| Sesiones | Token aleatorio de 32 bytes; en la base solo se guarda su hash. Vence a las 8 horas. Cambiar la contraseña cierra las demás sesiones, y desde "Mi cuenta" se pueden cerrar todas |
| Contraseña temporal | Un usuario marcado para cambiar su contraseña solo puede entrar a cambiarla: el resto de la API responde `403` |
| Permisos | Por rol en las rutas y por propiedad en los servicios (un mecánico solo toca sus órdenes) |
| Cabeceras | `helmet` con política de contenido (CSP): solo scripts y estilos propios, sin código en línea. Las respuestas de la API llevan `Cache-Control: no-store` |
| Auditoría | Tabla `auditoria` con ingresos, intentos fallidos, bloqueos, cambios de contraseña, cambios de estado de órdenes, ajustes de stock, bajas y cargas por CSV |
| Inyección SQL | Todas las consultas son parametrizadas |
| Dependencias | `npm audit` en cada push y Dependabot cada semana |
| Secretos | Ninguno en el repositorio: `.env`, la base de datos y las contraseñas de ejemplo quedan fuera |

**Limitaciones conocidas:** el bloqueo por intentos permite que alguien bloquee a propósito la cuenta de otro durante 15 minutos (se prefiere eso a dejar adivinar contraseñas). La aplicación no cifra el tráfico por sí misma: fuera de la red local debe ir detrás de HTTPS.

---

## Equipo y flujo de trabajo

### Reparto de tareas

Según el plan de sprints:

| Historia | Matías Piedrahita | Luis Carlos Moreno |
|---|---|---|
| Iniciar sesión | Endpoint de autenticación, redirección por rol | Tabla de usuarios, formulario de login |
| Gestión de inventario | Tablas de repuestos e historial, formulario y tabla | API REST CRUD, carga masiva por CSV |
| Crear orden | Endpoint de creación | Tablas de órdenes, clientes y vehículos, formulario |
| Repuestos usados | Tabla de detalle, selector en el frontend | Endpoint con descuento de stock |
| Notas | Endpoint de notas | Campo en la tabla de órdenes, campo de texto |
| Listado de órdenes | Índices, tabla con barra de búsqueda | API con paginación y filtros |
| Estado de órdenes | Endpoint de cambio de estado, tablero Kanban | Historial de estados, devolución de repuestos |

El pipeline de CI, las pruebas automatizadas y la revisión de los pull requests se trabajaron entre los dos.

### Flujo

- `main` siempre debe estar en verde. Nadie hace push directo a `main`.
- **Una rama por historia:** `feature/HU-02-iniciar-sesion`, `feature/HU-03-crear-orden`, etc.
- Todo cambio entra por **pull request** con el CI en verde, y se fusiona con *Create a merge commit* para conservar el historial de commits.
- Commits pequeños con prefijo: `feat:`, `test:`, `fix:`, `docs:`, `ci:`.

---

## Declaración de uso de inteligencia artificial

> ⚠️ **Este proyecto usó apoyo de IA.** Lo declaramos como lo exige el curso.

**Herramienta:** Claude, asistente de IA de Anthropic, usado desde claude.ai y, a partir de la HU-07, desde Claude Code (el asistente trabaja sobre el repositorio local, corre las pruebas y prepara las ramas y los pull requests).

**Para qué la usamos:**

- Proponer la arquitectura por capas y la estructura de carpetas a partir de nuestros diagramas (clases, componentes, C4).
- Generar el código de las historias HU-01 a HU-07: autenticación y roles, inventario, órdenes, repuestos usados, notas, listado con filtros, cambio de estado con tablero Kanban, migraciones de la base de datos e interfaz web.
- Endurecer la seguridad: límite de intentos de inicio de sesión, cambio de contraseña, cabeceras, auditoría.
- Proponer qué puede hacer cada rol y construir el panel de administración.
- Escribir las pruebas automatizadas, incluida la traducción de cada prueba de funcionalidad del plan de sprints a escenarios Dado/Cuando/Entonces.
- Configurar el workflow de GitHub Actions y el análisis de vulnerabilidades.
- Redactar este README y la documentación en `docs/`.

**Qué hizo el equipo:**

- Definir el problema, las historias de usuario, la priorización MoSCoW, los criterios de aceptación y el plan de sprints con su reparto de tareas.
- Revisar, ejecutar y entender todo el código generado antes de subirlo, y ajustarlo donde fue necesario.
- Organizar el trabajo en ramas, commits y pull requests, y revisar el código.

**Responsabilidad:** el equipo entiende el código entregado, puede explicarlo y es responsable de su contenido. La IA se usó como apoyo y no reemplazó nuestro criterio ni nuestra revisión.

---

## Licencia

[MIT](LICENSE)
