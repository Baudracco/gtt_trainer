# Automatic GTT source synchronization

Requested on 2026-10-16: periodic official downloads, ZIP hash comparison, cooldown of at
least 24 hours. `docker compose up --build -d` starts `gtfs-sync` alongside Nginx, PHP-FPM
and PostGIS. The internal CLI needs no user password and cannot publish routes.

## Download lifecycle

Only `https://www.gtt.to.it/open_data/gtt_gtfs.zip` is supported. Redirects must remain on
GTT HTTPS hosts. `tools/gtfs-sync-config.json` contains selected bus line names and
`cooldownHours` (24–8760). Change it and rebuild to adjust the interval or line selection.

The shared `serverdata` volume stores a lock, state, last validated ZIP and normalized bundle
under `/var/www/server/var/gtfs`. **Preserve this volume** across deployments: it is the
cooldown/provenance state. Workers for one installation must share this directory. Separate
installations have separate cooldowns; run one source worker per deployment.

Before connecting, the worker atomically writes `lastAttemptAt` and `nextAttemptAt`.
The interval applies after timeout, HTTP error, malformed ZIP, conversion failure, crash
and restart. Hourly local wake-ups do not make hourly HTTP requests. A backwards clock
change delays downloads. There is no force/retry bypass. `GTFS_DOWNLOAD_ENABLED=0` in `.env`
pauses HTTP after recreating the worker; the retained bundle is still available locally.

The original catalogue/hash/download timestamp seed the first startup without a duplicate
download during cooldown. ETag/Last-Modified are sent when available; HTTP 304 retains the
checksum. Each 200 is streamed with a 100 MiB cap and SHA-256. Archive member count,
uncompressed size, required tables, uniqueness and CRC are validated. The old bundle
survives until complete conversion succeeds. Selection changes can reuse a retained ZIP.

## Source identity and revisions

Keys include `route_id`, `shape_id`, `direction_id` and the ordered stop pattern, including
repeats. Different patterns remain distinct. Changed shape IDs/patterns create separate
identities; their predecessor is marked absent rather than guessed to be a replacement.
GTFS 0/1 does not automatically become operational andata/ritorno.

The ZIP checksum detects file changes. A normalized route fingerprint ignores download date
and canonical stop UUID substitution while retaining geometry, stop order/metadata, names
and observations. A ZIP changed only by timetables creates no route revisions. `gtfs:sync`
is transactional and serialized with a PostgreSQL advisory lock. Source links, fingerprints,
incoming conflicts and summaries are stored in `gtfs_route_links` / `gtfs_sync` and audited.

| Incoming condition | Automatic result |
| --- | --- |
| Unique exact existing source snapshot | Link without duplicating. |
| New valid identity | Create draft variant. |
| Unchanged normalized route | Keep revision unchanged. |
| Changed source, untouched source draft or no working draft | Create next draft; keep publication. |
| Manual draft or revision under review | Store incoming document separately; preserve editorial work. |
| Local route in trash | Preserve trash; retain incoming document for inspection. |
| Invalid stop/shape pattern | Record discrepancy; retain previous route. |
| Identity absent in new selected feed | Mark absent; retain publication and history. |

The editor/admin **Fuentes GTT** tab shows hash, download eligibility, counts and source
issues. Incoming conflicts can be downloaded as JSON for manual comparison/reconciliation.
Automatic updates never rewrite a publication or recalculate a route from time/traffic.

The worker also attaches a bounded read-only duplicate audit to its retained bundle
before ingestion, including when HTTP is paused or cooling down. This changes no
download reservation, route fingerprint or source identity. The editor source panel
shows same-line exact matches separately from paths shared across lines, with links
to compare current local revisions. Existing revisions/links are preserved. See
[audit method and snapshot findings](ROUTE_AUDIT.md).

## Operations and checks

```sh
docker compose logs --tail=50 gtfs-sync
# Manual execution shares the same lock/cooldown; it cannot force an HTTP request.
docker compose exec gtfs-sync python3 /var/www/tools/sync_gtfs.py --apply
# Apply retained bundle again without contacting GTT; ingestion is idempotent.
docker compose exec api php bin/console.php gtfs:sync /var/www/server/var/gtfs/current.json
python3 tools/test_sync_gtfs.py
```

