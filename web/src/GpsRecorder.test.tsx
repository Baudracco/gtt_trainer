// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GpsRecorder } from './GpsRecorder';
import { Editor } from './Editor';
import { translator } from './i18n';
import { emptyRoute, type Coordinate, type RouteDocument } from './model';

const t = translator('es');
let clock: number;
let success: PositionCallback;
let failure: PositionErrorCallback;
let visibility: DocumentVisibilityState;
const watch = vi.fn((ok: PositionCallback, error?: PositionErrorCallback | null) => {
  success = ok;
  failure = error!;
  return watch.mock.calls.length;
});
const clear = vi.fn();
const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
beforeEach(() => {
  vi.clearAllMocks();
  clock = Date.parse('2026-01-01T12:00:00Z');
  visibility = 'visible';
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: watch, clearWatch: clear },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation);
  else Reflect.deleteProperty(navigator, 'geolocation');
});

function fix(longitude: number, seconds = 1) {
  clock += seconds * 1000;
  act(() => {
    success({
      timestamp: clock,
      coords: { longitude, latitude: 45.05, accuracy: 5 },
    } as GeolocationPosition);
  });
}
function signalError(code: number) {
  act(() => failure({ code } as GeolocationPositionError));
}
function recorder(canApply = true) {
  const props = {
    disabled: false,
    canApply,
    onApply: vi.fn(),
    onPreview: vi.fn(),
    onActiveChange: vi.fn(),
    follow: true,
    setFollow: vi.fn(),
    t,
  };
  const view = render(<GpsRecorder {...props} />);
  fireEvent.click(screen.getByText(t('gpsRecordTitle')));
  fireEvent.click(screen.getByRole('button', { name: t('gpsRecordStart') }));
  return { ...props, ...view };
}

it('captures locally and applies only the explicitly selected continuous segment after pausing', () => {
  const { onApply, onPreview, onActiveChange } = recorder();
  expect(onActiveChange).toHaveBeenLastCalledWith(true);
  expect(watch).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 15000,
  });
  fix(7.60000123);
  fix(7.60010123);
  signalError(2);
  expect(clear).not.toHaveBeenCalled();
  fix(7.60100123);
  fix(7.60110123);
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: t('gpsRecordApply') }).hasAttribute('disabled')).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: t('gpsRecordPause') }));
  expect(clear).toHaveBeenCalledWith(1);
  expect(onActiveChange).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByRole('combobox', { name: t('gpsRecordChoose') }), {
    target: { value: '1' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('gpsRecordApply') }));
  expect(onApply).toHaveBeenCalledExactlyOnceWith([
    [7.60100123, 45.05],
    [7.60110123, 45.05],
  ]);
  expect(onPreview).toHaveBeenLastCalledWith([]);
});

it('pauses on a hidden page, requires explicit resume and releases the watcher on unmount', () => {
  const { onActiveChange, onPreview, unmount } = recorder();
  fix(7.6);
  fix(7.6001);
  const late = success;
  visibility = 'hidden';
  fireEvent(document, new Event('visibilitychange'));
  expect(clear).toHaveBeenCalledExactlyOnceWith(1);
  expect(screen.getByText(t('gpsRecordHidden'))).toBeTruthy();
  expect(onActiveChange).toHaveBeenLastCalledWith(false);
  visibility = 'visible';
  fireEvent(document, new Event('visibilitychange'));
  expect(watch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: t('gpsRecordResume') }));
  expect(watch).toHaveBeenCalledTimes(2);
  fix(7.601);
  fix(7.6011);
  const segments = onPreview.mock.lastCall![0] as Coordinate[][];
  expect(segments.map((segment) => segment.length)).toEqual([2, 2]);
  act(() =>
    late({
      timestamp: clock + 1000,
      coords: { longitude: 7.9, latitude: 45, accuracy: 5 },
    } as GeolocationPosition),
  );
  expect(onPreview.mock.lastCall![0]).toEqual(segments);
  unmount();
  expect(clear).toHaveBeenLastCalledWith(2);
  expect(onActiveChange).toHaveBeenLastCalledWith(false);
  expect(onPreview).toHaveBeenLastCalledWith([]);
});

