# Frontend de veredas

Vista independiente de mapa, filtros, indicadores, tabla paginada y exportación.

Toma los registros procesados de `data/veredas.json`. Para actualizar esa fuente desde el export SAP, ejecuta desde la carpeta raíz:

```powershell
python procesar_export_veredas.py
```

El procesador cruza automáticamente el export con el maestro `INFO DE SED.xlsx`, deriva SED, contratista, estado y coordenadas. No descarga ni sube información a servicios externos.

Para verlo localmente desde la carpeta raíz del proyecto:

```powershell
python -m http.server 8080
```

Luego abre `http://localhost:8080/frontend/`.

Cuando el proceso de carga a Google Sheets esté listo, se sustituye la función `loadRows()` de `app.js` por el lector del CSV publicado; el resto del frontend no cambia.
