import { useEffect, useState } from 'react';
import type { RouteDocument, RouteSnapshot } from './model';
import type { Translate } from './i18n';
import { request } from './api';
import {
  linkedMovements,
  loadMovements,
  movementDraft,
  type DepotMovement,
  type MovementIndex,
} from './depotMovements';

type Reference = { id: string; line: string; pages: number[]; uscita: string; rientro: string };
type ChangePost = { line: string; place: string; access: string; notes: string; direction: null };

/** Review individual literal depot movements and resume linked variants without creating duplicates.
 * Whole source columns remain evidence only; they never become one mixed navigable route. */
export function References({
  t,
  routes = [],
  onAuthor,
  onOpenRoute,
  authenticated = false,
  onSignIn,
}: {
  t: Translate;
  routes?: RouteSnapshot[];
  onAuthor?: (doc: RouteDocument) => void;
  onOpenRoute?: (route: RouteSnapshot) => void;
  authenticated?: boolean;
  onSignIn?: () => void;
}) {
  const [index, setIndex] = useState<MovementIndex | null>(null),
    [movements, setMovements] = useState<DepotMovement[]>([]),
    [references, setReferences] = useState<Reference[]>([]),
    [changes, setChanges] = useState<ChangePost[]>([]),
    [search, setSearch] = useState(''),
    [depot, setDepot] = useState(''),
    [line, setLine] = useState(''),
    [kind, setKind] = useState(''),
    [linkedFilter, setLinkedFilter] = useState(''),
    [limit, setLimit] = useState(50),
    [error, setError] = useState(false);
  useEffect(() => {
    if (!authenticated) {
      setIndex(null);
      setMovements([]);
      setReferences([]);
      setChanges([]);
      return;
    }
    let live = true;
    void Promise.all([loadMovements(), request<{ posts: ChangePost[] }>('/references/changes')])
      .then(([catalogue, posts]) => {
        if (live) {
          setIndex(catalogue.index);
          setMovements(catalogue.movements);
          setChanges(posts.posts);
          setReferences(catalogue.references);
        }
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [authenticated]);
  const query = search.toLocaleLowerCase();
  const linked = index ? linkedMovements(routes, index) : new Map<string, RouteSnapshot[]>();
  const filtered = movements.filter(
    (m) =>
      (!depot || m.depotCode === depot) &&
      (!line || m.lineLabel === line) &&
      (!kind || m.kind === kind) &&
      (!linkedFilter || (linkedFilter === 'linked' ? linked.has(m.id) : !linked.has(m.id))) &&
      `${m.lineLabel} ${m.title} ${m.sourceText}`.toLocaleLowerCase().includes(query),
  );
  const linkedCount = movements.filter((m) => linked.has(m.id)).length;
  const depots = [...new Set(movements.map((m) => m.depotCode))].sort();
  if (!authenticated)
    return (
      <section className="references">
        <h1>{t('references')}</h1>
        <p>{t('privateReferences')}</p>
        {onSignIn && <button onClick={onSignIn}>{t('login')}</button>}
      </section>
    );
  return (
    <section className="references">
      <div className="eyebrow">GERBIDO · DAPER</div>
      <h1>{t('references')}</h1>
      <input
        type="search"
        aria-label={t('search')}
        placeholder={t('search')}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setLimit(50);
        }}
      />
      {error && (
        <p className="alert error" role="alert">
          {t('error')}
        </p>
      )}
      <h2>DAPER · {index?.version}</h2>
      {!index && !error && <p>{t('referencesNotImported')}</p>}
      {index && (
        <p>
          {index.movementCount} {t('individualMovements')} · {linkedCount} {t('withLinkedRoutes')} ·{' '}
          {index.effectiveFrom}
        </p>
      )}
      <p className="muted">{t('noGeometry')}</p>
      <div className="field-grid">
        <label>
          {t('line')}
          <select
            aria-label={t('line')}
            value={line}
            onChange={(e) => {
              setLine(e.target.value);
              setLimit(50);
            }}
          >
            <option value="">{t('allLines')}</option>
            {[...new Set(movements.map((m) => m.lineLabel))]
              .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
              .map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
          </select>
        </label>
        <label>
          {t('depotFilter')}
          <select
            aria-label={t('depotFilter')}
            value={depot}
            onChange={(e) => {
              setDepot(e.target.value);
              setLimit(50);
            }}
          >
            <option value="">{t('allDepots')}</option>
            {depots.map((d) => (
              <option key={d} value={d}>
                {d === 'san-paolo' ? 'San Paolo' : d.charAt(0).toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('kind')}
          <select
            aria-label={t('kind')}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setLimit(50);
            }}
          >
            <option value="">{t('allMovements')}</option>
            <option value="depot_out">{t('depot_out')}</option>
            <option value="depot_in">{t('depot_in')}</option>
          </select>
        </label>
        <label>
          {t('movementProgress')}
          <select
            aria-label={t('movementProgress')}
            value={linkedFilter}
            onChange={(e) => {
              setLinkedFilter(e.target.value);
              setLimit(50);
            }}
          >
            <option value="">{t('allMovements')}</option>
            <option value="pending">{t('movementPending')}</option>
            <option value="linked">{t('withLinkedRoutes')}</option>
          </select>
        </label>
      </div>
      {index && (
        <p className="muted">
          {Math.min(limit, filtered.length)} / {filtered.length}
        </p>
      )}
      {index && !filtered.length && <p>{t('noMatch')}</p>}
      {filtered.slice(0, limit).map((movement) => (
        <details key={movement.id} className="movement-card">
          <summary>
            <b>{movement.lineLabel}</b> · {movement.title} · {t('sourcePage')}{' '}
            {movement.pages.join(', ')}
            {linked.has(movement.id) && <span className="muted"> · {t('withLinkedRoutes')}</span>}
          </summary>
          <p>
            {t(movement.kind)} · {movement.depot}
          </p>
          <ol>
            {movement.streetSequence.map((street, i) => (
              <li key={i}>{street}</li>
            ))}
          </ol>
          <p className="source-text">{movement.sourceText}</p>
          {movement.reviewFlags.includes('source_condition_or_alternative') && (
            <p className="alert">{t('sourceConditions')}</p>
          )}
          {linked.get(movement.id)?.map((route) => (
            <p key={route.revisionId}>
              {route.name} · {t(route.status)} · r{route.revision}
              {onOpenRoute && (
                <button onClick={() => onOpenRoute(route)}>{t('resumeMovement')}</button>
              )}
            </p>
          ))}
          {onAuthor && index && !linked.has(movement.id) && (
            <button onClick={() => onAuthor(movementDraft(movement, index))}>
              {t('authorMovement')}
            </button>
          )}
        </details>
      ))}
      {filtered.length > limit && (
        <button onClick={() => setLimit((value) => value + 50)}>{t('moreMovements')}</button>
      )}
      <details>
        <summary>
          {t('sourceBlocks')} · {index?.sourceReferenceCount}
        </summary>
        {references
          .filter((r) => `${r.line} ${r.uscita} ${r.rientro}`.toLocaleLowerCase().includes(query))
          .map((ref) => (
            <details key={ref.id}>
              <summary>
                <b>{ref.line}</b> · {t('sourcePage')} {ref.pages.join(', ')}
              </summary>
              <h3>USCITA</h3>
              <p className="source-text">{ref.uscita || '—'}</p>
              <h3>RIENTRO</h3>
              <p className="source-text">{ref.rientro || '—'}</p>
            </details>
          ))}
      </details>
      <h2>{t('exchange')}</h2>
      <p className="muted">{t('noDirection')}</p>
      {changes
        .filter((p) => `${p.line} ${p.place} ${p.access}`.toLowerCase().includes(query))
        .map((p, i) => (
          <article className="reference-card" key={i}>
            <div className="section-heading">
              <span className="line-badge neutral">{p.line}</span>
              <strong>{p.place}</strong>
            </div>
            <p>
              {t('access')}: <b>{p.access || '—'}</b>
            </p>
            {p.notes && <small className="muted">{p.notes}</small>}
          </article>
        ))}
    </section>
  );
}
