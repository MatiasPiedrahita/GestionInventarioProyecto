# Guía del taller · Semana 12 · Primer pipeline de CI

Esta guía reparte el trabajo para que **los dos integrantes tengan commits propios**, haya **dos pull requests revisados por el otro** y el pipeline se vea **en rojo primero y en verde al final**, como pide el taller.

## Roles

| Rol del taller | Responsable |
|---|---|
| Implementa la historia | **Matías** |
| Escribe las pruebas | **Luis Carlos** |
| Configura el workflow | **Luis Carlos** |
| Revisa el PR de la historia (PR #1) | **Luis Carlos** |
| Escribe el README y la documentación | **Luis Carlos** |
| Revisa el PR del README (PR #2) | **Matías** |

> Si prefieren invertir los roles, cambien los nombres: lo importante es que cada PR lo apruebe **la persona que no lo abrió**.

---

## Paso 0 · Preparación (antes de la clase)

**Ambos**, en su computador:

```bash
node -v        # debe ser 22.13 o superior
git config --global user.name  "Nombre Apellido"
git config --global user.email "el-mismo-correo-de-su-cuenta-de-github@ejemplo.com"
```

> Si el correo no coincide con el de GitHub, los commits **no se le atribuyen** a esa persona y parecerá que todo lo hizo una sola.

Descompriman el `.zip` entregado en una carpeta **aparte** (por ejemplo `~/entrega-ia/`). **No** es el repositorio: de ahí se copian los archivos por etapas.

**Matías** crea el repositorio vacío en GitHub (sin README), lo clona y sube la base del proyecto:

```bash
git clone https://github.com/USUARIO/REPOSITORIO.git
cd REPOSITORIO
# copiar desde ~/entrega-ia/: package.json, package-lock.json, .gitignore,
# .gitattributes, .nvmrc, .env.example, LICENSE
git add .
git commit -m "chore: estructura base del proyecto (Node 22, dependencias)"
git push origin main
```

Luego, en **Settings → Collaborators**, invita a Luis Carlos. **Luis Carlos acepta la invitación** y clona el repositorio.

---

## Paso 1 · Arranque del pipeline (primero el CI, después el código)

**Luis Carlos:**

```bash
git checkout -b feature/HU-01-gestion-inventario
# copiar .github/workflows/ci.yml
git add .github/workflows/ci.yml
git commit -m "ci: pipeline de integración continua (build, pruebas y npm audit)"
git push -u origin feature/HU-01-gestion-inventario
```

Abran la pestaña **Actions**: el pipeline se ejecuta y **queda en rojo**, porque todavía no hay código ni pruebas (`npm run build` no encuentra `scripts/build.js`). **Tomen una captura de pantalla de este rojo**: sirve para la retrospectiva.

---

## Paso 2 · Construcción (commits alternados en la misma rama)

Antes de **cada** commit, cada uno hace `git pull` para traer lo del compañero. Después de **cada** push, revisen la pestaña Actions.

| # | Quién | Archivos que copia desde `~/entrega-ia/` | Mensaje de commit |
|---|---|---|---|
| 1 | Matías | `src/db/schema.sql`, `src/db/connection.js`, `src/shared/errors.js` | `feat(db): esquema de repuestos e historial de movimientos` |
| 2 | Matías | `src/modules/inventario/repuesto.validator.js`, `src/modules/inventario/csv.js` | `feat(inventario): validación de repuestos y lector de CSV` |
| 3 | Luis Carlos | `tests/unit/repuesto.validator.test.js`, `tests/unit/csv.test.js` | `test: pruebas unitarias del validador y del CSV` |
| 4 | Matías | `src/modules/inventario/repuesto.repository.js`, `repuesto.service.js`, `repuesto.routes.js`, `src/shared/errorHandler.js`, `src/app.js`, `src/server.js`, `scripts/build.js` | `feat(inventario): API REST de repuestos con historial` |
| 5 | Luis Carlos | `tests/integration/repuestos.api.test.js` | `test: pruebas de integración de la API de repuestos` |
| 6 | Luis Carlos | `tests/aceptacion/HU01.criterio-aceptacion.test.js` | `test: prueba de aceptación HU-01 (Dado/Cuando/Entonces)` |
| 7 | Matías | `public/index.html`, `public/styles.css`, `public/app.js` | `feat(ui): pantalla de inventario con varilla de nivel de stock` |
| 8 | Matías | `ejemplos/repuestos-ejemplo.csv`, `scripts/seed.js` | `feat: datos de ejemplo y script de seed` |
| 9 | Luis Carlos | `.github/pull_request_template.md` | `chore: plantilla de pull request` |

Comandos para cada fila (ejemplo de la fila 3):

```bash
git pull
# copiar los archivos de la fila
git add tests/unit/repuesto.validator.test.js tests/unit/csv.test.js
git commit -m "test: pruebas unitarias del validador y del CSV"
git push
```

Desde el commit 4, en local deberían ver esto:

```bash
npm ci
npm run build
npm test
```

**Prueben la historia a mano** (casilla "Historia implementada y probada a mano"):

```bash
npm run seed
npm start          # abrir http://localhost:3000
```

Intenten guardar un repuesto con stock `-3` y vean cómo se rechaza. Luego creen, editen, den de baja e importen el CSV de `ejemplos/`.

El pipeline pasa a **verde ✅ desde el commit 4**, cuando el backend ya se construye. Al terminar el commit 9 sigue en verde, con las 28 pruebas.

---

## Paso 3 · Revisión e integración

### PR #1: la historia

1. **Matías** abre el PR: **Pull requests → New** → base `main` ← compare `feature/HU-01-gestion-inventario`. Título: `HU-01 Gestión de inventario de repuestos`. Llena la plantilla.
2. **Luis Carlos** revisa en **Files changed**. Debe dejar al menos un comentario real en una línea (por ejemplo, una pregunta sobre la baja lógica o sobre la carga CSV "todo o nada"). Luego va a **Review changes → Approve**.
3. Con el check en verde y la aprobación, **Matías** pulsa **Merge pull request**.

### PR #2: README y documentación

```bash
git checkout main && git pull
git checkout -b docs/readme-y-arquitectura
# copiar README.md, docs/ARQUITECTURA.md, docs/GUIA_TALLER.md
```

En `README.md`, reemplacen las dos apariciones de `USUARIO/REPOSITORIO` (en el badge y en el `git clone`) por el usuario y el nombre real del repositorio.

```bash
git add README.md docs/
git commit -m "docs: README con instalación, pruebas, estado del CI y declaración de uso de IA"
git push -u origin docs/readme-y-arquitectura
```

**Luis Carlos** abre el PR #2, **Matías** lo revisa y lo aprueba, y se fusiona con el pipeline en verde.

### (Recomendado) Proteger `main`

En **Settings → Branches → Add rule** para `main`, activen:

- *Require a pull request before merging* (con 1 aprobación).
- *Require status checks to pass*, y seleccionen **Build y pruebas** y **Análisis de vulnerabilidades**.

Así GitHub no deja fusionar nada en rojo.

---

## Paso 4 · Entrega

1. Abran **Actions** y luego la última ejecución sobre `main`. Tomen una **captura con los dos jobs en verde**.
2. Suban al aula digital el **enlace del repositorio** y la **captura**.
3. Antes de entregar, verifiquen:

```bash
git log --format="%an" | sort | uniq -c   # deben aparecer los dos nombres
git ls-files | grep -i "\.env$"           # no debe mostrar nada
```

---

## Retrospectiva (3 minutos)

Ideas reales de lo que se rompió durante el desarrollo, para que las cuenten con sus palabras:

1. **El primer push quedó en rojo a propósito.** El workflow existía antes que el código, y `npm run build` falló porque no había nada que construir. Así comprobamos que el pipeline detecta los problemas.
2. **La base de datos no instalaba en todas las máquinas.** La primera opción, `better-sqlite3`, necesita compilar código nativo y fallaba sin herramientas de compilación. Se cambió por el SQLite integrado en Node (`node:sqlite`): cero dependencias nativas y el mismo comportamiento local y en CI. Es justo el problema de "pasa en mi máquina pero no en otra" que la integración continua ayuda a evitar.
3. **La tabla desbordaba la pantalla en el celular.** Un elemento oculto de accesibilidad se salía del contenedor. Se corrigió con CSS y se verificó en un ancho de móvil.
4. **Se comprobó que las pruebas sí detectan errores.** Al relajar a propósito la regla de stock negativo, fallaron 5 pruebas. Esa es la evidencia de que las pruebas verifican el comportamiento y no solo que el código arranca.

---

## Checklist del taller

| ✓ | Punto de control | Responsable / evidencia |
|---|---|---|
| □ | Historia Must elegida y roles repartidos | HU-01. Roles en esta guía |
| □ | Rama creada y archivo ci.yml en el repositorio | Luis Carlos. Rama `feature/HU-01-gestion-inventario` |
| □ | Primer push hecho: el pipeline se ejecutó (aunque sea en rojo) | Luis Carlos. Captura del rojo |
| □ | Historia implementada y probada a mano | Matías. `npm start` |
| □ | Tres pruebas automatizadas escritas y pasando | Luis Carlos. 28 pruebas en 4 suites |
| □ | Pull request abierto, revisado y aprobado por otro integrante | PR #1 (aprueba Luis Carlos) y PR #2 (aprueba Matías) |
| □ | Fusión a main con el pipeline en verde | Pestaña Actions |
| □ | README actualizado + nota de uso de IA | PR #2 |
| □ | Commits de todos los integrantes verificados | `git log --format="%an"` |
| □ | Enlace y captura subidos al aula digital | Ambos |

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| `npm ci` dice que el lock no coincide | No editen `package.json` a mano. Si agregaron una dependencia, hagan `npm install` y suban también `package-lock.json` |
| `node:sqlite` no existe | La versión de Node es vieja. Instalen Node 22 LTS (`node -v` ≥ 22.13) |
| Falla en CI pero pasa local | Revisen que todos los archivos estén en el commit con `git status`. Casi siempre falta subir un archivo |
| No puedo hacer push | Acepten la invitación de colaborador en GitHub o en el correo |
| Conflicto al hacer `git pull` | Siguiendo la tabla nadie toca el mismo archivo. Si pasa, resuélvanlo juntos en un mismo computador |
