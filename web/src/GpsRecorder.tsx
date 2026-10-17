import { useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinate } from './model';
import type { Translate, TextKey } from './i18n';
import { measure } from './geometry';
import {
  breakRecording,
  emptyRecording,
  recordPoint,
  recordingGpx,
  recordingSegments,
  RECORDING_LIMITS,
} from './recording';

type Props = {
  disabled: boolean;
  canApply: boolean;
  onApply: (coordinates: Coordinate[]) => void;
  onPreview: (segments: Coordinate[][]) => void;
  onActiveChange: (active: boolean) => void;
  follow: boolean;
  setFollow: (follow: boolean) => void;
  t: Translate;
};

/** Capture foreground device observations in memory and review independent fixed-path segments.
 * Closing, pausing, permission denial and a hidden document release the watcher.
 * Nothing is uploaded automatically; applying one segment is an explicit editor action. */
export function GpsRecorder({
  disabled,
  canApply,
  onApply,
  onPreview,
  onActiveChange,
  follow,
  setFollow,
  t,
}: Props) {
  const [track, setTrack] = useState(emptyRecording),
    [active, setActive] = useState(false),
    [notice, setNotice] = useState<TextKey | ''>(''),
    [selected, setSelected] = useState(0),
    [applied, setApplied] = useState<number | null>(null);
  const activeRef = useRef(false);
  const usable = useMemo(() => recordingSegments(track), [track.segments]);
  const chosen = usable.find((segment) => segment.index === selected) ?? usable[0];
  const full = track.pointCount >= RECORDING_LIMITS.points || track.issue === 'limit';
  const length = useMemo(
    () =>
      usable.reduce(
        (sum, segment) => sum + measure(segment.points.map((point) => point.coordinate)).length,
        0,
      ),
    [usable],
  );
  function stop(message: TextKey | '' = '') {
    activeRef.current = false;
    setActive(false);
    onActiveChange(false);
    setTrack(breakRecording);
    setNotice(message);
  }
  useEffect(() => {
    if (!active) return;
    if (!navigator.geolocation) {
      stop('gpsError');
      return;
    }
    if (window.document.visibilityState === 'hidden') {
      stop('gpsRecordHidden');
      return;
    }
    let live = true;
    activeRef.current = true;
    let watcher: number;
    try {
      watcher = navigator.geolocation.watchPosition(
        (position) => {
          if (!live || !activeRef.current) return;
          setTrack((current) =>
            recordPoint(current, {
              coordinate: [position.coords.longitude, position.coords.latitude],
              accuracy: position.coords.accuracy,
              timestamp: position.timestamp,
            }),
          );
          setNotice('');
        },
        (error) => {
          if (!live || !activeRef.current) return;
          if (error.code === 1) stop('gpsError');
          else {
            setTrack(breakRecording);
            setNotice('gpsRecordSignal');
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
      );
    } catch {
      stop('gpsError');
      return;
    }
    const visibility = () => {
      if (window.document.visibilityState === 'hidden') stop('gpsRecordHidden');
    };
    window.document.addEventListener('visibilitychange', visibility);
    return () => {
      live = false;
      navigator.geolocation.clearWatch(watcher);
      window.document.removeEventListener('visibilitychange', visibility);
    };
  }, [active]);
  useEffect(() => {
    onPreview(track.segments.map((segment) => segment.map((point) => point.coordinate)));
  }, [track.segments, onPreview]);
  useEffect(
    () => () => {
      activeRef.current = false;
      onActiveChange(false);
      onPreview([]);
    },
    [onActiveChange, onPreview],
  );
  useEffect(() => {
    if (active && full) stop('gpsRecordLimit');
  }, [active, full]);

  function start() {
    if (disabled || full) return;
    setTrack((current) => ({ ...breakRecording(current), issue: null }));
    setNotice('');
    setApplied(null);
    activeRef.current = true;
    onActiveChange(true);
    setActive(true);
  }
  function download() {
    try {
      const xml = recordingGpx(track, t('gpsRecordTitle'));
      const blob = new Blob([xml], { type: 'application/gpx+xml' });
      const link = window.document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'gtt-recording.gpx';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch {
      setNotice('gpsRecordExportError');
    }
  }
  return (
    <details className="gps-recorder" open={active || track.pointCount > 0 || Boolean(notice)}>
      <summary>{t('gpsRecordTitle')}</summary>
      <p className="muted">{t('gpsRecordHelp')}</p>
      <div className="button-row">
        {active ? (
          <button className="recording-stop" onClick={() => stop()}>
            {t('gpsRecordPause')}
          </button>
        ) : (
          <button disabled={disabled || full} onClick={start}>
            {t(track.pointCount ? 'gpsRecordResume' : 'gpsRecordStart')}
          </button>
        )}
        {!active && (track.pointCount > 0 || track.rejected > 0) && (
          <button
            disabled={disabled}
            onClick={() => {
              setTrack(emptyRecording());
              setNotice('');
              setApplied(null);
              setSelected(0);
            }}
          >
            {t('gpsRecordDiscard')}
          </button>
        )}
      </div>
      {active && (
        <p className="recording-state" role="status">
          ● {t(track.observed ? 'gpsRecordLive' : 'waiting')}
        </p>
      )}
      {notice && (
        <p className="alert" role="status">
          {t(notice)}
        </p>
      )}
      {active && track.issue && track.issue !== 'order' && (
        <p className="alert">{t('gpsRecordSignal')}</p>
      )}
      <p className="recording-stats">
        {track.pointCount} {t('gpsRecordPoints')} · {usable.length} {t('gpsRecordSegments')} ·{' '}
        {(length / 1000).toFixed(2)} km
      </p>
      {track.observed && (
        <p className="muted">
          {t('gpsRecordAccuracy')}: {track.observed.accuracy.toFixed(1)} m · {track.rejected}{' '}
          {t('gpsRecordRejected')}
        </p>
      )}
      {active && (
        <label className="check">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />
          {t('follow')}
        </label>
      )}
      {!!usable.length && (
        <>
          <label>
            {t('gpsRecordChoose')}
            <select
              aria-label={t('gpsRecordChoose')}
              value={chosen?.index ?? ''}
              disabled={active || disabled}
              onChange={(event) => setSelected(Number(event.target.value))}
            >
              {usable.map((segment) => (
                <option key={segment.index} value={segment.index}>
                  {segment.index + 1} · {segment.points.length} {t('gpsRecordPoints')} ·{' '}
                  {(measure(segment.points.map((point) => point.coordinate)).length / 1000).toFixed(
                    2,
                  )}{' '}
                  km
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {track.pointCount > 0 && (
        <div className="button-row">
          {chosen && (
            <button
              disabled={active || disabled || !canApply}
              onClick={() => {
                onApply(chosen.points.map((point) => [...point.coordinate] as Coordinate));
                onPreview([]);
                setApplied(chosen.index);
              }}
            >
              {t('gpsRecordApply')}
            </button>
          )}
          <button disabled={active || disabled} onClick={download}>
            {t('gpsRecordDownload')}
          </button>
        </div>
      )}
      {applied !== null && <p className="muted">{t('gpsRecordApplied')}</p>}
      {!!usable.length && !canApply && applied === null && (
        <p className="muted">{t('gpsRecordHasGeometry')}</p>
      )}
      {track.segments.length > 1 && <p className="muted">{t('gpsRecordGaps')}</p>}
    </details>
  );
}
