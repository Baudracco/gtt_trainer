# Architecture decisions

- **Web first**: Vite/React/TypeScript PWA, responsive desktop/mobile, later optional Capacitor if background location requires native integrations.
- **Cartography**: MapLibre GL JS, OpenStreetMap-derived basemaps from a compliant configurable tile provider. Public OSM tile service is not a production CDN or guaranteed offline source.
- **Server**: PHP 8.3+ PSR-4 domain services, HTTP controllers, repositories, migrations, PDO prepared queries.
- **Geodata**: PostgreSQL 16+ and PostGIS, WGS84 EPSG:4326. LineStrings follow physical travel order; never inferred from text street lists alone.
- **Design**: Line (brand/number) 1:N route_variants (outbound/inbound/depot/deadhead/partial/circular) 1:N revisions, with published revision pointer. Stops M:N variants through ordered route_stops (repeated stops supported). Change-post metadata lives on route_stop membership, not the global stop.
- **Authoring**: draft to review to published; optimistic locking / audit trail; soft delete plus restoration for editor-facing records. Viewer cannot edit.
- **Import**: parsers create drafts only; GPX tracks/GeoJSON preserve geometry, CSV/XLSX points parsed with coordinate checks, unstructured text requires manual confirmation before shaping.
- **Security target**: Argon2id passwords, HttpOnly Secure SameSite session cookies, anti-CSRF for cookie writes, login throttle and general rate limits, prepared SQL, input validation, permission guards, CSP, upload limits, audit logs with append-only fallback, idempotent migration history; exact implementation and tests remain milestone 1.
- **Reports**: server-generated HTML/PDF from versioned route and annotated ordered maneuvers; downloadable snapshot includes revision.
- **Navigation**: progress along fixed geometry, heading/circular path ambiguity handled by explicit active route and temporal progress. No routing engine changes fixed paths. Location defaults local-only with opt-in.
- **API**: version /api/v1, stable structured machine-readable error codes plus trace_id; OpenAPI and error catalogue required before API endpoints.
- **Licensing**: investigate ODbL attribution/share-alike implications for map-derived data and tile-provider policy prior to launch.
- **Shortener**: borrow patterns (error catalogue, audit and redundant logging, API docs and throttle test strategy), not authentication secrets, crypto code or existing deployment coupling.
