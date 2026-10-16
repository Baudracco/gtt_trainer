import { describe, it, expect } from 'vitest';
import { advanceVirtual } from './virtual';
import { measure, pointAt } from './geometry';

describe('fixed route virtual playback', () => {
  it('advances at the requested speed and stops exactly at the endpoint', () => {
    expect(advanceVirtual(10, 36, 0.5, 100)).toBe(15);
    expect(advanceVirtual(99, 120, 1, 100)).toBe(100);
  });
  it('does not jump after a suspended background tab or move backwards', () => {
    expect(advanceVirtual(10, 36, 600, 1000)).toBe(20);
    expect(advanceVirtual(10, -36, -1, 1000)).toBe(10);
  });
  it('keeps repeated traversals in the saved order without modifying vertices', () => {
    const path = measure([
      [7.6, 45],
      [7.61, 45],
      [7.6, 45],
      [7.61, 45],
    ]);
    const original = JSON.stringify(path.coordinates);
    expect(pointAt(path, path.length * 0.5)[0]).toBeCloseTo(7.605, 4);
    expect(JSON.stringify(path.coordinates)).toBe(original);
  });
});
