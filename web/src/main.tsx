import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RouteMap } from './RouteMap';
import { Editor } from './Editor';
import { References } from './References';
import { SyncStatus } from './SyncStatus';
import { RouteComparison } from './RouteComparison';
import { COMPARISON_COLORS } from './comparison';
import { MediaGallery } from './MediaGallery';
import { RouteVideo } from './RouteVideo';
import { VirtualTour } from './VirtualTour';
import {
  emptyRoute,
  groupStops,
  type Coordinate,
  type Direction,
  type RouteDocument,
  type RouteSnapshot,
  type User,
} from './model';
import { errorText, translator, type Language, type TextKey } from './i18n';
import * as api from './api';
import { cachePublished, readPublished } from './cache';
import { downloadDocument, importFile } from './importers';
import { matchFix, measure, nearestOffset, pointAt, type Progress } from './geometry';
import './style.css';

function preference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}
/** Orchestrate catalogue, revision workflow and mutually exclusive GPS/virtual study sessions. */
export function App() {
  const [lang, setLang] = useState<Language>(() =>
    preference('gtt-language', ['es', 'it', 'en'], 'es'),
  );
  const [theme, setTheme] = useState(() => preference('gtt-theme', ['light', 'dark'], 'light'));
  const t = useMemo(() => translator(lang), [lang]);
  const [routes, setRoutes] = useState<RouteSnapshot[]>([]),
    [visible, setVisible] = useState<string[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [activeId, setActive] = useState('');
  const [user, setUser] = useState<User | null>(null),
    [offline, setOffline] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [listLimit, setListLimit] = useState(100);
  const [search, setSearch] = useState(''),
    [direction, setDirection] = useState<Direction | ''>(''),
    [showStops, setShowStops] = useState(true),
    [common, setCommon] = useState(false),
    [exchangeOnly, setExchangeOnly] = useState(false),
    [stopId, setStopId] = useState('');
  const [loginOpen, setLoginOpen] = useState(false),
    [authBusy, setAuthBusy] = useState(false),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState('');
  const [editing, setEditing] = useState<RouteDocument | null>(null),
    [previous, setPrevious] = useState<RouteSnapshot | null>(null),
    [mode, setMode] = useState<'vertex' | 'stop' | null>(null);
  const [imports, setImports] = useState<RouteDocument[] | null>(null),
    [busy, setBusy] = useState(false),
    [trash, setTrash] = useState(false),
    [history, setHistory] = useState<
      { id: string; revision: number; status: string; created_at: string }[] | null
    >(null),
    [verified, setVerified] = useState(false);
  const [nav, setNav] = useState(false),
    [startOffset, setStartOffset] = useState(0),
    [progress, setProgress] = useState<Progress | null>(null),
    [position, setPosition] = useState<Coordinate | null>(null),
    [follow, setFollow] = useState(true),
    [voice, setVoice] = useState(false);
  const [virtualOpen, setVirtualOpen] = useState(false),
    [virtualPosition, setVirtualPosition] = useState<Coordinate | null>(null);
  const [tab, setTab] = useState<'routes' | 'references' | 'sources'>('routes');
  const [comparison, setComparison] = useState<[string, string] | null>(null);
  const progressRef = useRef<Progress | null>(null),
    spoken = useRef(''),
    initialized = useRef(false);
  const active = routes.find((r) => r.revisionId === activeId) ?? null;
  const editor = user?.role === 'editor' || user?.role === 'admin';
  const compared = useMemo(
    () =>
      comparison
        ?.map((id) => routes.find((r) => r.revisionId === id))
        .filter((r): r is RouteSnapshot => !!r) ?? [],
    [routes, comparison],
  );
  const comparing = compared.length === 2 && !editing && !nav && !virtualOpen && tab === 'routes';
  const visibleRoutes = useMemo(
    () => routes.filter((r) => visible.includes(r.revisionId)),
    [routes, visible],
  );
  const groups = useMemo(() => groupStops(visibleRoutes), [visibleRoutes]);
  const mapRoutes = useMemo(
    () =>
      visibleRoutes.map((route) => {
        const index = comparing
          ? compared.findIndex((item) => item.revisionId === route.revisionId)
          : -1;
        return index < 0 ? route : { ...route, color: COMPARISON_COLORS[index] };
      }),
    [visibleRoutes, compared, comparing],
  );
  const allGroups = useMemo(() => groupStops(routes), [routes]);
  const shownGroups = useMemo(
    () =>
      groups.filter(
        (g) =>
          (!common || g.lines.length > 1) &&
          (!exchangeOnly || g.memberships.some((m) => m.stop.exchange)),
      ),
    [groups, common, exchangeOnly],
  );
  const activeMeasure = useMemo(
    () => (active ? measure(active.geometry.coordinates) : null),
    [active],
  );
  const filtered = useMemo(
    () =>
      routes.filter(
        (r) =>
          (!direction || r.direction === direction) &&
          `${r.line} ${r.name} ${r.stops.map((s) => s.name).join(' ')}`
            .toLocaleLowerCase()
            .includes(search.toLocaleLowerCase()),
      ),
    [routes, direction, search],
  );
  const shownStop = allGroups.find((g) => g.stop.id === stopId);

  const refresh = useCallback(async (trashView = false, preferred?: string) => {
    const list = await api.request<RouteSnapshot[]>(`/routes${trashView ? '/trash' : ''}`);
    setRoutes(list);
    const firstLoad = !initialized.current;
    initialized.current = true;
    const initialPath = firstLoad
      ? /^\/routes\/([^/]+)\/revisions\/([^/]+)$/.exec(location.pathname)
      : null;
    const initial = list.find((r) => r.revisionId === (preferred ?? initialPath?.[2])) ?? list[0];
    // A large catalogue opens one line's variants; all remain selectable overlays.
    setVisible((old) =>
      firstLoad
        ? list.filter((r) => list.length <= 25 || r.line === initial?.line).map((r) => r.revisionId)
        : old.filter((id) => list.some((r) => r.revisionId === id)),
    );
    setActive((old) => {
      if (preferred && list.some((r) => r.revisionId === preferred)) return preferred;
      const path = firstLoad
        ? /^\/routes\/([^/]+)\/revisions\/([^/]+)$/.exec(location.pathname)
        : null;
      if (path && list.some((r) => r.id === path[1] && r.revisionId === path[2])) return path[2];
      return list.some((r) => r.revisionId === old) ? old : (list[0]?.revisionId ?? '');
    });
    setOffline(false);
    if (!trashView) void cachePublished(list).catch(() => {});
  }, []);
  useEffect(() => {
    void (async () => {
      try {
        setUser(await api.session());
        await refresh();
      } catch {
        const cached = await readPublished().catch(() => []);
        initialized.current = true;
        setRoutes(cached);
        setVisible(cached.map((r) => r.revisionId));
        setActive(cached[0]?.revisionId ?? '');
        setOffline(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('gtt-language', lang);
      localStorage.setItem('gtt-theme', theme);
    } catch {}
  }, [lang, theme]);
  useEffect(() => {
    if (!editing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [editing]);
  useEffect(() => {
    setStartOffset(0);
    setProgress(null);
    progressRef.current = null;
    setHistory(null);
    setVerified(false);
    setVirtualOpen(false);
    setVirtualPosition(null);
  }, [activeId]);
  useEffect(() => {
    if (active)
      window.history.replaceState(null, '', `/routes/${active.id}/revisions/${active.revisionId}`);
  }, [active?.id, active?.revisionId]);
  useEffect(() => {
    if (!nav || !activeMeasure) return;
    if (!navigator.geolocation) {
      setError(t('gpsError'));
      setNav(false);
      return;
    }
    const watcher = navigator.geolocation.watchPosition(
      (fix) => {
        const p: Coordinate = [fix.coords.longitude, fix.coords.latitude];
        const next = matchFix(
          activeMeasure,
          {
            coordinate: p,
            accuracy: fix.coords.accuracy,
            heading: fix.coords.heading,
            speed: fix.coords.speed,
            timestamp: fix.timestamp,
          },
          progressRef.current,
          startOffset,
        );
        progressRef.current = next;
        setProgress(next);
        if (next.state !== 'weak-gps') setPosition(p);
      },
      (error) => {
        if (error.code === 1) {
          setError(t('gpsError'));
          setNav(false);
          return;
        }
        // Position-unavailable and timeout are recoverable watch errors. Keep the
        // selected route and watcher; the next valid fix can resume tracking.
        const weak: Progress = progressRef.current
          ? { ...progressRef.current, state: 'weak-gps' }
          : {
              offsetM: startOffset,
              timestamp: 0,
              coordinate: pointAt(activeMeasure, startOffset),
              distanceM: 0,
              segment: 0,
              state: 'weak-gps',
            };
        if (progressRef.current) progressRef.current = weak;
        setProgress(weak);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(watcher);
  }, [nav, activeMeasure, startOffset, t]);
  useEffect(() => {
    setListLimit(100);
  }, [search, direction]);
  const nextStep = active?.instructions.find(
    (s) => s.offsetM > (progress?.offsetM ?? startOffset) + 8,
  );
  const nextStop = active?.stops.find((s) => s.offsetM > (progress?.offsetM ?? startOffset) + 10);
  const navTitle =
    nextStep?.text ??
    t(
      progress?.state === 'tracking' && (activeMeasure?.length ?? Infinity) - progress.offsetM < 15
        ? 'arrive'
        : 'continueRoute',
    );
  useEffect(() => {
    if (!nav || !voice || !progress || !('speechSynthesis' in window)) return;
    const key =
      progress.state !== 'tracking'
        ? progress.state
        : nextStep && nextStep.offsetM - progress.offsetM < 100
          ? `${activeId}-${nextStep.offsetM}`
          : '';
    if (key && key !== spoken.current) {
      spoken.current = key;
      const utterance = new SpeechSynthesisUtterance(
        progress.state === 'tracking' ? nextStep!.text : t(progress.state),
      );
      utterance.lang = { es: 'es-ES', it: 'it-IT', en: 'en-GB' }[lang];
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
    }
  }, [nav, voice, progress, nextStep, activeId, lang, t]);
  useEffect(() => {
    if (!nav) {
      spoken.current = '';
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    }
  }, [nav]);

  async function run(work: () => Promise<void>) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  }
  function edit(route: RouteSnapshot | null) {
    if (nav) return;
    setVirtualOpen(false);
    setPrevious(route);
    setEditing(route ? structuredClone(route) : emptyRoute());
    setMode(null);
  }
  function point(p: Coordinate) {
    if (!editing) return;
    if (mode === 'vertex')
      setEditing({
        ...editing,
        geometry: { type: 'LineString', coordinates: [...editing.geometry.coordinates, p] },
      });
    if (mode === 'stop') {
      const offsetM = Math.round(nearestOffset(measure(editing.geometry.coordinates), p));
      setEditing({
        ...editing,
        stops: [
          ...editing.stops,
          {
            id: crypto.randomUUID(),
            code: '',
            name: t('stops'),
            coordinates: p,
            offsetM,
            exchange: false,
            exchangeDirection: null,
            notes: '',
          },
        ].sort((a, b) => a.offsetM - b.offsetM),
      });
      setMode(null);
    }
  }
  async function save() {
    const result = await api.saveDocument(editing!, previous);
    await refresh(trash, result.revisionId);
    setVisible((old) => [...new Set([...old, result.revisionId])]);
    setEditing(null);
    setPrevious(null);
    setMode(null);
    setNotice(t('saved'));
  }
  async function transition(action: string, revisionId = active?.revisionId) {
    if (!active) return;
    const result = await api.request<RouteSnapshot>(`/routes/${active.id}/${action}`, 'POST', {
      expectedVersion: active.version,
      revisionId,
      verified,
    });
    await refresh(trash, result.revisionId);
    setVisible((old) => [...new Set([...old, result.revisionId])]);
    setHistory(null);
    setNotice(t('changed'));
  }
  function openComparison(pair: RouteSnapshot[]) {
    if (pair.length !== 2 || nav || virtualOpen || editing) return;
    const ids: [string, string] = [pair[0].revisionId, pair[1].revisionId];
    setComparison(ids);
    setSelected(ids);
    setVisible(ids);
    setActive(ids[0]);
    setTab('routes');
  }
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-symbol">G</span>
          <span>
            GTT <b>TRAINER</b>
            <small>{t('study')}</small>
          </span>
        </a>
        <div className="header-tools">
          <select
            aria-label="Language"
            value={lang}
            onChange={(e) => setLang(e.target.value as Language)}
          >
            <option value="es">ES</option>
            <option value="it">IT</option>
            <option value="en">EN</option>
          </select>
          <button
            className="icon-button"
            aria-label={theme === 'light' ? 'Dark theme' : 'Light theme'}
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          >
            ◐
          </button>
          {user ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setNav(false);
                  setVirtualOpen(false);
                  setPosition(null);
                  await api.logout();
                  setUser(null);
                  setEditing(null);
                  setImports(null);
                  setTrash(false);
                  await refresh();
                })
              }
            >
              {t('logout')}
            </button>
          ) : (
            <button disabled={offline} onClick={() => setLoginOpen(true)}>
              {t('login')}
            </button>
          )}
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <nav className="tabs">
            <button className={tab === 'routes' ? 'selected' : ''} onClick={() => setTab('routes')}>
              {t('routes')}
            </button>
            <button
              className={tab === 'references' ? 'selected' : ''}
              onClick={() => setTab('references')}
            >
              {t('references')}
            </button>
            {editor && (
              <button
                className={tab === 'sources' ? 'selected' : ''}
                onClick={() => setTab('sources')}
              >
                {t('syncTitle')}
              </button>
            )}
          </nav>
          {offline && (
            <div className="alert">
              {t('offline')}
              <p className="muted">{t('offlineHelp')}</p>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button aria-label={t('close')} onClick={() => setError('')}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <p className="alert success" role="status">
              {notice}
            </p>
          )}
          {editing ? (
            <Editor
              document={editing}
              setDocument={setEditing}
              previous={previous}
              knownStops={allGroups.map((g) => g.stop)}
              mode={mode}
              setMode={setMode}
              save={save}
              close={() => {
                setEditing(null);
                setMode(null);
              }}
              t={t}
            />
          ) : tab === 'sources' && editor ? (
            <SyncStatus
              t={t}
              routes={routes}
              onCompare={
                !nav && !virtualOpen
                  ? (ids) => openComparison(routes.filter((r) => ids.includes(r.id)))
                  : undefined
              }
            />
          ) : tab === 'references' ? (
            <References
              t={t}
              authenticated={!!user}
              onSignIn={() => setLoginOpen(true)}
              routes={routes}
              onOpenRoute={
                editor && !offline && !nav
                  ? (route) => {
                      edit(route);
                      setTab('routes');
                    }
                  : undefined
              }
              onAuthor={
                editor && !offline && !nav
                  ? (doc) => {
                      setVirtualOpen(false);
                      setPrevious(null);
                      setEditing(doc);
                      setMode(null);
                      setTab('routes');
                    }
                  : undefined
              }
            />
          ) : (
            <>
              <section className="route-browser">
                <div className="eyebrow">TORINO · GTT</div>
                <h1>{t('heading')}</h1>
                <div className="search">
                  <span>⌕</span>
                  <input
                    type="search"
                    aria-label={t('search')}
                    placeholder={t('search')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="field-grid filters">
                  <select
                    aria-label={t('direction')}
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as Direction | '')}
                  >
                    <option value="">{t('any')}</option>
                    {['andata', 'ritorno', 'circular'].map((v) => (
                      <option key={v} value={v}>
                        {t(v as TextKey)}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={loading || busy || nav}
                    onClick={() =>
                      void run(async () => {
                        setUser(await api.session());
                        await refresh(trash);
                      })
                    }
                  >
                    {t('reload')}
                  </button>
                </div>
                <div className="button-row visibility">
                  <button onClick={() => setVisible(routes.map((r) => r.revisionId))}>
                    {t('all')}
                  </button>
                  <button disabled={nav || virtualOpen} onClick={() => setVisible([])}>
                    {t('none')}
                  </button>
                  <button
                    onClick={() =>
                      setVisible(
                        nav || virtualOpen ? [...new Set([...selected, activeId])] : selected,
                      )
                    }
                  >
                    {t('selected')}
                  </button>
                  <button
                    disabled={
                      nav ||
                      virtualOpen ||
                      routes.filter((r) => selected.includes(r.revisionId)).length !== 2
                    }
                    onClick={() =>
                      openComparison(routes.filter((r) => selected.includes(r.revisionId)))
                    }
                  >
                    {t('compareSelected')}
                  </button>
                </div>
                <p className="muted">{t('compareSelectionHelp')}</p>
                <div className="section-heading">
                  <h2>
                    {t('routes')} <span className="count">{filtered.length}</span>
                  </h2>
                  {editor && (
                    <button
                      className={trash ? 'selected' : ''}
                      disabled={nav || busy || offline}
                      onClick={() =>
                        void run(async () => {
                          const next = !trash;
                          await refresh(next);
                          setTrash(next);
                        })
                      }
                    >
                      {t('trash')}
                    </button>
                  )}
                </div>
                {loading ? (
                  <p aria-busy="true">…</p>
                ) : routes.length === 0 ? (
                  <p className="empty">{t('empty')}</p>
                ) : filtered.length === 0 ? (
                  <p>{t('noMatch')}</p>
                ) : (
                  <div className="route-list">
                    {filtered.slice(0, listLimit).map((route) => (
                      <article
                        className={`route-card ${activeId === route.revisionId ? 'active' : ''}`}
                        key={route.revisionId}
                        style={{ '--route-color': route.color } as React.CSSProperties}
                      >
                        <div className="route-card-main">
                          <label className="route-visibility" title={t('map')}>
                            <input
                              type="checkbox"
                              aria-label={`${t('map')} ${route.line} ${route.name}`}
                              checked={visible.includes(route.revisionId)}
                              disabled={(nav || virtualOpen) && activeId === route.revisionId}
                              onChange={(e) =>
                                setVisible((old) =>
                                  e.target.checked
                                    ? [...new Set([...old, route.revisionId])]
                                    : old.filter((id) => id !== route.revisionId),
                                )
                              }
                            />
                            <span className="line-badge">{route.line}</span>
                          </label>
                          <button
                            className="route-title"
                            disabled={nav}
                            onClick={() => {
                              setActive(route.revisionId);
                              setVisible((old) => [...new Set([...old, route.revisionId])]);
                            }}
                          >
                            <strong>{route.name}</strong>
                            <small>
                              {t(route.direction === 'none' ? 'unspecified' : route.direction)} ·{' '}
                              {t(route.kind)} · {t(route.status)}
                            </small>
                          </button>
                        </div>
                        <div className="route-card-bottom">
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={selected.includes(route.revisionId)}
                              onChange={(e) =>
                                setSelected((old) =>
                                  e.target.checked
                                    ? [...old, route.revisionId]
                                    : old.filter((id) => id !== route.revisionId),
                                )
                              }
                            />
                            {t('selected')}
                          </label>
                          <span>
                            {route.stops.length} {t('stops').toLowerCase()} · r{route.revision}
                          </span>
                        </div>
                      </article>
                    ))}
                    {filtered.length > listLimit && (
                      <button onClick={() => setListLimit((value) => value + 100)}>
                        {t('moreRoutes')} ({filtered.length - listLimit})
                      </button>
                    )}
                  </div>
                )}
                {editor && !trash && (
                  <div className="button-row author-tools">
                    <button
                      disabled={nav || offline}
                      className="primary"
                      onClick={() => edit(null)}
                    >
                      + {t('new')}
                    </button>
                    <label className="button upload">
                      {t('import')}
                      <input
                        type="file"
                        disabled={nav || offline}
                        accept=".json,.geojson,.gpx"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void run(async () => setImports(await importFile(file)));
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                )}
              </section>
              {comparing && (
                <RouteComparison
                  key={comparison!.join(':')}
                  first={compared[0]}
                  second={compared[1]}
                  t={t}
                  close={() => setComparison(null)}
                />
              )}
              {active && (
                <section className="route-detail">
                  <div className="section-heading">
                    <h2>{t('active')}</h2>
                    <span className="status">{t(active.status)}</span>
                  </div>
                  <h3>
                    <span style={{ color: active.color }}>{active.line}</span> · {active.name}
                  </h3>
                  <div className="route-stats">
                    <span>
                      <b>{((activeMeasure?.length ?? 0) / 1000).toFixed(2)}</b> km
                    </span>
                    <span>
                      <b>{active.stops.length}</b> {t('stops')}
                    </span>
                    <span>
                      <b>{active.instructions.length}</b> {t('instructions')}
                    </span>
                  </div>
                  <p className="route-notes">{active.notes}</p>
                  <div className="button-row">
                    <a
                      className="button"
                      target="_blank"
                      rel="noreferrer"
                      href={api.reportUrl(active, lang, 'pdf')}
                      aria-disabled={offline}
                    >
                      {t('report')}
                    </a>
                    <a
                      className="button"
                      target="_blank"
                      rel="noreferrer"
                      href={api.reportUrl(active, lang, 'html')}
                    >
                      {t('print')}
                    </a>
                    <button onClick={() => downloadDocument(active)}>{t('export')}</button>
                  </div>
                  {editor && !nav && !offline && (
                    <div className="workflow">
                      <div className="button-row">
                        {!trash && <button onClick={() => edit(active)}>{t('edit')}</button>}
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () =>
                              setHistory(await api.request(`/routes/${active.id}/history`)),
                            )
                          }
                        >
                          {t('history')}
                        </button>
                        {trash ? (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await transition('restore');
                                await refresh(true);
                              })
                            }
                          >
                            {t('restore')}
                          </button>
                        ) : (
                          <button
                            className="danger-text"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api.request(`/routes/${active.id}`, 'DELETE', {
                                  expectedVersion: active.version,
                                });
                                await refresh();
                              })
                            }
                          >
                            {t('delete')}
                          </button>
                        )}
                      </div>
                      {!trash && active.status === 'draft' && (
                        <button
                          disabled={busy}
                          onClick={() => void run(() => transition('review'))}
                        >
                          {t('submit')}
                        </button>
                      )}
                      {!trash && active.status === 'review' && user?.role === 'admin' && (
                        <>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={verified}
                              onChange={(e) => setVerified(e.target.checked)}
                            />
                            {t('verified')}
                          </label>
                          <button
                            className="primary"
                            disabled={!verified || busy}
                            onClick={() => void run(() => transition('publish'))}
                          >
                            {t('publish')}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {history && (
                    <div className="history">
                      <h3>{t('history')}</h3>
                      {history.map((r) => (
                        <div key={r.id}>
                          <span>
                            r{r.revision} · {t(r.status as TextKey)}
                          </span>
                          <button
                            disabled={busy || nav || trash}
                            onClick={() => void run(() => transition('revert', r.id))}
                          >
                            {t('revert')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {!trash && (
                    <section className="navigation-panel">
                      <h3>{t('start')}</h3>
                      <p className="muted">{t('gpsLocal')}</p>
                      <label>
                        {t('startAt')}
                        <select
                          disabled={nav}
                          value={startOffset}
                          onChange={(e) => {
                            setStartOffset(Number(e.target.value));
                            progressRef.current = null;
                            setProgress(null);
                          }}
                        >
                          <option value={0}>{t('beginning')}</option>
                          {active.stops.map((s, i) => (
                            <option key={i} value={s.offsetM}>
                              {i + 1} · {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={voice}
                          onChange={(e) => setVoice(e.target.checked)}
                        />
                        {t('voice')}
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={follow}
                          onChange={(e) => setFollow(e.target.checked)}
                        />
                        {t('follow')}
                      </label>
                      <button
                        className={nav ? 'danger' : 'primary'}
                        onClick={() => {
                          setVirtualOpen(false);
                          setNav(!nav);
                          setPosition(null);
                          setError('');
                          progressRef.current = null;
                          setProgress(null);
                          setVisible((old) => [...new Set([...old, active.revisionId])]);
                        }}
                      >
                        {t(nav ? 'stop' : 'start')}
                      </button>
                    </section>
                  )}
                  <button
                    className="virtual-start"
                    disabled={nav || Boolean(editing)}
                    onClick={() => {
                      setVirtualOpen(true);
                      setFollow(true);
                      setVisible((old) => [...new Set([...old, active.revisionId])]);
                    }}
                  >
                    {t('virtualTour')}
                  </button>
                  <details>
                    <summary>
                      {t('instructions')} · {active.instructions.length}
                    </summary>
                    <ol className="instructions">
                      {active.instructions.map((s, i) => {
                        const p = pointAt(activeMeasure!, s.offsetM);
                        return (
                          <li key={i}>
                            <span className="offset">{Math.round(s.offsetM)} m</span>
                            <strong>{s.text}</strong>
                            {s.notes && <p>{s.notes}</p>}
                            <MediaGallery photos={s.photos ?? []} fallback={s.text} />
                            <a
                              className="corner-link"
                              href={`https://api.panoramax.xyz/?focus=map&map=18/${p[1]}/${p[0]}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {t('exploreCorner')}
                            </a>
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                  {active.video && (
                    <details>
                      <summary>{t('routeVideo')}</summary>
                      <RouteVideo id={active.video.id} t={t} />
                      {active.video.caption && <p>{active.video.caption}</p>}
                      {active.video.credit && <small>{active.video.credit}</small>}
                    </details>
                  )}
                  <details>
                    <summary>{t('source')}</summary>
                    <p>{active.source.name}</p>
                    {active.source.url && (
                      <a href={active.source.url} target="_blank" rel="noreferrer">
                        {active.source.url}
                      </a>
                    )}
                    <p className="muted">
                      {active.source.license} · {active.source.retrievedAt}
                    </p>
                  </details>
                </section>
              )}
              <section className="stops-panel">
                <h2>
                  {t('stops')} <span className="count">{shownGroups.length}</span>
                </h2>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={showStops}
                    onChange={(e) => setShowStops(e.target.checked)}
                  />
                  {t('stops')}
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={common}
                    onChange={(e) => setCommon(e.target.checked)}
                  />
                  {t('common')}
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={exchangeOnly}
                    onChange={(e) => setExchangeOnly(e.target.checked)}
                  />
                  {t('exchangesOnly')}
                </label>
                <ul className="stop-list">
                  {shownGroups.map((g) => (
                    <li key={g.stop.id}>
                      <button
                        className={stopId === g.stop.id ? 'selected' : ''}
                        onClick={() => setStopId(g.stop.id)}
                      >
                        <span
                          className={`stop-dot ${g.memberships.some((m) => m.stop.exchange) ? 'exchange' : ''}`}
                        />
                        <span>
                          <strong>
                            {g.stop.code} {g.stop.name}
                          </strong>
                          <small>{g.lines.join(' · ')}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {shownStop && (
                  <div className="stop-detail">
                    <h3>{shownStop.stop.name}</h3>
                    {shownStop.memberships.map((m, i) => (
                      <p key={i}>
                        {m.route.line} ·{' '}
                        {t(m.route.direction === 'none' ? 'unspecified' : m.route.direction)}
                        {m.stop.exchange && (
                          <>
                            {' '}
                            ·{' '}
                            <b>
                              {t('exchange')} · {t(m.stop.exchangeDirection as TextKey)}
                            </b>
                          </>
                        )}
                        {m.stop.notes && <small>{m.stop.notes}</small>}
                      </p>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
          <footer>
            GTT Trainer · <span>© OpenStreetMap contributors</span>
            <p className="muted">{user?.email}</p>
          </footer>
        </aside>
        <main className="map-panel">
          <RouteMap
            routes={mapRoutes}
            comparisonIds={comparing ? (comparison ?? undefined) : undefined}
            active={activeId}
            groups={shownGroups}
            showStops={showStops}
            edit={editing}
            drawMode={mode}
            onPoint={point}
            onStop={setStopId}
            position={nav ? position : virtualOpen ? virtualPosition : null}
            follow={(nav || virtualOpen) && follow}
            t={t}
          />
          <div className="map-label">
            <span className="live-dot" />
            {t('study')}
          </div>
          {virtualOpen && active && (
            <VirtualTour
              key={active.revisionId}
              route={active}
              onPosition={setVirtualPosition}
              close={() => setVirtualOpen(false)}
              follow={follow}
              setFollow={setFollow}
              t={t}
            />
          )}
          {mode && (
            <div className="draw-hint">
              {t(mode === 'vertex' ? 'vertexHint' : 'stopHint')}
              <button onClick={() => setMode(null)}>{t('stopDrawing')}</button>
            </div>
          )}
          {nav && (
            <div className="navigation-hud" aria-live="polite">
              <div className={`nav-state ${progress?.state ?? 'waiting'}`}>
                {t(progress?.state ?? 'waiting')}
              </div>
              <h2>{navTitle}</h2>
              {nextStep && (
                <p>
                  {Math.max(0, Math.round(nextStep.offsetM - (progress?.offsetM ?? startOffset)))} m
                </p>
              )}
              {nextStep?.notes && <p>{nextStep.notes}</p>}
              {!!nextStep?.photos?.length && (
                <MediaGallery photos={nextStep.photos.slice(0, 1)} fallback={nextStep.text} />
              )}{' '}
              {nextStop && (
                <p>
                  {t('nextStop')}: <b>{nextStop.name}</b>
                  {nextStop.exchange && <> · {t('exchange')}</>}
                </p>
              )}
              <progress max={activeMeasure?.length || 1} value={progress?.offsetM ?? startOffset} />
              <small>
                {t('remaining')}:{' '}
                {(
                  ((activeMeasure?.length ?? 0) - (progress?.offsetM ?? startOffset)) /
                  1000
                ).toFixed(2)}{' '}
                km
              </small>
            </div>
          )}
        </main>
      </div>
      {loginOpen && (
        <div className="modal-backdrop">
          <form
            className="modal"
            onSubmit={(e) => {
              e.preventDefault();
              setAuthBusy(true);
              void run(async () => {
                setUser(await api.login(email, password));
                setPassword('');
                setLoginOpen(false);
                await refresh();
              }).finally(() => setAuthBusy(false));
            }}
          >
            <h2>{t('login')}</h2>
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
            <label>
              {t('email')}
              <input
                autoFocus
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              {t('password')}
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <div className="button-row">
              <button type="submit" className="primary" disabled={authBusy}>
                {t('login')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginOpen(false);
                  setPassword('');
                }}
              >
                {t('cancel')}
              </button>
            </div>
          </form>
        </div>
      )}
      {imports && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>{t('importPreview')}</h2>
            <p>{t('importHelp')}</p>
            <ul>
              {imports.map((doc, i) => (
                <li key={i}>
                  {doc.line} · {doc.name} · {doc.geometry.coordinates.length} ·{' '}
                  {t(doc.direction === 'none' ? 'unspecified' : doc.direction)}
                </li>
              ))}
            </ul>
            <div className="button-row">
              <button
                disabled={busy}
                className="primary"
                onClick={() =>
                  void run(async () => {
                    const result = await api.request<RouteSnapshot[]>('/imports', 'POST', {
                      documents: imports,
                    });
                    setImports(null);
                    await refresh(false, result[0]?.revisionId);
                    setVisible((old) => [...new Set([...old, ...result.map((r) => r.revisionId)])]);
                    setNotice(t('saved'));
                  })
                }
              >
                {t('save')}
              </button>
              <button disabled={busy} onClick={() => setImports(null)}>
                {t('cancel')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
const rootNode = document.getElementById('root');
if (rootNode)
  createRoot(rootNode).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
