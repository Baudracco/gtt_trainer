# Source register

The application freezes imported geometry. It does not refresh routes according to date,
traffic, arrival time or a routing provider. New data requires a new reviewed revision.

| Source | Frozen version | Result | Remaining validation |
| --- | --- | --- | --- |
| [Official GTT GTFS](https://www.gtt.to.it/open_data/gtt_gtfs.zip) | feed version 20261013, valid 2026-10-12 to 2027-01-31; SHA-256 in `data/gtt-urban-drafts.manifest.json` | 633 urban bus/tram variants across 137 line codes (agency U, types 0 and 3), exact supplied shape order and ordered stop patterns; all original 139 retained | 31 formerly rejected patterns recovered without changing source geometry; see projection audit; operational direction names; detailed street maneuvers; comparison to future service-route PDF |
| Operator DAPER document | Explicit version/date and source SHA-256 recorded during private local import | Authenticated individual-movement workbench, literal source snapshots and page provenance; source material is excluded from Git/public assets | Digitize and verify movement geometry; do not infer a road path by connecting named streets |
| Operator change-post photo/transcription | Private local reference | Authenticated consultation; source uncertainty retained | Confirm exact directional stop/platform and validity |
| [OpenFreeMap Positron style](https://tiles.openfreemap.org/styles/positron) | Bundled style JSON; online vector tiles | Basemap with provider attribution | No offline tile download implemented |

Private PDFs, photographs and their literal operational extracts are excluded from the current package/public assets. Import them locally into the private runtime volume.
Structured reference facts include page/source provenance. Their operational authority and validity remain those of the source;
the GTFS licence does not grant rights over unrelated operational documents.

GTT GTFS terms: https://www.gtt.to.it/gtt_gtfs_license.html . Non-commercial educational use
and attribution are permitted. Data source: GTT S.p.A. – Gruppo Torinese Trasporti,
https://www.gtt.to.it . Do not label the entire application dataset CC-BY just because an older
third-party feed directory says so. Commercial use of this GTT snapshot needs GTT permission.

Basemap: OpenFreeMap / OpenMapTiles / OpenStreetMap; [attribution and terms](https://openfreemap.org/).
MapLibre renders provider attribution. The bundled style is a configuration snapshot, not
an offline map database. No public OSM raster service is used as a production default.

Handwritten annotations and literal access combinations remain in the private
reference material. Preserve uncertainty and confirm their operational meaning;
do not infer transfers or compute a real-time journey from an unverified note.

The [duplicate audit](ROUTE_AUDIT.md) distinguishes imported source records from
exact path/stop groups and shared paths across lines. It preserves all source
identities and does not certify unique operational routes or remove repetitions.

User inputs still pending: tram depot/service routes, service-route PDF for cross-checking,
the consolidated duties/timetable PDF, directional confirmation of the Gerbido change posts.

The original `gtt-gerbido-drafts` documents/manifest are retained unchanged as the first 139-variant provenance checkpoint. The urban expansion reused the same downloaded ZIP, without another HTTP request or resetting the download cooldown. Interurban, tourist, metro and funicular services remain outside the declared bus/tram urban scope.
