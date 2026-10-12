# Gestión de inventario y órdenes para talleres mecánicos

[![CI](https://github.com/MatiasPiedrahita/GestionInventarioProyecto/actions/workflows/ci.yml/badge.svg)](https://github.com/MatiasPiedrahita/GestionInventarioProyecto/actions/workflows/ci.yml)

> ⚠️ **Advertencia: este proyecto se desarrolló con apoyo de inteligencia artificial.**
> Usamos **Claude (Anthropic)** como asistente durante el desarrollo. El detalle de qué se hizo con IA y qué hizo el equipo está en la sección [Declaración de uso de IA](#declaración-de-uso-de-inteligencia-artificial).

Proyecto de semestre de **Ingeniería de Software (UPB, 2026-2)**. Es una aplicación web para que los talleres mecánicos pequeños y medianos dejen de llevar el inventario y las órdenes de trabajo en cuadernos, hojas de Excel sueltas o mensajes de WhatsApp.

**Equipo:** Matías Piedrahita · Luis Carlos Moreno

---

## Estado del proyecto

El repositorio cubre los **Sprints 1 y 2 completos** y el **Sprint 3**: alertas de stock bajo y predicción de demanda. Las nueve historias del plan están implementadas.

| Sprint | ID | Historia de usuario | Rol | Estado |
|---|---|---|---|---|
| 1 | HU-02 | Iniciar sesión | Todos | ✅ |
| 1 | HU-01 | Gestión de inventario de repuestos | Dueño | ✅ |
| 1 | HU-03 | Crear orden de reparación | Mecánico | ✅ |
| 2 | HU-04 | Registrar repuestos usados en una reparación | Mecánico | ✅ |
| 2 | HU-05 | Agregar notas o detalles de la reparación | Mecánico | ✅ |
| 2 | HU-06 | Ver listado de órdenes de trabajo | Recepcionista | ✅ |
| 2 | HU-07 | Actualización del estado de órdenes | Mecánico | ✅ |
| 3 | HU-08 | Alertas de stock bajo | Dueño | ✅ |
| 3 | HU-09 | Predicción de demanda de repuestos | Administrador | ✅ |

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
| HU-08 Alertas de stock | Al llegar el stock a su mínimo se genera la alerta y el dueño es notificado (campana y correo) | `tests/aceptacion/HU08.alertas-stock-bajo.test.js` |
| HU-09 Predicción | Con historial de consumo, el modelo proyecta la demanda de las próximas semanas y avisa de lo que se va a agotar | `tests/aceptacion/HU09.prediccion-demanda.test.js` |

> **Sobre la HU-07:** el plan decía "descontar el stock al finalizar". En este sistema el stock se descuenta cuando el mecánico registra el repuesto (HU-04), para que el inventario siempre muestre lo que hay en el estante. Finalizar solo cambia el estado; la prueba confirma que el descuento en la base es de exactamente 2 unidades, una sola vez. Ver ADR-10 y ADR-12.

### Qué puede hacer cada rol

| Rol | Al iniciar sesión entra a | En una frase |
|---|---|---|
| **Dueño del taller** | Panel del taller | Ve el negocio, decide las compras y es el único que administra a dueños y administradores |
| **Administrador** | Administración | Administra usuarios, audita el sistema y maneja la predicción de demanda |
| **Mecánico** | Tablero de sus órdenes | Trabaja sus órdenes: repuestos, notas y estado |
| **Recepcionista** | Órdenes de trabajo | Recibe los vehículos y atiende a los clientes |

**Dueño del taller**

- **Panel del taller:** valor del inventario, stock por reponer, órdenes por semana, costo de repuestos por mes, repuestos más usados, trabajo por mecánico y compras sugeridas.
- **Alertas de stock:** recibe el aviso en la campana (y por correo si lo activa) y marca cuándo ya hizo el pedido.
- **Predicción:** qué pedir hoy por proveedor (exportable a Excel), cuánto invertir, qué repuestos tienen plata quieta y el pronóstico de cada uno.
- **Órdenes:** las ve todas, las crea asignando el mecánico, cambia su estado, **reabre** las cerradas y las **reasigna** a otro mecánico.
- **Inventario:** crear, editar, dar de baja, importar CSV, registrar **entradas de mercancía** y ver el historial.
- **Cuentas:** entra al panel de administración y es el **único** que crea o modifica dueños y administradores.

**Administrador**

- **Panel de administración:** crea usuarios (mecánicos y recepcionistas), los edita, activa o desactiva, les asigna una contraseña temporal, cierra sus sesiones y los desbloquea.
- **Auditoría y sistema:** consulta quién hizo qué, el estado del sistema, las tareas programadas y la bandeja de salida de correos.
- **Predicción de demanda:** ejecuta el modelo, elige el horizonte y el nivel de servicio, y revisa su precisión.
- También ve el panel del taller y las alertas, y gestiona el inventario y las órdenes.
- **No puede** tocar cuentas de dueño ni de otros administradores, ni asignar esos roles.

**Mecánico**

- **Tablero Kanban** con sus órdenes y **Mi resumen** (órdenes abiertas, cerradas y repuestos usados en 30 días).
- Crea órdenes, que quedan a su nombre. Registra repuestos usados (se descuentan del stock) y escribe notas.
- **Finaliza o cancela** sus órdenes. **Avisa al dueño** cuando un repuesto falta o no sirve para un trabajo.
- Recibe en la campana las órdenes que le asignan.
- **No puede** ver órdenes de otros mecánicos, reabrir órdenes, modificar el inventario ni consultar el directorio de clientes.

**Recepcionista**

- **Recibe vehículos:** crea la orden eligiendo el mecánico. Con un documento o una placa ya registrados, el formulario se completa solo.
- **Clientes y vehículos:** busca por nombre, documento, teléfono o placa, corrige el contacto y ve el historial de cada vehículo.
- Consulta el listado global de órdenes con filtros.
- **No puede** registrar repuestos ni notas, cambiar estados ni gestionar el inventario.

**Todos los roles** tienen "Mi cuenta" (cambiar la contraseña, cerrar la sesión en todos los dispositivos, elegir si quieren los avisos también por correo) y la **campana** de notificaciones.

Reglas de protección de las cuentas: nadie se desactiva ni se cambia el rol a sí mismo; siempre queda al menos un dueño activo; un mecánico con órdenes en proceso no se puede desactivar ni cambiar de rol hasta reasignarlas.

La interfaz oculta lo que cada rol no puede usar, pero **la seguridad real está en la API**: cada petición verifica la sesión y el rol, y responde `401` o `403` si no corresponde.

---

## Cómo levantar el proyecto desde cero

### 1. Requisitos

| Herramienta | Versión | Cómo verificar |
|---|---|---|
| [Node.js](https://nodejs.org/) | **22.13 o superior** (LTS) | `node -v` |
| npm | viene con Node | `npm -v` |
| [Python](https://www.python.org/) | **3.11 o superior** (solo para la predicción de demanda) | `python --version` |
| Git | cualquiera reciente | `git --version` |

No hace falta instalar ninguna base de datos. El proyecto usa SQLite a través del módulo `node:sqlite` que ya trae Node.js.

Python solo se necesita para el modelo de predicción. Sin Python, todo lo demás funciona igual.

### 2. Clonar e instalar

```bash
git clone https://github.com/MatiasPiedrahita/GestionInventarioProyecto.git
cd GestionInventarioProyecto
npm ci
npm run prediccion:instalar     # opcional: crea .venv con las librerías del modelo de predicción
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

Para probar la **predicción de demanda** hace falta historia. Este comando simula dos años y medio de trabajo del taller (unas 800 órdenes, 12 repuestos con patrones de consumo distintos):

```bash
npm run seed:historial
```

Los datos son inventados y siempre salen iguales. No lo ejecute sobre la base real de un taller.

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
6. Entrar como **`recepcion`**: filtrar por placa `ABC123` (solo salen esas), por estado "Históricas" y por mecánico. Crear una orden escribiendo un documento que ya exista: el nombre y el teléfono se completan solos. En "Clientes", buscar por placa y abrir la ficha.
7. Como **`mecanico1`**, registrar repuestos hasta dejar uno en su mínimo. Entrar como **`dueno`**: la campana muestra el aviso y la sección "Alertas" lo lista. En "Mi cuenta" activar los avisos por correo, repetir con otro repuesto y ver el correo simulado en Administración > Sistema.
8. Con el historial de demostración cargado (`npm run seed:historial`), entrar como **`admin`** a "Predicción": revisar las compras sugeridas, exportarlas a CSV, y en "Todos los repuestos" abrir el pronóstico de las plumillas (`PLU-LIM-010`), que sube al llegar la temporada de lluvias. Usar el punto de reorden sugerido como stock mínimo.
9. Como **`dueno`**: en Inventario, abrir el historial del repuesto usado y ver los movimientos "Usado en la orden #N" y "Devuelto al cancelar la orden #N". En Órdenes, reabrir una orden finalizada.

---

## Cómo correr las pruebas

```bash
npm test                 # todas las pruebas de la aplicación (Jest)
npm run test:cobertura   # con reporte de cobertura
npm run test:python      # pruebas del modelo de predicción (pytest); antes: npm run prediccion:instalar -- --dev
```

Resultado actual: **686 pruebas de la aplicación (Jest) en 51 suites y 184 del modelo (pytest), todas en verde.**

| Tipo | Carpeta | Qué verifican |
|---|---|---|
| Aceptación | `tests/aceptacion/` | Un archivo por historia, con escenarios Dado/Cuando/Entonces |
| Integración | `tests/integration/` | La API completa (HTTP, lógica y base de datos en memoria): login y sesiones, permisos por rol, inventario, órdenes, repuestos usados, notas, cambios de estado, filtros, paginación, índices, migraciones, respuestas de error seguridad (bloqueo por intentos, cambio de contraseña, cabeceras, auditoría), administración de usuarios, panel del taller, directorio de clientes, alertas de stock y notificaciones (en la aplicación y por correo) |
| Interfaz | `tests/interfaz/` | La pantalla real (`public/`) cargada en un navegador simulado (jsdom) y conectada a la API: inicio de sesión, menú por rol, "Mi cuenta", panel de administración, panel del taller con sus gráficos, recepción (clientes, vehículos y autocompletado), campana de notificaciones, alertas de stock, predicción (cálculo, reportes, gráfico de pronóstico y exportación), tablero Kanban y cambio de estado |
| Contrato | `tests/integration/prediccion.python.test.js` | La aplicación ejecuta el modelo real de Python y guarda su respuesta: si alguno de los dos lados cambia el formato, falla. Se omite con un aviso si no hay entorno de Python; en el pipeline es obligatoria |
| Modelo (Python) | `prediccion/tests/` | El modelo de predicción: series, patrones de demanda, cada modelo de pronóstico, evaluación con origen móvil, política de inventario, clasificación ABC, contrato y línea de comandos |
| Unitarias | `tests/unit/` | Validadores (repuesto, orden, repuestos usados, filtros, cambio de estado), reglas de transición y de alertas, tareas programadas, lector de CSV, política y hash de contraseñas, y limitador de intentos |

Cada prueba crea su propia base de datos en memoria y sus propios usuarios (`tests/helpers/contexto.js`), así que las pruebas no dependen unas de otras.

---

## Pipeline de integración continua

Archivo: [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Se ejecuta en **cada push y cada pull request**, con tres jobs en paralelo:

| Job | Pasos |
|---|---|
| **Build y pruebas** | `npm ci` → instala Python y las librerías del modelo → `npm run build` (verifica la sintaxis de todos los archivos y que la app se construya) → `npm run test:cobertura` → publica el reporte de cobertura como artefacto |
| **Modelo de predicción (Python)** | Python 3.12 → `pip install -r prediccion/requirements-dev.txt` → `pytest` |
| **Análisis de vulnerabilidades** | `npm ci` → `npm audit --audit-level=high` → `pip-audit` sobre las librerías de Python |

---

## Arquitectura

Arquitectura **por capas y por módulos de dominio**, la misma de los diagramas de componentes y del C4 nivel 2 del proyecto:

```
Navegador (public/)        Login, menú por rol y vistas (inventario, órdenes)
        │  HTTP / JSON + Authorization: Bearer <token>
        ▼
Middleware de sesión y rol (modules/auth)   401 sin sesión, 403 sin permiso
        ▼
Rutas → Servicios → Repositorios            por módulo de dominio (ver abajo)
        │                                   Tarea programada: revisa el stock cada 15 min
        │                                   Correo: simulado, o SMTP si está en el .env
        ▼
SQLite + migraciones versionadas (src/db/migraciones/001…010)
        ▲
        │ JSON por stdin / stdout (proceso aparte, una ejecución a la vez)
Modelo de predicción en Python (prediccion/taller_prediccion)
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
│                                009 alertas y notificaciones · 010 predicción de demanda
├── modules/
│   ├── alertas/                 Alertas de stock bajo: reglas, revisión y atención
│   ├── auditoria/               Registro de acciones sensibles (quién, qué y cuándo)
│   ├── auth/                    Roles, contraseñas, sesiones, límite de intentos, middleware y rutas
│   ├── clientes/                Directorio de clientes y vehículos (recepción)
│   ├── inventario/              Repuestos, CSV, entradas de mercancía e historial de movimientos
│   ├── notificaciones/          Campana de la aplicación y correo (simulado o SMTP)
│   ├── ordenes/                 Órdenes, clientes, vehículos, repuestos usados, notas, filtros y estados
│   ├── panel/                   Indicadores del negocio para el dueño (consultas agregadas)
│   ├── prediccion/              Extrae el consumo, ejecuta el modelo de Python y guarda sus resultados
│   ├── sistema/                 Estado del sistema para el panel de administración
│   └── usuarios/                Administración de usuarios (quién gestiona a quién)
├── shared/                      Errores de dominio, manejador de errores, limitador de intentos y eventos
└── tareas/                      Programador de tareas periódicas
public/
├── index.html, styles.css
└── js/                          api.js (token), comun.js, graficos.js (SVG propio), app.js (enrutador por rol), vistas/
tests/
├── aceptacion/  integration/  interfaz/  unit/  helpers/
scripts/
└── build.js · seed.js · seed-historial.js · crear-usuario.js · prediccion-instalar.js · prediccion-python.js
prediccion/                      Modelo de predicción en Python (paquete taller_prediccion y sus pruebas)
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
| POST | `/api/repuestos/:id/entradas` | Dueño, admin | Entrada de mercancía: `{ cantidad, detalle? }`. Suma al stock y deja el movimiento `ENTRADA` |
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
| POST | `/api/ordenes` | Mecánico, recepcionista, dueño, admin | Crea una orden en estado "En proceso". El mecánico queda como responsable; los demás eligen `mecanicoId` |
| GET | `/api/ordenes/mi-resumen` | Mecánico | Sus órdenes abiertas, las cerradas y los repuestos usados en 30 días |
| GET | `/api/clientes?q=&documento=&pagina=&tamano=` | Recepcionista, dueño, admin | Directorio: busca por nombre, teléfono, inicio del documento o placa exacta |
| GET · PUT | `/api/clientes/:id` | Recepcionista, dueño, admin | Ficha con vehículos e historial; corrige nombre, teléfono y correo |
| GET | `/api/vehiculos/:placa` | Recepcionista, dueño, admin | Vehículo, dueño actual e historial de órdenes |
| GET | `/api/ordenes/:id` | Con sesión (el mecánico, solo las suyas) | Detalle con repuestos usados, total y notas |
| POST | `/api/ordenes/:id/repuestos` | Mecánico (suyas), dueño, admin | Registra repuestos usados y descuenta stock |
| PATCH | `/api/ordenes/:id/notas` | Mecánico (suyas), dueño, admin | Guarda las notas de la reparación |
| PATCH | `/api/ordenes/:id/estado` | Mecánico (suyas), dueño, admin | Cambia el estado: `{ estado, motivo?, devolverRepuestos? }`. Cancelar y reabrir exigen `motivo`. Reabrir es solo para dueño y admin |
| PATCH | `/api/ordenes/:id/mecanico` | Dueño, admin | Reasigna una orden en proceso: `{ mecanicoId }` |
| GET | `/api/alertas?estado=ABIERTAS\|RESUELTAS&pagina=` | Dueño, admin | Alertas de stock abiertas (lo más urgente primero) o el historial |
| PATCH | `/api/alertas/:id/atender` | Dueño, admin | Marca que ya se hizo el pedido: `{ nota? }` |
| POST | `/api/alertas/revisar` | Dueño, admin | Revisa todo el inventario ahora (lo mismo que hace la tarea programada) |
| POST | `/api/repuestos/:id/faltantes` | Mecánico, dueño, admin | Avisa que un repuesto falta para un trabajo: `{ nota? }` |
| GET | `/api/notificaciones?soloNoLeidas=&limite=` | Con sesión | Los avisos del usuario y cuántos tiene sin leer |
| PATCH · POST | `/api/notificaciones/:id/leida` · `/leer-todas` | Con sesión | Marca como leídos los avisos propios |
| GET · PUT | `/api/notificaciones/preferencias` | Con sesión | Correo del usuario y si quiere recibir ahí los avisos |
| GET | `/api/correos` | Dueño, admin | Bandeja de salida: los correos enviados o simulados |
| POST | `/api/prediccion/ejecuciones` | Dueño, admin | Lanza el modelo: `{ horizonteSemanas?, nivelDeServicio? }`. Responde `202` y sigue calculando |
| GET | `/api/prediccion/estado` | Dueño, admin | Si hay una ejecución en curso y cuál fue la última |
| GET | `/api/prediccion/resumen` | Dueño, admin | La última predicción: un resultado por repuesto (modelo, demanda, punto de reorden, cantidad sugerida, fecha de quiebre) |
| GET | `/api/prediccion/repuestos/:id` | Dueño, admin | Pronóstico semana a semana con su intervalo e historia de consumo, para el gráfico |
| GET | `/api/prediccion/reportes` | Dueño, admin | Compras sugeridas por proveedor, clasificación ABC, repuestos sin movimiento y precisión del modelo |
| GET | `/api/prediccion/reportes/compras.csv` | Dueño, admin | Las compras sugeridas como archivo para Excel |
| GET | `/api/prediccion/ejecuciones[/:id]` | Dueño, admin | Historial de ejecuciones: duración, versión del modelo, error si falló |
| PATCH | `/api/repuestos/:id/minimo-sugerido` | Dueño, admin | Pone como stock mínimo el punto de reorden que calculó el modelo |
| GET | `/api/panel/resumen` | Dueño, admin | Indicadores del negocio: inventario, órdenes por semana, costo de repuestos por mes, más usados y trabajo por mecánico |
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

### Alertas de stock y notificaciones (HU-08)

- **Cuándo se alerta:** cuando el stock de un repuesto llega a su mínimo o baja de él (`stock <= mínimo`). Si llega a cero, la alerta pasa a "Agotado" y se vuelve a avisar.
- **Cómo se genera:** al instante, cada vez que cambia el stock (uso en una orden, ajuste, entrada, carga por CSV, cancelación), y además una **tarea programada** revisa todo el inventario cada 15 minutos. Revisar muchas veces nunca duplica alertas.
- **A quién se avisa:** al dueño y a los administradores activos. Siempre en la **campana** de la aplicación; por **correo** solo a quien lo activó en "Mi cuenta".
- **Ciclo de la alerta:** *Sin atender* → *Pedido hecho* (el dueño marca que ya pidió) → *Resuelta* (se cierra sola cuando el stock supera el mínimo).
- **Faltante reportado:** el mecánico puede avisar que un repuesto falta o no sirve aunque el sistema diga que hay.

**El correo es simulado por defecto.** Sin configurar nada, los correos no salen: quedan en la bandeja de salida, visible en **Administración > Sistema**. Para enviarlos de verdad, copie `.env.example` como `.env` y complete `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` y `SMTP_PASS` con los datos de su proveedor de correo. El `.env` nunca se sube al repositorio.

### Predicción de demanda (HU-09)

- **Qué hace:** con el consumo semanal de cada repuesto, el modelo pronostica las próximas semanas y calcula cuánto pedir, cuándo y en qué fecha se agotaría lo que hay. El detalle del modelo está en [`prediccion/README.md`](prediccion/README.md).
- **Cómo se ejecuta:** el dueño o el administrador la lanzan cuando quieran, y una tarea programada la recalcula cada 24 horas. La aplicación extrae los datos, ejecuta el paquete de Python como un proceso aparte y guarda el resultado. Solo corre una ejecución a la vez.
- **Integración con las alertas:** si un repuesto está por encima de su mínimo pero, al ritmo previsto, se agotaría antes de que alcance a llegar un pedido, se abre la alerta **"Se agotará pronto"** y se avisa al dueño. Además, cada alerta de stock muestra la cantidad que el modelo sugiere pedir.
- **Días de reposición:** cada repuesto guarda cuántos días tarda en llegar su pedido (7 por defecto). Se edita en el inventario.
- **Vista "Predicción":** cinco reportes sobre el mismo cálculo. *Compras sugeridas* (qué pedir hoy, por proveedor, exportable a CSV), *Todos los repuestos* (con el gráfico de historia y pronóstico de cada uno), *Clasificación ABC*, *Sin movimiento* (plata quieta) y *Precisión del modelo* (cuánto error ahorra frente a repetir la última semana).
- **Sin Python instalado** la aplicación funciona igual; la predicción queda como fallida con un mensaje que dice cómo instalarlo (`npm run prediccion:instalar`).

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

**Límites de estas medidas:** el bloqueo por intentos permite que alguien bloquee a propósito la cuenta de otro durante 15 minutos (se prefiere eso a dejar adivinar contraseñas). La aplicación no cifra el tráfico por sí misma: fuera de la red local debe ir detrás de HTTPS.

### Limitaciones conocidas

- **Un solo escritor.** SQLite admite una escritura a la vez. Para un taller es suficiente; pasar a PostgreSQL implicaría reescribir los repositorios (`*.repository.js`), no los servicios ni las rutas.
- **Fechas en UTC.** Los reportes por semana y por mes agrupan con la hora universal: una orden cerrada un domingo después de las 7 p. m. (hora de Colombia) cuenta en la semana siguiente.
- **El correo es simulado** mientras no se configure un servidor SMTP en el `.env`.
- **El modelo de predicción** no usa variables externas (festivos, precios), modela cada repuesto por separado y necesita al menos 12 semanas de historia para poder medirse. Sus límites están en [`prediccion/README.md`](prediccion/README.md).
- **Las pruebas de interfaz** usan un navegador simulado (jsdom): verifican el comportamiento, no el aspecto visual.
- **Sin HTTPS propio.** Fuera de la red local, la aplicación debe ir detrás de un servidor que cifre el tráfico.

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
| Alertas de stock | Tarea programada, servicio de notificaciones | Vista de alertas, avisos por correo |
| Predicción de demanda | Modelo de series de tiempo en Python, pipeline de datos | Integración con la aplicación, gráficos y reportes |

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
- Generar el código de las nueve historias (HU-01 a HU-09): autenticación y roles, inventario, órdenes, repuestos usados, notas, listado con filtros, cambio de estado con tablero Kanban, alertas, predicción, migraciones de la base de datos e interfaz web.
- Endurecer la seguridad: límite de intentos de inicio de sesión, cambio de contraseña, cabeceras, auditoría.
- Proponer qué puede hacer cada rol y construir el panel de administración, el panel del taller con sus gráficos y las funciones de recepción.
- Construir las alertas de stock bajo con notificaciones en la aplicación y por correo.
- Diseñar y programar el modelo de predicción en Python (`prediccion/`) y sus pruebas. El equipo pidió un modelo de series de tiempo sobre el historial de consumo, hecho en Python; la elección de los modelos (suavizado exponencial, Holt, estacional, Croston, SBA, TSB), de la métrica (RMSSE) y de la política de inventario la propuso la IA y está justificada en el ADR-19.
- Integrar el modelo con la aplicación (ejecución, almacenamiento, alertas) y construir la vista de predicción con sus reportes y gráficos.
- Proponer las decisiones de diseño registradas en los ADR-12 a ADR-21.
- Desde la HU-07: crear las ramas, los commits y los pull requests desde la cuenta de un integrante, y fusionarlos cuando el pipeline quedó en verde.
- Escribir las pruebas automatizadas, incluida la traducción de cada prueba de funcionalidad del plan de sprints a escenarios Dado/Cuando/Entonces.
- Configurar el workflow de GitHub Actions y el análisis de vulnerabilidades.
- Redactar este README y la documentación en `docs/`.

**Qué hizo el equipo:**

- Definir el problema, las historias de usuario, la priorización MoSCoW, los criterios de aceptación y el plan de sprints con su reparto de tareas.
- Decidir el alcance de cada etapa y resolver las decisiones que cambiaban lo acordado (por ejemplo, que la recepcionista pueda crear órdenes, o cómo integrar el modelo de Python).
- HU-01 a HU-06: revisar, ejecutar y entender el código antes de subirlo, y organizar el trabajo en ramas, commits y pull requests revisados por el otro integrante.
- HU-07 en adelante: los pull requests se fusionaron con las pruebas automáticas y el pipeline en verde, sin la aprobación de un segundo integrante en el pull request.

**Responsabilidad:** el equipo entiende el código entregado, puede explicarlo y es responsable de su contenido. La IA se usó como apoyo y no reemplazó nuestro criterio ni nuestra revisión.

---

## Licencia

[MIT](LICENSE)
