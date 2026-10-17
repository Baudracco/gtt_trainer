// @vitest-environment jsdom
import { expect, it } from 'vitest';
import {
  breakRecording,
  emptyRecording,
  recordPoint,
  recordingGpx,
  recordingSegments,
  RECORDING_LIMITS,
  type RecordedPoint,
} from './recording';
import { parseGpx } from './importers';

const time = Date.parse('2026-01-01T12:00:00Z');
const point = (seconds: number, lon = 7.6 + seconds * 0.0001, accuracy = 5): RecordedPoint => ({
  coordinate: [lon, 45],
  accuracy,
  timestamp: time + seconds * 1000,
});
const append = (track: ReturnType<typeof emptyRecording>, p: RecordedPoint) =>
  recordPoint(track, p, p.timestamp);

it('retains device coordinates and samples stationary/subsecond observations without mutating input', () => {
  const first = append(emptyRecording(), point(0));
  const copy = structuredClone(first);
  let track = append(first, point(0.5));
  expect(track.pointCount).toBe(1);
  track = append(track, point(1));
  expect(track.segments[0].map((p) => p.coordinate)).toEqual([
    point(0).coordinate,
    point(1).coordinate,
  ]);
  expect(first).toEqual(copy);
});

it('keeps a stationary stop continuous while the signal is healthy', () => {
  let track = append(emptyRecording(), point(0));
  for (let seconds = 1; seconds <= 60; seconds++) track = append(track, point(seconds, 7.6));
  track = append(track, point(61, 7.6001));
  expect(track.pointCount).toBe(2);
  expect(track.segments).toHaveLength(1);
});

it('separates pauses, bad signal, long gaps and dateline crossings without joining them', () => {
  for (const gap of ['pause', 'quality', 'timeout']) {
    let track = append(append(emptyRecording(), point(0)), point(1));
    if (gap === 'pause') track = breakRecording(track);
    if (gap === 'quality') track = append(track, point(2, 7.6002, 100));
    track = append(track, point(gap === 'timeout' ? 20 : 3));
    expect(track.segments.map((segment) => segment.length)).toEqual([2, 1]);
  }
  let track = append(emptyRecording(), point(0, 179.999));
  track = append(track, point(10, -179.999));
  expect(track.segments).toHaveLength(2);
});

it('rejects invalid, stale, future and implausibly jumping fixes, then recovers on a separate segment', () => {
  const original = append(emptyRecording(), point(0));
  for (const sample of [
    { ...point(1), coordinate: [181, 45] as [number, number] },
    point(1, 7.7),
    point(1, 7.6, NaN),
  ]) {
    expect(append(original, sample).pointCount).toBe(1);
    expect(append(original, sample).newSegment).toBe(true);
  }
  expect(recordPoint(original, point(1), time + 30000).issue).toBe('stale');
  expect(recordPoint(original, point(30), time).issue).toBe('stale');
  const jump = append(original, point(1, 7.7));
  const recovered = append(jump, point(2));
  expect(recovered.segments).toHaveLength(2);
  expect(recovered.segments[1][0].coordinate).toEqual(point(2).coordinate);
  expect(append(original, point(0)).pointCount).toBe(1);
});

it('bounds capture points and segment count', () => {
  let track: ReturnType<typeof emptyRecording> = {
    ...emptyRecording(),
    pointCount: RECORDING_LIMITS.points,
  };
  expect(append(track, point(0)).issue).toBe('limit');
  track = {
    ...emptyRecording(),
    segments: Array.from({ length: RECORDING_LIMITS.segments }, () => [point(0)]),
  };
  expect(append(track, point(1)).issue).toBe('limit');
});

it('exports separate GPX segments and waypoint evidence that reimport without gaps or guessed direction', () => {
  let track = append(append(emptyRecording(), point(0)), point(1));
  track = append(breakRecording(track), point(2));
  track = append(breakRecording(track), point(4));
  track = append(track, point(5));
  const gpx = recordingGpx(track, 'A & <B>');
  const xml = new DOMParser().parseFromString(gpx, 'application/xml');
  expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
  expect(xml.getElementsByTagName('trkseg')).toHaveLength(2);
  expect(xml.getElementsByTagName('wpt')).toHaveLength(1);
  expect(xml.getElementsByTagName('hdop')).toHaveLength(0);
  expect(
    xml.getElementsByTagNameNS('https://github.com/Baudracco/gtt_trainer/ns/1', 'accuracyM'),
  ).toHaveLength(5);
  expect(xml.getElementsByTagName('name')[0].textContent).toBe('A & <B>');
  const documents = parseGpx(gpx, 'recorded.gpx');
  expect(documents).toHaveLength(2);
  expect(documents.map((doc) => doc.geometry.coordinates)).toEqual(
    recordingSegments(track).map((segment) => segment.points.map((p) => p.coordinate)),
  );
  expect(documents.every((doc) => doc.direction === 'none')).toBe(true);
});

it('exports sub-decimal coordinates without scientific notation or rounding', () => {
  const track = {
    ...emptyRecording(),
    segments: [
      [
        { ...point(0), coordinate: [1e-8, 0] as [number, number] },
        { ...point(1), coordinate: [1.5e-7, 0] as [number, number] },
      ],
    ],
  };
  expect(recordingGpx(track, 'Tiny')).toContain('lon="0.00000001"');
});

it('exports isolated observations as waypoint-only GPX without inventing a usable route', () => {
  let track = append(emptyRecording(), point(0));
  track = append(breakRecording(track), point(20));
  const xml = new DOMParser().parseFromString(recordingGpx(track, 'Isolated'), 'application/xml');
  expect(xml.getElementsByTagName('wpt')).toHaveLength(2);
  expect(xml.getElementsByTagName('trk')).toHaveLength(0);
  expect(xml.getElementsByTagName('trkseg')).toHaveLength(0);
  expect(recordingSegments(track)).toEqual([]);
  expect(() => recordingGpx(emptyRecording(), 'Empty')).toThrow();
});
