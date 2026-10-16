import type { Coordinate } from './model';

/** A factual geolocated provider frame. Imagery never defines or changes the bus route. */
export type StreetPhoto = {
  id: string;
  collection: string;
  url: string;
  thumbnailUrl: string;
  coordinates: Coordinate;
  heading: number | null;
  panorama: boolean;
  capturedAt: string;
  credit: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  distanceM: number;
};
/** Coverage can be absent or temporarily unavailable while the fixed route remains playable. */
export type StreetFrame = {
  provider: 'panoramax';
  status: 'available' | 'empty' | 'unavailable' | 'rate_limited' | 'loading';
  photos: StreetPhoto[];
  coordinate: Coordinate;
  bearing: number;
  length: number;
  offsetM: number;
  stale?: boolean;
};

/**
 * Advance a simulated bus in metres on the saved LineString, at a speed in km/h.
 * Long background-tab timer delays are capped; no image sequence or routing engine
 * can advance this progress. Rewind is a separate, explicit user action.
 */
export function advanceVirtual(
  offset: number,
  speedKmh: number,
  elapsedSeconds: number,
  length: number,
): number {
  return Math.min(
    length,
    Math.max(0, offset) + (Math.max(0, speedKmh) / 3.6) * Math.min(1, Math.max(0, elapsedSeconds)),
  );
}
