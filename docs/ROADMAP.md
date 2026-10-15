# Roadmap

## Milestone 0 — Foundation (current PR)
- Repository conventions, architecture, PostGIS schema, local development.
- React PWA shell with overlay of fixed GeoJSON shapes and visibility controls.
- Data model for route variants, stop reuse, exchange posts and instructions.

## Milestone 1 — Study MVP
- PHP 8.3 OOP REST API, migrations and seed importer.
- Login, role-based editing, audit, rate limiting, session security.
- Published route browsing, directional selection, multiple overlays, stop filters, common stops and change posts.
- Instruction/observation editing; printable trip reports and PDF.
- Multilingual Italian/Spanish/English translations, theme preference.

## Milestone 2 — Route authoring and imports
- Map geometry editor with explicit vertices and no auto-routing.
- Route revisions, publish/revert, approval and conflicts.
- Text/CSV/GPX/XLSX/GTFS intake, coordinate reference validation, import preview and rollback.
- Full CRUD for routes, stops and cross-route stop memberships.

## Milestone 3 — Navigation (immediately after MVP)
- Mobile geolocation, route-specific map matching, heading and direction inference.
- Circular routes and repeated geometry disambiguated by ordered progress and travel bearing.
- Fixed-shape turn announcements and off-route warning (never silently reroute).
- Stop/change-post proximity and safety-friendly interface.

## Milestone 4 — Production/offline and learning
- Licensed offline tiles, caching, background GPS feasibility review, installability.
- Driver lessons, quizzes, progress, validated official GTT data ingestion.
- CI security tests, deployment, observability, backups, GDPR retention.

## Acceptance criteria
Routes and variants are separate. Each published variant has an immutable ordered LineString with version, geometry and direction. A stop has one identity and memberships for many variants. Exchange posts are contextual to variant/direction. Multiple variants can overlay while only one is active. A map import never changes a published variant until reviewed. No external provider is allowed to recompute stored official paths.
