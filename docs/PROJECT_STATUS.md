# Estado del proyecto y punto para retomar

Actualizado: **17/10/2026**. Este es el primer documento que se lee al continuar.
Resume el conocimiento ya comprobado; consultar los manuales y archivos indicados
solo para el área que vaya a cambiar. Se actualiza en el mismo PR que modifica el
estado, las pruebas o los pendientes. No sustituye el código ni una comprobación de
cambios posteriores.

## Punto de control verificado

- Repositorio: [Baudracco/gtt_trainer](https://github.com/Baudracco/gtt_trainer).
- Rama de integración: `main`; ramas nuevas desde `main` actualizado, PR directo y
  merge tras comprobar CI. El usuario autorizó esas acciones autónomas.
- Última entrega funcional: [PR #18](https://github.com/Baudracco/gtt_trainer/pull/18),
  grabación GPS por tramos. Merge `6c19f58981e922be5ddb6b322d548c0e86533322`;
  árbol funcional `10de62e72a8abf676528a91d33ab4eccbb8c8002`.
- [CI verificada](https://github.com/Baudracco/gtt_trainer/actions/runs/39036697756):
  cinco jobs correctos: frontend, servidor/PostGIS, fuentes/contrato, documentación
  y Docker. Pasaron 50 pruebas Vitest, 18 Chromium de escritorio/móvil y 81
  comprobaciones HTTP. Docker comprobó importación, medios/PDF, backup/restauración
  y configuración HTTPS. Se revisaron las capturas de escritorio y móvil.
- Esto verifica implementación e integración con datos sintéticos. La precisión,
  batería y suspensión de un teléfono físico siguen pendientes. No consta un
  despliegue operativo en un host/dominio de producción.

La referencia del merge es la última entrega **funcional**, no el hash del propio
documento; un PR solo documental puede conservarla. Registrar aquí la siguiente
entrega funcional y sus resultados cuando se comprueben.

## Qué ya está implementado

| Área | Capacidad disponible | Dónde continuar o consultar |
| --- | --- | --- |
| Interfaz | React/TypeScript, ES/IT/EN, tema, móvil/escritorio, shell instalable | `web/src/main.tsx`, [uso](USER_GUIDE.md) |
| Mapa | MapLibre real; superposición, todos/ninguno/seleccionados, filtro exacto de línea, una revisión activa | `RouteMap.tsx`, `model.ts` |
| Paradas | Identidad compartida, pertenencias ordenadas y repetidas, cambio/sentido/notas por pertenencia | `model.ts`, `RouteRepository.php` |
| Editor e historial | Vértices explícitos, paradas, instrucciones y observaciones; borrador/revisión/publicación, versiones concurrentes, historial, reversión y papelera | `Editor.tsx`, `RouteRepository.php`, [arquitectura](ARCHITECTURE.md) |
| API y acceso | PHP 8.3-FPM, sesiones/roles, CSRF/Origin, Argon2id, límites, URLs amigables, contrato OpenAPI y errores con número/trace | `server/public/index.php`, [OpenAPI](openapi.yaml) |
| Persistencia | PostGIS 16, snapshots completos, triggers de publicación inmutable, auditoría append-only y migraciones con checksum | `server/migrations`, `server/src/RouteRepository.php` |
| Navegación GPS | Proyección local sobre trazado fijo, ancla, avance/rumbo/precisión/edad, desvíos, sentido contrario, voz y recuperación temporal de señal | `geometry.ts`, `main.tsx`, [uso](USER_GUIDE.md) |
| Grabación GPS | Captura local en memoria, filtros, pausas/cortes separados, mapa verde, GPX, copia explícita de un tramo al borrador vacío y conservación de evidencia | `recording.ts`, `GpsRecorder.tsx`, [grabación](GPS_RECORDING.md), PR #18 |
| Estudio virtual | Panoramax y visor 360°, avance manual/automático de 5–120 km/h, atribución y huecos de cobertura | `VirtualTour.tsx`, `StreetPhoto.tsx`, [contrato](VIRTUAL_TOURS.md), PR #10 |
| Medios y reportes | Referencia escrita y hasta tres fotos por giro, video completo, velocidad 0,25×–4×, uploads privados/rangos y reportes HTML/PDF | `MediaRepository.php`, `Report.php`, [medios](MEDIA_AND_URLS.md), PR #9 |
| GTFS automático | Worker Docker, SHA-256, HTTP condicional, reserva persistente mínima de 24 h también ante fallos, flock, último bundle bueno e ingestión idempotente como borradores | `tools/sync_gtfs.py`, `GtfsSynchronizer.php`, [sincronización](GTFS_SYNC.md), PR #7 |
| Auditoría de repeticiones | Comparación exacta/acotada, informe automático sobre el bundle retenido, panel de candidatos y A/B de revisiones actuales | `tools/audit_routes.py`, `RouteComparison.tsx`, [auditoría](ROUTE_AUDIT.md), PR #17 |
| Referencias privadas | Importación local DAPER, movimientos individuales con página/hash/texto, catálogo autenticado y vínculo conservado por revisión | `ReferenceRepository.php`, `References.tsx`, [movimientos](DEPOT_MOVEMENTS.md), PR #13 |
| Sin conexión | Shell y publicaciones actuales; evidencia privada excluida de respuestas públicas y caché offline | `cache.ts`, `web/public/sw.js`, [arquitectura](ARCHITECTURE.md) |
| Operación | Nginx + PHP-FPM + PostGIS; copias diarias verificadas, retención y restauración aislada; override HTTPS con Caddy | [copias](BACKUPS.md), [HTTPS](PRODUCTION_HTTPS.md), PR #14/#15 |
| Mantenimiento | Manuales, DocBlocks PHP, TypeDoc/JSDoc y AST Python generados en CI; diagnósticos saneados redundantes | [desarrollo](DEVELOPER_GUIDE.md), [documentación](CODE_DOCUMENTATION.md), PR #11 |

Los nombres de frontend de la tabla están bajo `web/src`; los PHP, bajo `server/src`
salvo que se indique otra ruta. La procedencia de los patrones adaptados del otro
proyecto ya está documentada en [Shortener](SHORTENER_REUSE.md); no hace falta
reconsultar su repositorio privado para continuar GTT.

## Datos incorporados y qué significan

- Catálogo efectivo: **633 registros de variante** de **137 códigos de línea**,
  581 de bus y 52 de tranvía en el snapshot GTFS 20261013. Incluye las 139 variantes
  del primer lote relacionado con Gerbido. Son candidatas en borrador.
- No equivalen a 633 recorridos operativos únicos. La auditoría encontró tres pares
  exactos dentro de su línea: 630 grupos por línea; además, seis pares compartidos
  entre líneas, 624 grupos globales. Se conservan identidades e historial; no se
  eliminan variantes por parecido. Evidencia: `data/gtfs-duplicate-audit.json`.
- Se recuperaron 31 patrones antes rechazados y se corrigió un offset de línea 14.
  Las 32 secuencias contrastadas coinciden con las tablas oficiales GTT. Esto no
  acredita todos los giros, plataformas ni sentidos operativos del catálogo.
- Los PDF e imágenes del operador y sus extractos viven en la instalación privada,
  fuera de Git/assets. El código y CI usan ejemplos sintéticos. La disponibilidad
  de un documento en una sesión no significa que venga incluido al clonar Git.
- El catálogo DAPER separa movimientos y conserva evidencia; el texto por sí solo
  **no es una geometría GPS**. Las combinaciones de transporte del personal para
  llegar a un cambio no son el movimiento del autobús fuera de servicio.

## Trabajo activo y siguiente paso concreto

**Elegido: revisión y resolución de conflictos GTFS dentro de la aplicación.**
Está planificado; todavía no está implementado en el punto de control anterior.
Actualmente `GtfsSynchronizer::status()` enumera conflictos y `pending()` entrega el
documento entrante para exportar. `SyncStatus.tsx` ofrece esa descarga. La comparación
A/B existente compara revisiones locales guardadas, no una propuesta entrante.

Al continuar esta tarea:

1. Añadir inspección de documento local/propuesta y resolución explícita: conservar
   lo local o crear otro borrador de la **misma variante** con la propuesta.
2. Controlar tanto la versión de la variante como la identidad/hash de la propuesta.
   Serializar con la ingestión GTFS, conservar auditoría, historial y publicación.
3. Integrar comparación en el mapa y decisiones en el panel de fuentes. No importar
   el JSON como otra variante para resolver un conflicto, porque duplicaría registros.
4. Probar permisos/CSRF, conflictos concurrentes, rollback, publicación inmutable,
   repetición del feed y flujo de interfaz. Actualizar OpenAPI y manuales junto al código.

Puntos de entrada: `server/src/GtfsSynchronizer.php`, `server/public/index.php`,
`server/tests/gtfs.php`, `server/tests/test_http.py`, `web/src/SyncStatus.tsx`,
`web/src/RouteComparison.tsx`, `web/src/main.tsx`, `docs/GTFS_SYNC.md`.

## Pendientes que no deben darse por terminados

| Pendiente | Dependencia o comprobación restante | Registro |
| --- | --- | --- |
| Geometrías de movimientos DAPER | Calles, orden, accesos, condiciones y restricciones verificadas para cada movimiento | [#3](https://github.com/Baudracco/gtt_trainer/issues/3) |
| Puestos Gerbido | Parada/plataforma exacta, sentido operativo y anotaciones dudosas de la fuente | [#4](https://github.com/Baudracco/gtt_trainer/issues/4) |
| Giros y sentidos GTFS | Evidencia operativa; GTFS 0/1 no prueba andata/ritorno | [#5](https://github.com/Baudracco/gtt_trainer/issues/5) |
| Próximos PDF | El usuario aún debe aportar los PDF de tranvías, servicio y turnos/horarios consolidados | [#6](https://github.com/Baudracco/gtt_trainer/issues/6) |
| Consolidación de duplicados | Resolver equivalencia operativa y diseñar alias sin borrar historial ni ediciones | [#16](https://github.com/Baudracco/gtt_trainer/issues/16) |
| GPS en teléfono físico | Instancia HTTPS, dispositivo y prueba de señal/voz/captura/consumo/suspensión | [#19](https://github.com/Baudracco/gtt_trainer/issues/19) |

Más adelante: áreas de mapa offline con licencia/límites del proveedor, lecciones y
progreso de aprendizaje, y réplica de copias fuera del host. No están implementados.
El dominio/host de despliegue sigue sin concretarse en este repositorio.

## Decisiones que se mantienen

- Geometría fija y ordenada, sin routing óptimo, tráfico, snapping ni conexiones
  inventadas. Navegación, grabación y estudio virtual son modos excluyentes.
- Guardar/importar crea borradores; publicar requiere revisión separada. Las
  publicaciones, sus paradas/instrucciones y medios asociados son inmutables.
- Puesto de cambio, sentido y notas pertenecen a una visita ordenada de una variante;
  no al stop global ni automáticamente a ambos sentidos.
- La API propia usa segmentos de ruta, sin query params. Los fixes GPS no se envían
  como telemetría; guardar explícitamente una captura sí envía el documento elegido.
- Solo el worker controla el GTFS y su cooldown persistente, mínimo 24 h incluso
  después de errores/reinicios. Abrir paneles o hacer pruebas no autoriza otra descarga.
- Conservar trabajo manual, papelera, procedencia, revisiones y material privado.
  No publicar originales o texto literal del operador en código, issues o assets.

## Retomar sin volver a explorar todo

1. Leer este archivo y `AGENTS.md`. Comprobar `git status --short --branch` y el
   último commit; conservar cambios locales ajenos a la tarea.
2. Actualizar la referencia de `main` y revisar solo el delta respecto al punto
   funcional anterior, por ejemplo `git log --oneline 6c19f58..HEAD`. Leer los PR o
   archivos de ese delta si invalidan lo anotado aquí.
3. Elegir un pendiente concreto y leer sus puntos de entrada. Arquitectura, hoja
   de ruta y manuales son referencias por tema; no hace falta releerlos completos.
4. Ejecutar las pruebas pertinentes al cambio. Usar CI para PostGIS/HTTP, Docker y
   Chromium cuando el entorno local no los tenga. No confundir móvil emulado con
   teléfono físico ni configuración HTTPS validada con despliegue realizado.
5. Antes del merge, actualizar este documento: entrega/pruebas verificadas,
   funcionalidades nuevas, estado real de la tarea activa, bloqueos y siguiente paso.
   Mantenerlo conciso; enlazar detalles en lugar de copiar registros extensos.

Comandos y responsabilidades de cada prueba: [guía del desarrollador](DEVELOPER_GUIDE.md).
Generación y enlaces de documentos: `sh tools/generate_docs.sh` y
`python3 tools/check_docs.py`. Los resultados generados están ignorados; se versionan
las fuentes y comentarios, no sus copias HTML.

## Obstáculos ya diagnosticados

- El JSON base público `data/gtt-urban-drafts.json` tiene 4.605.117 bytes. El catálogo
  efectivo se reconstruye con `gtt-urban-drafts.patch-index.json`, partes pequeñas y
  `tools/catalogue.py::load_catalogue`, verificando hashes. No volver a transferir un
  JSON completo de varios MB mediante una herramienta que ya se atasca con él.
  Usar los parches existentes y lotes pequeños; comprobar que el árbol remoto coincide
  con el árbol local. [Explicación](GTFS_SYNC.md).
- En las pruebas de captura, cambiar la ubicación emulada de Chromium produjo
  `POSITION_UNAVAILABLE` antes del nuevo fix. La política correcta separa esos puntos.
  PR #18 comprueba errores/pausas con GPS nativo y movimiento continuo con callbacks
  controlados y WebGL real. No relajar los filtros ni unir cortes para hacer pasar CI.
- La grabación vive en memoria: cerrar/recargar pierde lo no descargado. Solo un
  tramo revisado se aplica al formulario; los tiempos/precisiones quedan en el GPX.
- Un bundle/ZIP incompleto no es una fuente válida. Las pruebas de sincronización
  inyectan transporte/reloj y no consumen la ventana de descarga real de GTT.
