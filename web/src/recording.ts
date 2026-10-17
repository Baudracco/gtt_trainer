import type { Coordinate } from './model';
import { distance } from './geometry';

/** Bounds keep a normal recording within the existing 4 MiB browser import limit. */
export const RECORDING_LIMITS = {
  points: 10000,
  segments: 100,
  accuracyM: 35,
  gapMs: 15000,
  intervalMs: 1000,
  distanceM: 3,
  speedMps: 45,
} as const;

/** One device observation, in WGS84 and epoch milliseconds, retained without snapping or smoothing. */
export type RecordedPoint = { coordinate: Coordinate; accuracy: number; timestamp: number };
/** Rejection categories contain no coordinates and are suitable for local status messages. */
export type RecordingIssue = 'quality' | 'stale' | 'jump' | 'order' | 'limit' | null;
/** Local, unsaved track; each segment is continuous evidence and must never be joined across a gap. */
export type RecordedTrack = {
  segments: RecordedPoint[][];
  observed: RecordedPoint | null;
  newSegment: boolean;
  pointCount: number;
  rejected: number;
  issue: RecordingIssue;
};

/** Start a local capture without requesting location or writing any persistent state. */
export function emptyRecording(): RecordedTrack {
  return {
    segments: [],
    observed: null,
    newSegment: true,
    pointCount: 0,
    rejected: 0,
    issue: null,
  };
}

/** Mark an explicit pause, hidden page or device error; a later observation starts another segment. */
export function breakRecording(track: RecordedTrack): RecordedTrack {
  return { ...track, newSegment: true };
}

/** Accept one fresh observation with bounded quality, plausible movement and explicit discontinuities.
 * Sampling omits stationary/subsecond points without marking a gap. Valid observations
 * still advance the signal clock, so a long stationary stop does not look like lost GPS.
 * Pauses, bad accuracy, time gaps and the antimeridian never create a connecting line.
 * All accepted coordinates remain exactly as received from the device. */
export function recordPoint(
  track: RecordedTrack,
  sample: RecordedPoint,
  now = Date.now(),
): RecordedTrack {
  if (track.pointCount >= RECORDING_LIMITS.points) return { ...track, issue: 'limit' };
  const reject = (issue: RecordingIssue, gap = true): RecordedTrack => ({
    ...track,
    rejected: track.rejected + 1,
    newSegment: gap || track.newSegment,
    issue,
  });
  const [lon, lat] = sample.coordinate;
  if (
    ![lon, lat, sample.accuracy, sample.timestamp].every(Number.isFinite) ||
    Math.abs(lon) > 180 ||
    Math.abs(lat) > 90 ||
    sample.accuracy < 0 ||
    sample.accuracy > RECORDING_LIMITS.accuracyM ||
    sample.timestamp < 0
  )
    return reject('quality');
  if (now - sample.timestamp > RECORDING_LIMITS.gapMs || sample.timestamp > now + 5000)
    return reject('stale');
  const previous = track.observed;
  if (previous && sample.timestamp <= previous.timestamp) return reject('order', false);
  const gapMs = previous ? sample.timestamp - previous.timestamp : 0;
  const starts =
    track.newSegment ||
    !previous ||
    gapMs > RECORDING_LIMITS.gapMs ||
    Math.abs(lon - previous.coordinate[0]) > 180;
  if (
    !starts &&
    previous &&
    distance(previous.coordinate, sample.coordinate) >
      (RECORDING_LIMITS.speedMps * gapMs) / 1000 + previous.accuracy + sample.accuracy
  )
    return reject('jump');
  if (starts && track.segments.length >= RECORDING_LIMITS.segments)
    return { ...track, issue: 'limit' };
  const point: RecordedPoint = { ...sample, coordinate: [lon, lat] };
  const last = track.segments.at(-1)?.at(-1);
  if (
    !starts &&
    last &&
    (sample.timestamp - last.timestamp < RECORDING_LIMITS.intervalMs ||
      distance(last.coordinate, point.coordinate) < RECORDING_LIMITS.distanceM)
  )
    return { ...track, observed: point, issue: null };
  const segments = starts
    ? [...track.segments, [point]]
    : [...track.segments.slice(0, -1), [...track.segments.at(-1)!, point]];
  return {
    ...track,
    segments,
    observed: point,
    pointCount: track.pointCount + 1,
    newSegment: false,
    issue: null,
  };
}

/** Usable route candidates retain their original segment index; isolated observations remain evidence only. */
export function recordingSegments(track: RecordedTrack) {
  return track.segments
    .map((points, index) => ({ points, index }))
    .filter((segment) => segment.points.length >= 2);
}

/** Convert a finite JavaScript number to a decimal GPX value without rounding or exponent notation. */
function decimal(value: number): string {
  const text = String(value);
  if (!text.includes('e')) return text;
  const [mantissa, exponent] = text.split('e');
  const sign = mantissa.startsWith('-') ? '-' : '';
  const [whole, fraction = ''] = mantissa.replace('-', '').split('.');
  const digits = whole + fraction,
    position = whole.length + Number(exponent);
  return (
    sign +
    (position <= 0
      ? '0.' + '0'.repeat(-position) + digits
      : position >= digits.length
        ? digits + '0'.repeat(position - digits.length)
        : digits.slice(0, position) + '.' + digits.slice(position))
  );
}

/** Encode local GPX 1.1 with independent track segments, UTC times and metre-accuracy extensions.
 * Single observations become waypoints, not invalid one-point road segments.
 * No PDF text, operational direction, routing request or server upload is added. */
export function recordingGpx(track: RecordedTrack, name: string): string {
  const escape = (text: string) =>
    text
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
      );
  const point = (p: RecordedPoint, element: 'wpt' | 'trkpt') =>
    `<${element} lat="${decimal(p.coordinate[1])}" lon="${decimal(p.coordinate[0])}"><time>${new Date(p.timestamp).toISOString()}</time><extensions><gtt:accuracyM>${decimal(p.accuracy)}</gtt:accuracyM></extensions></${element}>`;
  const segments = recordingSegments(track);
  if (!segments.length)
    throw Error('Recording needs a continuous segment with at least two points.');
  const singles = track.segments
    .filter((segment) => segment.length === 1)
    .map((segment) => point(segment[0], 'wpt'))
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:gtt="https://github.com/Baudracco/gtt_trainer/ns/1" version="1.1" creator="GTT Trainer"><metadata><name>${escape(name)}</name></metadata>${singles}<trk><name>${escape(name)}</name>${segments.map((segment) => `<trkseg>${segment.points.map((p) => point(p, 'trkpt')).join('')}</trkseg>`).join('')}</trk></gpx>\n`;
  if (new TextEncoder().encode(xml).length > 4194304)
    throw Error('GPX exceeds the 4 MiB import limit.');
  return xml;
}
