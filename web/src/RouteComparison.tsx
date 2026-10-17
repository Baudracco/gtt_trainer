import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPARISON_COLORS, compareRoutes } from './comparison';
import { measure } from './geometry';
import type { Translate } from './i18n';
import type { RouteSnapshot, RouteStop } from './model';

/** Read-only A/B comparison with occurrence-specific stops and distinct map overlay colours. */
export function RouteComparison({
  first,
  second,
  t,
  close,
}: {
  first: RouteSnapshot;
  second: RouteSnapshot;
  t: Translate;
  close: () => void;
}) {
  const comparison = useMemo(() => compareRoutes(first, second), [first, second]);
  const [limit, setLimit] = useState(20);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const rows = [
    ['geometry', comparison.geometry],
    ['compareStopOrder', comparison.stopSequence],
    ['compareMemberships', comparison.memberships],
    ['instructions', comparison.instructions],
    ['notes', comparison.notes],
    ['source', comparison.source],
    ['routeVideo', comparison.video],
  ] as const;
  const stopLabel = (stop: RouteStop | null) => (stop ? `${stop.code} · ${stop.name}` : '—');
  const stopDetails = (stop: RouteStop | null) =>
    stop
      ? `${Math.round(stop.offsetM)} m${stop.exchange ? ` · ${t('exchange')} · ${t(stop.exchangeDirection && stop.exchangeDirection !== 'none' ? stop.exchangeDirection : 'unspecified')}` : ''}`
      : '';
  return (
    <section className="route-comparison" role="region" aria-label={t('compareTitle')}>
      <div className="section-heading">
        <h2 ref={heading} tabIndex={-1}>
          {t('compareTitle')}
        </h2>
        <button aria-label={t('closeComparison')} onClick={close}>
          ×
        </button>
      </div>
      <p className="muted">{t('compareHelp')}</p>
      <div className="comparison-pair">
        {[first, second].map((route, index) => (
          <article key={route.revisionId} style={{ borderColor: COMPARISON_COLORS[index] }}>
            <strong style={{ color: COMPARISON_COLORS[index] }}>
              {index === 0 ? 'A' : 'B'} · {route.line}
            </strong>
            <p>{route.name}</p>
            <small>
              r{route.revision} · {t(route.status)} ·{' '}
              {t(route.direction === 'none' ? 'unspecified' : route.direction)} · {t(route.kind)}
            </small>
            <p>
              {(measure(route.geometry.coordinates).length / 1000).toFixed(2)} km ·{' '}
              {route.stops.length} {t('stops')}
            </p>
          </article>
        ))}
      </div>
      <dl className="comparison-results">
        <div>
          <dt>{t('line')}</dt>
          <dd className={first.line === second.line ? '' : 'comparison-difference'}>
            {t(first.line === second.line ? 'compareSame' : 'compareDifferent')}
          </dd>
        </div>
        <div>
          <dt>{t('direction')}</dt>
          <dd className={first.direction === second.direction ? '' : 'comparison-difference'}>
            {t(first.direction === second.direction ? 'compareSame' : 'compareDifferent')}
          </dd>
        </div>
        <div>
          <dt>{t('kind')}</dt>
          <dd className={first.kind === second.kind ? '' : 'comparison-difference'}>
            {t(first.kind === second.kind ? 'compareSame' : 'compareDifferent')}
          </dd>
        </div>
        {rows.map(([label, same]) => (
          <div key={label}>
            <dt>{t(label)}</dt>
            <dd className={same ? '' : 'comparison-difference'}>
              {t(same ? 'compareSame' : 'compareDifferent')}
            </dd>
          </div>
        ))}
      </dl>
      {comparison.stopDifferences.length > 0 && (
        <details>
          <summary>
            {t('compareStopChanges')} · {comparison.stopDifferences.length}
          </summary>
          <ol className="comparison-stops">
            {comparison.stopDifferences.slice(0, limit).map((difference) => (
              <li key={difference.sequence} value={difference.sequence}>
                <p>
                  <b>A:</b> {stopLabel(difference.first)}
                  <small>{stopDetails(difference.first)}</small>
                  {difference.first?.notes && <small>{difference.first.notes}</small>}
                </p>
                <p>
                  <b>B:</b> {stopLabel(difference.second)}
                  <small>{stopDetails(difference.second)}</small>
                  {difference.second?.notes && <small>{difference.second.notes}</small>}
                </p>
              </li>
            ))}
          </ol>
          {comparison.stopDifferences.length > limit && (
            <button onClick={() => setLimit((old) => old + 20)}>{t('moreStopChanges')}</button>
          )}
        </details>
      )}
      {!comparison.notes && (
        <details>
          <summary>{t('notes')}</summary>
          <p>
            <b>A:</b> {first.notes || '—'}
          </p>
          <p>
            <b>B:</b> {second.notes || '—'}
          </p>
        </details>
      )}
      <p className="muted">{t('compareNoMerge')}</p>
    </section>
  );
}
