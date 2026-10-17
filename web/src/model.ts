/** WGS84 tuple ordered as longitude, latitude; distances and progress use metres. */
export type Coordinate = [number, number];
/** Operational direction; none means not yet verified, rather than a guessed GTFS 0/1 mapping. */
export type Direction = 'andata' | 'ritorno' | 'circular' | 'none';
/** Operational purpose of this variant, independent of its line code. */
export type RouteKind = 'service' | 'depot_out' | 'depot_in' | 'deadhead' | 'partial' | 'circular';
/** Immutable private asset UUID plus revision-specific caption and credit. */
export type MediaReference = { id: string; caption: string; credit: string };
/** Reviewed maneuver at a fixed offset, with optional written landmarks and up to three photos. */
export type Instruction = {
  offsetM: number;
  text: string;
  notes: string;
  kind: 'depart' | 'straight' | 'left' | 'right' | 'roundabout' | 'arrive' | 'note';
  photos?: MediaReference[];
};
/** Ordered membership snapshot: exchange status/direction and notes belong here, not on a global stop. */
export type RouteStop = {
  id: string;
  code: string;
  name: string;
  coordinates: Coordinate;
  offsetM: number;
  exchange: boolean;
  exchangeDirection: Direction | null;
  notes: string;
};
/** Literal source evidence retained inside each revision, independently of future catalogue updates. */
export type SourceProvenance = {
  documentSha256: string;
  referenceId: string;
  movementId: string;
  pages: number[];
  title: string;
  text: string;
  textSha256: string;
  streets: string[];
};
/** Editable complete fixed-route content. Vertex, stop and instruction order are semantically significant. */
export type RouteDocument = {
  line: string;
  name: string;
  direction: Direction;
  kind: RouteKind;
  color: string;
  geometry: { type: 'LineString'; coordinates: Coordinate[] };
  stops: RouteStop[];
  instructions: Instruction[];
  notes: string;
  source: {
    name: string;
    url: string;
    license: string;
    retrievedAt: string;
    provenance?: SourceProvenance;
  };
  video?: MediaReference | null;
};
/** Server revision identity/status plus the variant optimistic-lock version. GPS selects one revisionId. */
export type RouteSnapshot = RouteDocument & {
  id: string;
  revisionId: string;
  revision: number;
  status: 'draft' | 'review' | 'published' | 'archived';
  version: number;
  deleted: boolean;
  createdAt: string;
};
/** Public account representation; passwords, hashes and session IDs never enter this model. */
export type User = { id: string; email: string; role: 'viewer' | 'editor' | 'admin' };
/** Canonical stop displayed once with all route-specific memberships, including repeated visits. */
export type StopGroup = {
  stop: RouteStop;
  lines: string[];
  memberships: { route: RouteSnapshot; stop: RouteStop }[];
};

/** Group shared identities without dropping each route’s exchange direction or repeated memberships. */
export function groupStops(routes: RouteSnapshot[]): StopGroup[] {
  const groups = new Map<string, StopGroup>();
  for (const route of routes)
    for (const stop of route.stops) {
      const group = groups.get(stop.id) ?? { stop, lines: [], memberships: [] };
      if (!group.lines.includes(route.line)) group.lines.push(route.line);
      group.memberships.push({ route, stop });
      groups.set(stop.id, group);
    }
  return [...groups.values()];
}

/** Create an unsaved editor form. Empty geometry must be authored before server validation. */
export function emptyRoute(): RouteDocument {
  return {
    line: '',
    name: '',
    direction: 'andata',
    kind: 'service',
    color: '#2463eb',
    geometry: { type: 'LineString', coordinates: [] },
    stops: [],
    instructions: [],
    notes: '',
    source: { name: '', url: '', license: '', retrievedAt: new Date().toISOString().slice(0, 10) },
  };
}
