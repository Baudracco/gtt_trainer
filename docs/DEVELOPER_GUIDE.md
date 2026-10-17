# Guía para continuar el desarrollo

## Entorno y arranque

El camino reproducible es Docker Compose: Nginx, PHP 8.3-FPM, PostGIS y worker.
[Instalación](../README.md). Para desarrollo local usar Node 24, Composer 2 y Python
3.12; las extensiones PHP y herramientas de video están en `server/Dockerfile`.
[Comandos sin Docker para web/PHP](OPERATIONS.md).

No hay SDK de rutas ni dependencia de tráfico. Las bibliotecas principales son
MapLibre para mapa, Photo Sphere Viewer para panoramas, Dompdf para PDF y PDO para
Postgres. Los lockfiles fijan dependencias reproducibles. TypeDoc y Prettier son
herramientas de desarrollo, no servicios necesarios para ejecutar la app.

## Mapa del repositorio

| Ruta | Contrato y punto de entrada |
| --- | --- |
| `web/src/main.tsx` | Estado de catálogo/editor, historial y exclusión GPS/virtual |
| `web/src/model.ts` | Documentos, snapshots, paradas y agrupación de pertenencias |
| `web/src/geometry.ts` | Medición/proyección GPS y sugerencias geométricas revisables |
| `web/src/recording.ts`, `GpsRecorder.tsx` | Captura GPS local, filtros, tramos separados y exportación GPX |
| `web/src/RouteMap.tsx` | WebGL y eventos de mapa, sin reemplazar geometría |
| `web/src/Editor.tsx` | Formulario completo y orden explícito |
| `web/src/VirtualTour.tsx`, `StreetPhoto.tsx`, `virtual.ts` | Reproducción fija, carga cancelable y visor 360° |
| `web/src/api.ts` | Envoltorio same-origin, CSRF, fallos con trace y uploads |
| `web/src/cache.ts`, `web/public/sw.js` | Publicaciones offline y shell separado de API/medios |
| `server/public/index.php` | Despacho HTTP, permisos, contrato JSON y captura de fallos |
| `server/src/RouteRepository.php` | Transacciones, revisiones, publicación e identidades canónicas |
| `server/src/RouteValidator.php` | Normalización y límites; no corrige caminos |
| `server/src/Auth.php`, `RateLimiter.php` | Sesión/CSRF/roles y presupuestos compartidos |
| `server/src/GtfsSynchronizer.php` | Ingestión confiable CLI, adopción y conflictos |
| `server/src/StreetView.php`, `FixedGeometry.php` | Metadatos Panoramax sobre coordenadas guardadas |
| `server/src/MediaRepository.php`, `Report.php` | Uploads privados, streaming y reportes ilustrados |
| `server/src/ErrorCatalog.php`, `ErrorLogger.php`, `FileLock.php` | Números estables, diagnósticos y lock acotado |
| `server/migrations` | Esquema, constraints/triggers y evolución por checksum |
| `tools/sync_gtfs.py` | Único dueño de la descarga/cooldown/hash del feed |
| `tools/import_routes.py` | Conversión conservando formas/patrones; nunca publica |
| `tools/extract_depot_reference.py` | Texto DAPER por columnas/páginas, sin geometría inventada |
| `tools/extract_depot_movements.py` | Movimientos individuales por encabezados del PDF, partes pequeñas y hashes |
| `data` | Catálogos/manifiestos versionados y estado de descarga semilla |
| `server/src/ReferenceRepository.php`, `server/var/references` | Lectura autenticada del material operativo privado, excluido de Git |
| `.github/workflows/ci.yml` | Pruebas, Docker completo y referencias documentales |

## Cambiar una funcionalidad

Crear rama desde `main` actualizado. Mantener documento fuente, API, UI y pruebas
coherentes. Un cambio de esquema se añade como otra migración; nunca modificar una
ya aplicada. Modificar un documento publicado se implementa creando una nueva
revisión, incluso cuando parezca una corrección pequeña.

El API valida la entrada y autoriza antes de llamar al repositorio. El repositorio
recibe documentos normalizados y usa consultas preparadas. Los medios se validan
y vinculan dentro de la transacción de la nueva revisión. Un fallo de auditoría
revierte el cambio de negocio; los diagnósticos de error usan otras salidas.