it('stops on permission denial and makes the error visible even before the first point', () => {
  const { onActiveChange } = recorder();
  signalError(1);
  expect(clear).toHaveBeenCalledExactlyOnceWith(1);
  expect(onActiveChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByText(t('gpsError'))).toBeTruthy();
  expect(screen.getByText(t('gpsRecordTitle')).closest('details')?.open).toBe(true);
});

it('prevents replacing existing geometry, stops or instructions with a capture', () => {
  const { onApply } = recorder(false);
  fix(7.6);
  fix(7.6001);
  fireEvent.click(screen.getByRole('button', { name: t('gpsRecordPause') }));
  const apply = screen.getByRole('button', { name: t('gpsRecordApply') });
  expect(apply.hasAttribute('disabled')).toBe(true);
  fireEvent.click(apply);
  expect(onApply).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: t('gpsRecordDownload') }).hasAttribute('disabled'),
  ).toBe(false);
});

it('allows downloading an isolated observation without offering it as route geometry', () => {
  recorder();
  fix(7.6);
  fireEvent.click(screen.getByRole('button', { name: t('gpsRecordPause') }));
  expect(screen.queryByRole('button', { name: t('gpsRecordApply') })).toBeNull();
  expect(
    screen.getByRole('button', { name: t('gpsRecordDownload') }).hasAttribute('disabled'),
  ).toBe(false);
});

it('preserves private source evidence and the chosen kind/direction when applying in the editor', () => {
  const initial = emptyRoute();
  initial.line = 'SYNTHETIC';
  initial.name = 'Synthetic movement';
  initial.kind = 'depot_in';
  initial.direction = 'none';
  initial.source.name = 'Synthetic PDF';
  initial.source.provenance = {
    documentSha256: 'a'.repeat(64),
    referenceId: 'synthetic-reference',
    movementId: 'synthetic-movement',
    pages: [1],
    title: 'Synthetic evidence',
    text: 'Road Alpha',
    textSha256: 'b'.repeat(64),
    streets: ['Road Alpha'],
  };
  const save = vi.fn();
  const changed = vi.fn();
  const active = vi.fn();
  function Harness() {
    const [doc, setDoc] = useState<RouteDocument>(initial);
    const [mode, setMode] = useState<'vertex' | 'stop' | null>('vertex');
    return (
      <Editor
        document={doc}
        setDocument={(value) => {
          changed(value);
          setDoc(value);
        }}
        previous={null}
        knownStops={[]}
        mode={mode}
        setMode={setMode}
        save={async () => {
          save(doc);
        }}
        close={vi.fn()}
        onRecordingActive={active}
        t={t}
      />
    );
  }
  render(<Harness />);
  fireEvent.click(screen.getByText(t('gpsRecordTitle')));
  fireEvent.click(screen.getByRole('button', { name: t('gpsRecordStart') }));
  expect(screen.getByRole('button', { name: 'Guardar borrador' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(screen.getByLabelText('Línea').closest('fieldset')?.disabled).toBe(true);
  fix(7.6);
  fix(7.6001);
  fireEvent.click(screen.getByRole('button', { name: t('gpsRecordPause') }));
  fireEvent.click(screen.getByRole('button', { name: t('gpsRecordApply') }));
  const result = changed.mock.lastCall![0] as RouteDocument;
  expect(result).toEqual({
    ...initial,
    geometry: {
      type: 'LineString',
      coordinates: [
        [7.6, 45.05],
        [7.6001, 45.05],
      ],
    },
  });
  expect(initial.geometry.coordinates).toEqual([]);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  expect(save).toHaveBeenCalledExactlyOnceWith(result);
});
