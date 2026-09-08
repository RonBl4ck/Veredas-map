# Diseño: búsqueda geográfica por suministro

Fecha: 2026-09-08

## Objetivo

Permitir que un usuario autenticado busque cualquier código de suministro del maestro local y centre el mapa web en sus coordenadas, sin cargar el catálogo completo en el navegador y sin modificar el flujo existente de Google Sheets.

## Alcance

- Sincronizar de forma explícita e independiente el maestro local `suministro -> coordenadas` hacia Supabase.
- Guardar aproximadamente 1.65 millones de suministros en una tabla privada con búsqueda exacta indexada.
- Exponer una función protegida de Vercel para consultar un suministro.
- Agregar al mapa un buscador independiente que centre la vista y muestre un marcador temporal.
- Mantener intactos el procesamiento y la publicación actual del reporte en Google Sheets.

No forma parte de este alcance publicar todos los suministros como marcadores, modificar las columnas del reporte ni relacionar históricamente cada suministro con todos sus tickets.

## Arquitectura

```text
Maestro Excel
    |
    v
SQLite local: maestro_suministros
    |
    | comando independiente de sincronización
    v
Supabase Postgres: private.suministros
    ^
    | consulta exacta parametrizada
Vercel Function: GET /api/suministro?codigo=...
    ^
    | sesión web existente
Mapa: campo "Ubicar suministro"
```

Google Sheets permanece en un flujo separado y no participa en ninguna etapa de esta búsqueda.

## Persistencia

La tabla `private.suministros` tendrá:

- `suministro text primary key`
- `latitud double precision not null`
- `longitud double precision not null`
- `actualizado_en timestamptz not null`

La clave primaria proporciona el índice necesario para búsquedas exactas. La tabla vive en un esquema privado y no se concederá acceso a los roles públicos `anon` o `authenticated`. Las coordenadas se validarán dentro del área geográfica admitida por el proceso actual.

Una tabla de metadatos conservará la firma de la fuente, cantidad de registros y fecha de sincronización. El comando podrá omitir una carga idéntica y aceptar `--force` para repetirla deliberadamente.

## Sincronizador local

El sincronizador será un comando independiente del orquestador y de Google Sheets. Leerá por lotes la tabla SQLite `maestro_suministros`, cargará una tabla temporal mediante `COPY` y aplicará el reemplazo dentro de una transacción. De ese modo, la API seguirá viendo la versión anterior hasta que la nueva carga esté completa.

El comando mostrará únicamente métricas operativas —registros leídos, escritos, omitidos y duración— y nunca imprimirá credenciales. Usará la conexión no agrupada de Supabase disponible en `frontend/.env.local`.

## API de Vercel

`GET /api/suministro?codigo=<codigo>`:

- reutiliza `requireSession` y responde `401` sin sesión válida;
- acepta solo `GET` y devuelve `405` en otros métodos;
- normaliza y valida el código antes de consultar;
- ejecuta una consulta SQL parametrizada contra la conexión agrupada;
- devuelve `200` con `suministro`, `latitud` y `longitud`;
- devuelve `404` si el código no existe;
- devuelve errores genéricos al navegador, sin detalles de conexión;
- usa `Cache-Control: no-store`.

La función usa Node.js y mantiene la credencial exclusivamente en el servidor.

## Experiencia en el mapa

El panel del mapa tendrá un campo separado llamado `Ubicar suministro`, con búsqueda por botón o tecla Enter. Al encontrarlo:

- se elimina cualquier marcador de suministro anterior;
- se crea un marcador visualmente distinto de las órdenes y direcciones;
- el mapa se centra con un nivel de acercamiento apropiado;
- el popup muestra el código y las coordenadas;
- aparece una acción para retirar el marcador.

La búsqueda no altera los filtros ni los marcadores de órdenes. Los estados de cargando, no encontrado, código inválido y error de red serán visibles y accesibles.

## Verificación

- Pruebas unitarias de validación y contrato HTTP de la API.
- Pruebas del lector y de la detección de sincronización del comando local.
- Migración e importación real verificadas con conteos y una consulta de muestra.
- Verificación del flujo web completo: iniciar sesión, buscar un suministro existente, confirmar centrado/marcador y probar uno inexistente.
- Despliegue de producción después de superar las pruebas locales y la revisión del diff.

## Decisiones aprobadas

- Supabase está separado de Google Sheets.
- La sincronización se ejecuta mediante un comando independiente.
- El navegador consulta un solo suministro por vez a través de una API protegida.
- El catálogo completo no se descarga ni se dibuja en el cliente.