Las coordenadas siempre son `[longitud, latitud]`. Los offsets se expresan en metros,
el rumbo en grados desde norte y el tiempo GPS en milisegundos epoch. Guardar orden
es preferible a ordenar para ocultar una fuente incorrecta. Los nombres de sentidos
requieren evidencia operativa: 0/1 son etiquetas del feed, no una traducción segura.

No enviar fixes al API. El lookup de fotos recibe revisión y distancia, no ubicación
del dispositivo. No usar texto/HTML del proveedor como instrucción de conducción.
No generar geometrías desde nombres de calles sin trazado y comprobación explícitos.
La captura editorial solo envía coordenadas al guardar explícitamente el borrador;
no añade telemetría ni un endpoint GPS. [Contrato de grabación](GPS_RECORDING.md).

## Pruebas por responsabilidad

```sh
npm --prefix web ci
npm --prefix web test
npm --prefix web run build
npm --prefix web exec playwright install chromium
npm --prefix web run test:e2e
python3 -m pip install -r tools/requirements.txt openapi-spec-validator
python3 tools/test_imports.py
python3 tools/test_audit_routes.py
python3 tools/test_sync_gtfs.py
python3 -m openapi_spec_validator docs/openapi.yaml
```

Para PHP, instalar Composer en `server` y ejecutar `php server/tests/run.php`.
Sin `TEST_DATABASE_DSN`, se ejecutan validadores, PDF y lock/diagnósticos de archivo;
la salida indica que PostGIS se omitió. Para integración usar una DB **descartable**,
configurar también DATABASE_USER/PASSWORD y ejecutar el mismo comando, seguido de
`python3 server/tests/test_http.py`. Este último usa puerto 8089, crea cuentas/datos
sintéticos y prueba roles, CSRF, publicaciones, medios reales y rangos.

Las pruebas Python de sincronización inyectan reloj y transporte: no descargan GTT
ni consumen su ventana. Las PHP de Panoramax inyectan HTTP y usan PostGIS real para
la caché. El E2E usa WebGL/Photo Sphere Viewer reales, tiles vacíos y un panorama
sintético marcado. El GPS se usa a través de permisos/fixes nativos del navegador.
La captura continua del editor también se prueba con callbacks controlados: el
override nativo de Chromium emite un error temporal al cambiar de posición en CI.
La prueba nativa comprueba ese error, recuperación, pausas y GPX de puntos aislados;
la prueba continua mantiene WebGL real y verifica el guardado explícito del tramo.
No confundir la emulación móvil con una prueba en calle en un teléfono.

CI levanta además Docker completo, carga automáticamente las 633 candidatas, sube
foto/video por HTTP y comprueba Nginx interno/rangos, publicación y PDF. Las descargas
GTT están pausadas solo en CI mediante `GTFS_DOWNLOAD_ENABLED=0`.

## Comentarios y referencias

Documentar clases y métodos públicos PHP con `/** ... */`, explicando contrato,
unidades, invariantes, excepciones y efectos. JSDoc cumple el mismo propósito en el
dominio TypeScript. Los importadores/worker usan docstrings Python. Evitar comentarios
que repitan literalmente la línea siguiente; explicar las decisiones menos obvias.

`sh tools/generate_docs.sh` produce las referencias. El generador PHP falla si falta
un DocBlock público; TypeDoc falla ante símbolos públicos sin documentar en sus
entry points. [Configuración y mantenimiento](CODE_DOCUMENTATION.md).

`npm --prefix web run format` aplica Prettier; `format:check` verifica el formato en
CI. No cambiar el orden de los arrays de ruta por una decisión de presentación.

## Diagnóstico y contribuciones

Cada fallo HTTP tiene un `trace_id` y cabecera X-Trace-Id. Los números GTT 2001–2019/
2099 se mantienen estables. Nuevos errores se añaden al catálogo y OpenAPI; no
reciclar significados. Nunca registrar password, cookies, cuerpos completos, SQL
con parámetros ni coordenadas GPS. El log conserva tipo/SQLSTATE/archivo base/línea.

Subir una PR directamente a `main`, con el problema/comportamiento y validación.
Esperar los checks del commit exacto antes del merge. Las decisiones y datos
pendientes se actualizan en ROADMAP/SOURCES, no solo en el chat. No publicar claves,
.env, ZIP externos innecesarios ni el material original privado del usuario.