Python tests use synthetic ZIPs and fake HTTP, never GTT. They cover the exact 24h boundary,
restart/crash/failure reservation, checksum/timetable-only changes, 304, invalid ZIPs and
seed adoption. PostGIS tests cover idempotence, immutable publication, editorial conflicts,
missing/rejected patterns and trash. CI pauses external downloads while testing automatic
startup from the provenance-backed bundled feed.

Attribution/non-commercial terms stay in every source document; see `SOURCES.md` and the
[official licence](https://www.gtt.to.it/gtt_gtfs_license.html).

## Catálogo urbano completo y actualización de instalaciones

La selección actual usa `agencies: ["U"]`, `routeTypes: ["0", "3"]` y `lines: []`: todos los buses y tranvías urbanos declarados en el feed. En el snapshot 20261013 produce 633 variantes válidas de 137 códigos de línea tras recuperar los 31 patrones que rechazaba el proyector anterior. La identidad distingue ruta, shape, direction_id y secuencia de paradas; no representa 633 líneas. Las 139 variantes del primer lote están incluidas.

La semilla empaquetada arranca instalaciones nuevas sin repetir la descarga ya realizada. Se conserva intacta la base de 602 documentos en `data/gtt-urban-drafts.json`; `gtt-urban-drafts.patch-index.json` y los 32 archivos de `gtt-urban-drafts.patches/` contienen una corrección existente y 31 incorporaciones, para obtener exactamente 633 documentos. `tools/catalogue.py` comprueba SHA-256 de la base, de cada corrección y del resultado completo antes de importar. Los cambios pequeños pueden revisarse y transmitirse individualmente. El sincronizador y el verificador web usan ese lector; los bundles de futuras descargas se convierten completos y no dependen de estas correcciones.

Para exportar un JSON independiente compatible con otras herramientas:

```sh
python3 tools/catalogue.py data/gtt-urban-drafts.json --output /tmp/gtt-urban-complete.json
```

Si una instalación conserva el mismo SHA del primer lote, la semilla ampliada sustituye únicamente el catálogo de candidatos y conserva íntegro `state.json`, incluido `lastAttemptAt`. Si ya descargó un feed diferente, nunca se vuelve al snapshot empaquetado. Un cambio posterior de selección reutiliza el ZIP local cuando existe; la reserva de HTTP sigue vigente.

## Corrección del importador sin descargas adicionales

La versión 2 del conversor recupera los 31 patrones que el algoritmo voraz rechazaba
al elegir una aparición posterior de una calle repetida. También corrige un patrón aceptado de línea 14. Proyecta la secuencia
completa sobre los mismos segmentos, mantiene el orden y minimiza el error espacial.
No calcula calles alternativas, no desplaza paradas ni cambia vértices. Los 31 casos
tienen residuales máximos inferiores a 35 m y el catálogo pasa de 602 a 633 variantes.
De los 602 documentos previos, 601 conservan su contenido y uno de línea 14 corrige los offsets de paradas que saltaban 953,75 m hacia una pasada posterior. Ningún vértice ni coordenada de parada cambia.

`data/gtfs-projection-audit.json` registra claves, fallo anterior, residuales y hashes.
`converterVersion` obliga a reprocesar un ZIP local verificado, o adoptar una semilla
actualizada del mismo feed, sin reiniciar `state.json` ni saltar el cooldown. Un ZIP
local cuyo hash no coincida se rechaza conservando el último bundle bueno.

`python3 tools/verify_gtt_web.py` contrasta las secuencias recuperadas con las páginas
oficiales GTT y escribe evidencia URL/fecha/hash y orden de códigos. Cachea cada
intento de página 24 h, no descarga GTFS y no modifica publicaciones. Las diferencias
con una web que cambia son evidencia de revisión, no autorización para reescribir.

El contraste oficial guardado en `data/gtt-web-audit.json` confirma exactamente las secuencias de los 31 casos recuperados. El código de línea web procede de `route_url` del feed (por ejemplo 63B), que puede diferir del rótulo comercial 63/.
