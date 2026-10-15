export type Coordinate = [number, number];
export type Direction = 'andata' | 'ritorno' | 'circular' | 'none';
export type RouteKind = 'service' | 'depot_out' | 'depot_in' | 'deadhead' | 'partial' | 'circular';
export type Instruction = {offsetM: number; text: string; notes: string; kind: 'depart' | 'straight' | 'left' | 'right' | 'roundabout' | 'arrive' | 'note'};
export type RouteStop = {id: string; code: string; name: string; coordinates: Coordinate; offsetM: number; exchange: boolean; exchangeDirection: Direction | null; notes: string};
export type RouteDocument = {
  line: string; name: string; direction: Direction; kind: RouteKind; color: string;
  geometry: {type: 'LineString'; coordinates: Coordinate[]}; stops: RouteStop[];
  instructions: Instruction[]; notes: string;
  source: {name: string; url: string; license: string; retrievedAt: string};
};
export type RouteSnapshot = RouteDocument & {id: string; revisionId: string; revision: number; status: 'draft' | 'review' | 'published' | 'archived'; version: number; deleted: boolean; createdAt: string};
export type User = {id: string; email: string; role: 'viewer' | 'editor' | 'admin'};
export type StopGroup = {stop: RouteStop; lines: string[]; memberships: {route: RouteSnapshot; stop: RouteStop}[]};

export function groupStops(routes: RouteSnapshot[]): StopGroup[] {
  const groups = new Map<string, StopGroup>();
  for (const route of routes) for (const stop of route.stops) {
    const group = groups.get(stop.id) ?? {stop, lines: [], memberships: []};
    if (!group.lines.includes(route.line)) group.lines.push(route.line);
    group.memberships.push({route, stop}); groups.set(stop.id, group);
  }
  return [...groups.values()];
}

export function emptyRoute(): RouteDocument {
  return {line: '', name: '', direction: 'andata', kind: 'service', color: '#2463eb', geometry: {type: 'LineString', coordinates: []}, stops: [], instructions: [], notes: '', source: {name: '', url: '', license: '', retrievedAt: new Date().toISOString().slice(0, 10)}};
}
