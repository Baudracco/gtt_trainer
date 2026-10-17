import { expect, it } from 'vitest';
import { compareRoutes } from './comparison';
import { emptyRoute, type RouteStop } from './model';

const stop: RouteStop = {
  id: 'A',
  code: '10',
  name: 'Test stop',
  coordinates: [7.6, 45],
  offsetM: 0,
  exchange: false,
  exchangeDirection: null,
  notes: '',
};

it('compares ordered occurrences without losing repeated visits or exchange direction', () => {
  const first = { ...emptyRoute(), stops: [stop, { ...stop, offsetM: 1000 }] };
  const second = structuredClone(first);
  second.stops[1] = { ...second.stops[1], exchange: true, exchangeDirection: 'ritorno' };
  const comparison = compareRoutes(first, second);
  expect(comparison.stopSequence).toBe(true);
  expect(comparison.memberships).toBe(false);
  expect(comparison.stopDifferences.map((difference) => difference.sequence)).toEqual([2]);
  expect(first.stops[1].exchange).toBe(false);
  second.stops.pop();
  expect(compareRoutes(first, second).stopSequence).toBe(false);
});

it('keeps reordered geometry, editorial notes, media and source evidence distinct', () => {
  const first = emptyRoute();
  first.geometry.coordinates = [
    [7.6, 45],
    [7.61, 45],
  ];
  const second = structuredClone(first);
  second.geometry.coordinates.reverse();
  second.notes = 'Check entrance';
  second.video = { id: 'private-video', caption: '', credit: '' };
  second.source.retrievedAt = '2026-01-01';
  const comparison = compareRoutes(first, second);
  expect(comparison).toMatchObject({ geometry: false, notes: false, video: false, source: false });
  expect(first.geometry.coordinates[0]).toEqual([7.6, 45]);
});
