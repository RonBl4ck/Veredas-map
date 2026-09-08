# Plan de implementación: búsqueda por suministro

> Ejecutar cada bloque con TDD: escribir la prueba observable, comprobar que falla por la ausencia del comportamiento, implementar lo mínimo y volver a ejecutar.

**Objetivo:** sincronizar independientemente el maestro SQLite hacia Supabase y permitir búsquedas exactas y protegidas desde el mapa.

**Arquitectura:** un script Python realiza una carga transaccional por `COPY` a un esquema privado; una función Node.js de Vercel consulta por clave primaria mediante la conexión agrupada; el navegador solicita un único suministro y dibuja un marcador independiente.

## Tarea 1: contrato del API y acceso a Postgres

**Archivos:**

- Crear: `package.json`
- Crear: `package-lock.json`
- Crear: `server/suministros.js`
- Crear: `api/suministro.js`
- Crear: `tests/suministro-api.test.js`

1. Escribir pruebas para método inválido, sesión ausente, código inválido, suministro inexistente, respuesta exitosa y error interno sanitizado.
2. Ejecutar `npm test` y observar fallos por módulos inexistentes.
3. Implementar normalización numérica, manejador inyectable y consulta SQL parametrizada mediante `postgres` con `prepare: false`.
4. Ejecutar `npm test` hasta obtener cero fallos.

## Tarea 2: esquema privado y sincronizador independiente

**Archivos:**

- Crear: `supabase/migrations/20260908000000_create_suministros.sql`
- Crear: `scripts/sync_suministros.py`
- Crear: `scripts/requirements.txt`
- Crear: `tests/test_sync_suministros.py`

1. Crear fixtures SQLite pequeñas y escribir pruebas de firma, lectura por lotes, validación de filas y detección de una fuente ya sincronizada.
2. Ejecutar `python -m unittest tests/test_sync_suministros.py` y observar fallos por módulo inexistente.
3. Implementar carga de variables, lectura SQLite y sincronización transaccional por tabla temporal + `COPY` + upsert + eliminación de obsoletos.
4. Ejecutar las pruebas Python hasta obtener cero fallos.
5. Instalar la dependencia fijada, aplicar el esquema y cargar el maestro real mediante rutas explícitas.
6. Verificar el conteo remoto y búsquedas de muestra con consultas parametrizadas.

## Tarea 3: buscador y marcador independiente en el mapa

**Archivos:**

- Crear: `js/supply-search.js`
- Crear: `tests/supply-search.test.js`
- Modificar: `index.html`
- Modificar: `app.js`
- Modificar: `styles.css`

1. Escribir pruebas para normalización de entrada, manejo de respuestas HTTP y rechazo de coordenadas inválidas.
2. Ejecutar `npm test` y observar fallos por módulo inexistente.
3. Implementar el cliente del endpoint y conectar el nuevo campo, estados accesibles, marcador, centrado y limpieza sin alterar filtros de órdenes.
4. Ejecutar `npm test` y validaciones sintácticas.

## Tarea 4: documentación, despliegue y verificación completa

**Archivos:**

- Modificar: `README.md`

1. Documentar instalación y comando independiente de sincronización, sin incluir secretos.
2. Enlazar el worktree al proyecto `veredas-map` y comprobar variables por nombre.
3. Ejecutar pruebas Node y Python, `git diff --check` y validación sintáctica completa.
4. Desplegar a vista previa y probar API/UI; corregir cualquier regresión.
5. Desplegar a producción y repetir búsqueda existente/inexistente con sesión autenticada.
6. Revisar el diff completo, confirmar que Google Sheets no cambió y registrar evidencias finales.
