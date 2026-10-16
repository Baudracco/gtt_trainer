# Architecture decisions

Official GTFS refresh is an independent Docker worker, described in [GTFS_SYNC.md](GTFS_SYNC.md).
It checks ZIP SHA-256 after a durable minimum 24h download cooldown and uses the internal CLI
to create source-linked candidate revisions transactionally. It never changes a published
snapshot or replaces an editorial working draft. Download state survives in `serverdata`;
source identity, conflicts, missing patterns and accepted revisions are tracked in PostGIS.

- **Web first**: Vite/React/TypeScript PWA, responsive desktop/mobile, later optional Capacitor if background location requires native integrations.
- **Cartography**: MapLibre GL JS, OpenStreetMap-derived basemaps from a compliant configurable tile provider. Public OSM tile service is not a production CDN or guaranteed offline source.
- **Server**: PHP 8.3+ PSR-4 domain services, HTTP controllers, repositories, migrations, PDO prepared queries.
- **Geodata**: PostgreSQL 16+ and PostGIS, WGS84 EPSG:4326. LineStrings follow physical travel order; never inferred from text street lists alone.
- **Design**: Line (brand/number) 1:N route_variants (outbound/inbound/depot/deadhead/partial/circular) 1:N revisions, with published revision pointer. Stops M:N variants through ordered route_stops (repeated stops supported). Change-post metadata lives on route_stop membership, not the global stop.
- **Authoring**: draft to review to published; optimistic locking / audit trail; soft delete plus restoration for editor-facing records. Viewer cannot edit.
- **Import**: parsers create drafts only; GPX tracks/GeoJSON preserve geometry, CSV/XLSX points parsed with coordinate checks, unstructured text requires manual confirmation before shaping.
- **Security**: Argon2id passwords, HttpOnly/SameSite=Strict cookies (Secure outside development), rotating CSRF tokens and same-origin write checks, enabled-user/role checks, atomic Postgres login/request/report budgets, prepared SQL, structured validation, CSP and 4 MiB upload limits. Transactional append-only audit; sanitized errors also go to error_log and optional fallback file. Checksum migrations use an advisory lock and adopt the original foundation schema.
- **Reports**: server-generated HTML and Dompdf PDF from immutable versioned snapshots, ordered maneuvers, membership observations and exact route SVG; no external report resources.
- **Navigation**: progress along fixed geometry, heading/circular path ambiguity handled by explicit active route and temporal progress. No routing engine changes fixed paths. Location defaults local-only with opt-in.
- **API**: version /api/v1, stable structured machine-readable error codes plus trace_id; OpenAPI and error catalogue required before API endpoints.
- **Licensing**: investigate ODbL attribution/share-alike implications for map-derived data and tile-provider policy prior to launch.
- **Basemap/offline**: bundled OpenFreeMap Positron style with online attributed vector tiles. App shell/static references are cached separately from IndexedDB publications. No API/session/draft response or map tile is stored in the service-worker cache. GPS processing and optional speech synthesis run locally, with one active variant and explicit start anchor.
- **Sources**: frozen GTFS candidates retain provenance; 0/1 direction flags are not mapped to operational labels without evidence. DAPER is reference text pending individual digitization, not a guessed path. Photo access combinations remain literal; directional change memberships require an explicit direction.
- **Shortener**: borrow patterns (error catalogue, audit and redundant logging, API docs and throttle test strategy), not authentication secrets, crypto code or existing deployment coupling.
