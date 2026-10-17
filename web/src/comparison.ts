import type { RouteDocument, RouteStop } from './model';

/** Stable A/B overlay colours; saved line colours and route documents remain untouched. */
export const COMPARISON_COLORS = ['#2463eb', '#c45016'] as const;

/** Equality of JSON domain values regardless of object-key insertion order; arrays keep their order. */
export function equalValues(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => equalValues(value, b[index]))
    );
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const first = a as Record<string, unknown>,
      second = b as Record<string, unknown>;
    const keys = Object.keys(first);
    return (
      keys.length === Object.keys(second).length &&
      keys.every((key) => Object.hasOwn(second, key) && equalValues(first[key], second[key]))
    );
  }
  return false;
}

/** Stop identity is its canonical UUID; repeated occurrences retain their sequence position. */
function stopIdentity(stop: RouteStop) {
  return stop.id;
}

/** Ordered stop occurrence changed between two snapshots, including additions/deletions. */
export type StopDifference = {
  sequence: number;
  first: RouteStop | null;
  second: RouteStop | null;
};

/** Inspect two current snapshots locally. No identity inference, merging or mutation takes place. */
export function compareRoutes(first: RouteDocument, second: RouteDocument) {
  const stopDifferences: StopDifference[] = [];
  for (let index = 0; index < Math.max(first.stops.length, second.stops.length); index++) {
    if (!equalValues(first.stops[index], second.stops[index]))
      stopDifferences.push({
        sequence: index + 1,
        first: first.stops[index] ?? null,
        second: second.stops[index] ?? null,
      });
  }
  return {
    geometry: equalValues(first.geometry, second.geometry),
    stopSequence: equalValues(first.stops.map(stopIdentity), second.stops.map(stopIdentity)),
    memberships: equalValues(first.stops, second.stops),
    instructions: equalValues(first.instructions, second.instructions),
    notes: first.notes === second.notes,
    source: equalValues(first.source, second.source),
    video: equalValues(first.video ?? null, second.video ?? null),
    stopDifferences,
  };
}
