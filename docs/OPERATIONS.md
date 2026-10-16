# Operation and verification

## Local development

Node 24+, PHP 8.3+ with PDO PostgreSQL, mbstring and DOM, Composer 2, PostgreSQL 16/PostGIS.

```sh
docker compose up -d db
cd server
composer install
export DATABASE_DSN='pgsql:host=127.0.0.1;port=5432;dbname=gtt_trainer'
export DATABASE_USER=gtt_trainer
# Set DATABASE_PASSWORD from your local .env, without committing it.
php bin/console.php migrate
APP_ENV=development APP_ORIGIN=http://localhost:5173 php -S 127.0.0.1:8080 -t public public/index.php
```

In another terminal, `cd web`, `npm ci`, `npm run dev`. Vite proxies `/api` to port 8080.
Published snapshots and static source references work offline after loading. Editing, server
reports and session login require the API. Map tiles and glyphs require internet; no bulk tile
caching occurs. Foreground GPS requires HTTPS or localhost and explicit browser permission.
Mobile background location is a later native feasibility task, not promised by this PWA.

## Authoring and review

Anonymous and viewer accounts read current publications. Editor/admin can create a route,
import a GeoJSON/GPX/document, draw each vertex explicitly, add/reuse ordered stops, assign
directional change posts, write instructions/observations and submit review. Admin publishes
after checking the fixed streets and maneuvers against evidence. Every save creates a new
snapshot; stale `expectedVersion` returns 409. Revert copies an older snapshot to a new draft.

Docker's `gtfs-sync` service loads the bundled catalogue and checks the official GTT source
automatically, with SHA-256 comparison and a persistent minimum 24h cooldown. Do not also
run the initial manual `import` command, which deliberately creates separate user variants.
See [GTFS synchronization](GTFS_SYNC.md) for state retention, interval configuration,
editorial conflicts, missing patterns and pausing downloads. Code and changes are tracked
in GitHub; runtime source provenance and each accepted route update are recorded in PostGIS.

Map import preview does not persist anything until Save. `/imports` validates the complete
batch and uses one transaction; any failure rolls everything back. CLI imports are also atomic.
LineString order is preserved. GPX segments become separate variants; MultiLineStrings and
GPX route points without complete track geometry are not joined or auto-routed.

`tools/import_routes.py` converts GTFS/CSV/XLSX. CSV headers: `route_id,sequence,longitude,latitude,line,name`,
optional `direction,kind`. XLSX sheet `vertices` uses the same headers; optional `stops`:
`route_id,sequence,stop_id,code,name,longitude,latitude,offset_m,exchange,exchange_direction,notes`;
optional `instructions`: `route_id,sequence,offset_m,text,notes,kind`. WGS84 only. Review generated
JSON before importing. Text DAPER blocks remain references until an exact geometry is authored.

```sh
python3 tools/import_routes.py official-feed.zip routes.json --lines '2,5,12,74'
python3 tools/import_routes.py vertices.xlsx routes.json --source-name 'Verified author' --source-url '' --license 'Local operational reference'
```

GTFS direction_id 0/1 is not guessed to be andata/ritorno. Explicit CLI direction mapping
is available after verification. Shared stop identity follows GTFS stop_id; repeated
memberships and distinct stop patterns of the same shape remain separate.

## Security and production configuration

Docker defaults bind HTTP and DB to loopback only. To use on a phone, deploy behind a trusted
HTTPS reverse proxy, set `APP_ENV=production`, and set `APP_ORIGIN` to the exact public origin.
Secure cookies are mandatory outside development. The application neither logs GPS nor sends
fixes to the API. Audit writes are transactional; unexpected server faults have a sanitized
error_log record and an optional append file in `AUDIT_FALLBACK_LOG`.

Use a restricted application DB role in production (DML on application tables and sequence
access), and a separate migration owner. Do not grant the application role superuser or DDL.
The included single DB user is a local development convenience. Forward real client addresses
through a configured trusted proxy into FastCGI `REMOTE_ADDR`, not arbitrary untrusted headers.
Back up Postgres including schema_migrations, route snapshots and audit events. Test restore
on an isolated database. Never run integration tests against a production database.

## Checks

```sh
cd web
npm ci
npm test
npm run build
cd ../server
composer install
php tests/run.php
```

`TEST_DATABASE_DSN` enables the real PostGIS checks in `server/tests/run.php`. CI provisions a
fresh `gtt_test` database, runs migrations twice, verifies immutable publication and ordered
shared stops, then `python3 server/tests/test_http.py` verifies CSRF, roles, session rotation,
HTTP PDF download, draft visibility, conflicts and rate limits. Frontend tests exercise actual
React controls with a map mock. `npm run test:e2e` (after `npm run build` and
`npx playwright install chromium`) additionally exercises real MapLibre/WebGL and native
browser GPS in Chromium desktop/mobile emulation, including recovery from temporary GPS
errors. It uses synthetic routes/empty tiles for deterministic checks and stores screenshots
and failure traces in the CI `browser-evidence` artifact. This is not an on-road device test.

`python3 tools/test_imports.py` checks parser behavior and source coverage. Validate the full
OpenAPI with `python3 -m openapi_spec_validator docs/openapi.yaml`. The CI workflow records each
result on the exact PR commit. Mobile GPS and voice need a real device field test against the
reviewed route; geometric turn suggestions still require street-name and maneuver review.
