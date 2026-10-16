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

La selección actual usa `agencies: ["U"]`, `routeTypes: ["0", "3"]` y `lines: []`: todos los buses y tranvías urbanos declarados en el feed. En el snapshot 20261013 produce 602 variantes válidas de 137 códigos de línea y 31 patrones retenidos para revisión. La identidad distingue ruta, shape, direction_id y secuencia de paradas; no representa 602 líneas. Las 139 variantes del primer lote están incluidas.

El paquete `data/gtt-urban-drafts.json` arranca instalaciones nuevas sin repetir la descarga ya realizada. Si una instalación conserva el mismo SHA del primer lote, la semilla ampliada sustituye únicamente el catálogo de candidatos y conserva íntegro `state.json`, incluido `lastAttemptAt`. Si ya descargó un feed diferente, nunca se vuelve al snapshot empaquetado. Un cambio posterior de selección reutiliza el ZIP local cuando existe; la reserva de HTTP sigue vigente.
