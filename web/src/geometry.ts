import type {Coordinate, Instruction} from './model';

const R = 6371008.8;
const rad = (x: number) => x * Math.PI / 180;
export const bearingDelta = (a: number, b: number) => ((b - a + 540) % 360) - 180;
export function distance(a: Coordinate, b: Coordinate): number {
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function bearing(a: Coordinate, b: Coordinate): number {
  const d = rad(b[0] - a[0]);
  return (Math.atan2(Math.sin(d) * Math.cos(rad(b[1])), Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(d)) * 180 / Math.PI + 360) % 360;
}
export type MeasuredRoute = {coordinates: Coordinate[]; offsets: number[]; length: number};
export function measure(coordinates: Coordinate[]): MeasuredRoute {
  const offsets = [0];
  for (let i = 1; i < coordinates.length; i++) offsets.push(offsets[i - 1] + distance(coordinates[i - 1], coordinates[i]));
  return {coordinates, offsets, length: offsets.at(-1) ?? 0};
}
export function pointAt(route: MeasuredRoute, offset: number): Coordinate {
  const {coordinates: c, offsets: d} = route;
  if (offset <= 0) return c[0];
  for (let i = 1; i < c.length; i++) if (d[i] >= offset) {
    const t = (offset - d[i - 1]) / (d[i] - d[i - 1] || 1);
    return [c[i - 1][0] + t * (c[i][0] - c[i - 1][0]), c[i - 1][1] + t * (c[i][1] - c[i - 1][1])];
  }
  return c.at(-1)!;
}
export type Projection = {offsetM: number; distanceM: number; segment: number; coordinate: Coordinate; bearing: number};
export function projections(route: MeasuredRoute, point: Coordinate): Projection[] {
  const cos = Math.max(.01, Math.cos(rad(point[1])));
  const out: Projection[] = [];
  for (let i = 1; i < route.coordinates.length; i++) {
    const a = route.coordinates[i - 1], b = route.coordinates[i];
    const ax = rad(a[0] - point[0]) * R * cos, ay = rad(a[1] - point[1]) * R;
    const bx = rad(b[0] - point[0]) * R * cos, by = rad(b[1] - point[1]) * R;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    if (l2 < .01) continue;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2));
    const coordinate: Coordinate = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    out.push({offsetM: route.offsets[i - 1] + t * (route.offsets[i] - route.offsets[i - 1]), distanceM: distance(point, coordinate), segment: i - 1, coordinate, bearing: bearing(a, b)});
  }
  return out;
}
export function nearestOffset(route: MeasuredRoute, point: Coordinate, after = 0): number {
  return projections(route, point).filter(p => p.offsetM >= after - 2).sort((a, b) => a.distanceM - b.distanceM || a.offsetM - b.offsetM)[0]?.offsetM ?? after;
}
export type Fix = {coordinate: Coordinate; accuracy: number; heading: number | null; speed: number | null; timestamp: number};
export type Progress = {offsetM: number; timestamp: number; coordinate: Coordinate; distanceM: number; state: 'tracking' | 'off-route' | 'weak-gps' | 'wrong-direction' | 'waiting'; segment: number};

export function matchFix(route: MeasuredRoute, fix: Fix, previous: Progress | null, startOffset = 0, now = Date.now()): Progress {
  const anchor = previous?.offsetM ?? startOffset;
  const fallback: Progress = previous ?? {offsetM: anchor, timestamp: fix.timestamp, coordinate: pointAt(route, anchor), distanceM: 0, segment: 0, state: 'waiting'};
  if (!Number.isFinite(fix.accuracy) || fix.accuracy > 80 || fix.accuracy < 0 || now - fix.timestamp > 15000 || fix.timestamp > now + 5000 || previous && fix.timestamp <= previous.timestamp) return {...fallback, state: 'weak-gps'};
  const elapsed = previous ? Math.max(0, (fix.timestamp - previous.timestamp) / 1000) : 0;
  // Restrict temporal progress to plausible bus movement. Crossings and loops cannot jump to a later lap.
  const ahead = previous ? Math.max(120, elapsed * 36 + fix.accuracy * 2) : 180;
  const heading = fix.heading !== null && Number.isFinite(fix.heading) && (fix.speed ?? 0) > 1.5 ? fix.heading : null;
  const candidates = projections(route, fix.coordinate).filter(p => p.offsetM >= anchor - 45 && p.offsetM <= anchor + ahead);
  const score = (p: Projection) => p.distanceM + Math.abs(p.offsetM - anchor) * .025 + (heading === null ? 0 : Math.abs(bearingDelta(heading, p.bearing)) * .35);
  candidates.sort((a, b) => score(a) - score(b));
  const best = candidates[0];
  if (!best || best.distanceM > Math.max(45, fix.accuracy * 1.5)) return {...fallback, distanceM: best?.distanceM ?? Infinity, state: 'off-route'};
  if (heading !== null && Math.abs(bearingDelta(heading, best.bearing)) > 115) return {...fallback, distanceM: best.distanceM, state: 'wrong-direction'};
  return {offsetM: Math.max(anchor, best.offsetM), timestamp: fix.timestamp, coordinate: best.coordinate, distanceM: best.distanceM, segment: best.segment, state: 'tracking'};
}

export function generateInstructions(route: MeasuredRoute, words: {depart: string; left: string; right: string; arrive: string}): Instruction[] {
  if (route.coordinates.length < 2) return [];
  const steps: Instruction[] = [{offsetM: 0, kind: 'depart', text: words.depart, notes: ''}];
  let lastTurn = -100;
  for (const offsetM of route.offsets.slice(1, -1)) {
    if (offsetM < 18 || offsetM > route.length - 18 || offsetM - lastTurn < 40) continue;
    const a = pointAt(route, offsetM - 18), center = pointAt(route, offsetM), b = pointAt(route, offsetM + 18);
    const angle = bearingDelta(bearing(a, center), bearing(center, b));
    if (Math.abs(angle) >= 38) {
      steps.push({offsetM: Math.round(offsetM), kind: angle > 0 ? 'right' : 'left', text: angle > 0 ? words.right : words.left, notes: ''});
      lastTurn = offsetM;
    }
  }
  steps.push({offsetM: Math.floor(route.length), kind: 'arrive', text: words.arrive, notes: ''});
  return steps;
}
