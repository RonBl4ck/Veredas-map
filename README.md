# Frontend de veredas

## Estructura

- `app.js`: orquestación, datos, mapa y tableros.
- `js/auth.js`: validación de sesión y cierre de sesión.
- `js/dom.js`: acceso centralizado al DOM.
- `js/dashboard-actions.js`: asociación de acciones de interfaz con la lógica.
- `styles.css`: presentación visual.

Los módulos se cargan de forma nativa en el navegador (`type="module"`). Mapa, reportes y carga de datos continúan en `app.js` para conservar el comportamiento actual; se pueden extraer después sin cambiar la interfaz.

Vista independiente de mapa, filtros, indicadores, tabla paginada y exportación.

Toma los registros procesados de `data/veredas.json`. Para actualizar esa fuente desde el export SAP, ejecuta desde la carpeta raíz:

```powershell
python -m backend.orchestrator --solo-procesar
```

El procesador cruza automáticamente el export con el maestro `INFO DE SED.xlsx`, deriva SED, contratista, estado y coordenadas. No descarga ni sube información a servicios externos.

Para verlo localmente desde la carpeta raíz del proyecto:

```powershell
python -m http.server 8080
```

Luego abre `http://localhost:8080/frontend/`.

Cuando el proceso de carga a Google Sheets esté listo, se sustituye la función `loadRows()` de `app.js` por el lector del CSV publicado; el resto del frontend no cambia.
