# Frontend de veredas

## Estructura

- `app.js`: orquestación, datos, mapa y tableros.
- `js/auth.js`: validación de sesión y cierre de sesión.
- `js/dom.js`: acceso centralizado al DOM.
- `js/dashboard-actions.js`: asociación de acciones de interfaz con la lógica.
- `js/supply-search.js`: cliente validado del buscador de suministros.
- `api/suministro.js`: API autenticada de búsqueda exacta en Supabase.
- `scripts/sync_suministros.py`: sincronizador independiente del maestro local.
- `styles.css`: presentación visual.

Los módulos se cargan de forma nativa en el navegador (`type="module"`). Mapa, reportes y carga de datos continúan en `app.js` para conservar el comportamiento actual; se pueden extraer después sin cambiar la interfaz.

Vista independiente de mapa, filtros, indicadores, tabla paginada y exportación.

Toma los registros procesados de `data/veredas.json`. Para actualizar esa fuente desde el export SAP, ejecuta desde la carpeta raíz:

```powershell
python -m backend.orchestrator --solo-procesar
```

El procesador cruza automáticamente el export con el maestro `INFO DE SED.xlsx`, deriva SED, contratista, estado y coordenadas. La publicación del reporte a Google Sheets mantiene su flujo actual.

## Sincronización independiente de suministros

El catálogo completo de suministros se guarda en una tabla privada de Supabase y no se publica en Google Sheets ni se descarga al navegador. La web consulta únicamente el código solicitado mediante `/api/suministro`.

La primera vez, instala la dependencia del sincronizador desde la carpeta raíz del proyecto:

```powershell
python -m pip install -r frontend/scripts/requirements.txt
```

Después de actualizar localmente `runtime/base_veredas.sqlite`, ejecuta de manera independiente:

```powershell
python frontend/scripts/sync_suministros.py
```

El comando lee `frontend/.env.local`, verifica la firma y el conteo del maestro y omite la carga si Supabase ya tiene la misma versión. Para repetirla deliberadamente:

```powershell
python frontend/scripts/sync_suministros.py --force
```

La sincronización no ejecuta el orquestador ni modifica Google Sheets. No compartas ni incluyas `.env.local` en el repositorio.

Para verlo localmente desde la carpeta raíz del proyecto:

```powershell
python -m http.server 8080
```

Luego abre `http://localhost:8080/frontend/`. Para probar también las funciones de Vercel localmente, usa `vercel dev` dentro de `frontend`.
