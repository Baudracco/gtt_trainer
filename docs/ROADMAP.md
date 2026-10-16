# State and roadmap

Last updated 2026-10-16. Work is traced through PRs and CI; the user authorized autonomous PRs
and merges after verification. All route geometry remains fixed and versioned.

## Implemented in the study/navigation MVP

- React/TypeScript responsive UI, ES/IT/EN, saved theme/language, installable shell.
- MapLibre fixed route overlays; all/none/selected visibility; one active navigation variant.
- Stop display/filtering, shared line membership, directional change posts, per-membership notes.
- PHP REST API with OpenAPI/error catalogue, Argon2id accounts and sessions, enabled-user roles,
  rotating CSRF tokens, login/request/report limits, opaque error traces and audit logging.
- PostGIS immutable publication, complete snapshots for every save, optimistic version conflicts,
  review/admin publication, history, revert to new draft, soft delete/restore.
- Map vertex authoring, stop reuse/editing, instruction and observation editing.
- Geometry-based turn suggestions for review, printable server reports and downloadable real PDFs.
- GeoJSON/GPX browser preview and atomic draft import; CLI conversion for CSV/XLSX/GTFS.
- Local foreground GPS matching with progress/heading checks, ambiguity handling, off-route and
  wrong-direction warnings, optional voice, explicit start stop. No routing/recalculation API.
- Published route cache in IndexedDB, app shell/reference cache; no unlicensed offline tile cache.
- Docker API/web/database deployment and checksum-based, repeatable migrations.
- Automated React/geometry/import/contract checks and real PostGIS/HTTP CI verification.
- Automatic official GTT downloads with ZIP SHA-256 comparison, conditional HTTP, a persistent
  minimum 24h cooldown including failed attempts, single-worker locking and last-good recovery.
- Idempotent source-linked GTFS ingestion: changed geometry becomes a new draft; unchanged
  routes, publications, manual drafts, trash decisions and missing/rejected source history survive.
- Editor source status and incoming-conflict export; source keys include distinct stop patterns.
- Chromium desktop/mobile WebGL, overlay pixels, ordered map editing and native GPS checks;
  temporary GPS unavailability retains the watcher and active route for automatic recovery.
- Friendly revision/trash/report paths, shareable web revision URLs and no API query params.
- Optional written turn references, normalized photos, complete-route video and playback rate;
  private uploads, immutable revision associations, streaming/ranges and illustrated reports.

- Panoramax contextual street imagery with true 360° Photo Sphere Viewer, manual/automatic fixed-path study, adjustable 5–120 km/h speed, attribution, explicit coverage gaps and cached metadata.

## Data incorporated

- 602 fixed urban bus/tram variant candidates across 137 line codes, including all 139 original Gerbido-related bus variants.
- 31 discrepant GTFS stop/shape patterns retained for manual review (including the initial 11).
- 133 source-reference blocks from DAPER 05/26 (pages 2–68), separating USCITA and RIENTRO.
- 30 Gerbido line/change-place/access combinations from the supplied photograph.

## Next data work

- Digitize each individual DAPER depot movement against street geometry and travel restrictions,
  preserving stated streets, order, continuation and turns. Text blocks are not navigable shapes.
- Verify detailed maneuvers/street names and operational direction for each GTFS candidate.
- Resolve exact stop/platform and andata/ritorno for Gerbido change posts; the photo omits them.
- Cross-check service routes against the forthcoming user PDF and current official evidence.
- Cross-check the imported tram GTFS with the forthcoming tram/service PDFs; ingest the consolidated duties/timetable PDF when provided.

## Later production/learning work

- Real-device foreground GPS/voice field validation; native/background feasibility and battery tests.
- Licensed offline basemap areas with provider-specific download limits.
- Expanded editorial workflows, source discrepancy resolution and route comparison tools.
- Driver lessons/quizzes/progress, production backup/restore automation and retention policy.

## Acceptance invariants

Variants are separate from lines. Published snapshots and their ordered geometry/stops/instructions
cannot be rewritten. Shared stops have one canonical identity, but exchange status/direction and
notes belong to ordered variant membership. Multiple overlays never cause multiple active GPS
routes. Imports create drafts only. No time, traffic, shortest-path engine or live feed changes a
stored route. Source facts without confirmed geometry remain references, visibly marked as such.
