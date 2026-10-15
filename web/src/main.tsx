import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RouteMap} from './RouteMap';
import {Editor} from './Editor';
import {References} from './References';
import {emptyRoute, groupStops, type Coordinate, type Direction, type RouteDocument, type RouteSnapshot, type User} from './model';
import {errorText, translator, type Language, type TextKey} from './i18n';
import * as api from './api';
import {cachePublished, readPublished} from './cache';
import {downloadDocument, importFile} from './importers';
import {matchFix, measure, nearestOffset, type Progress} from './geometry';
import './style.css';

function preference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {const value = localStorage.getItem(key); return allowed.includes(value as T) ? value as T : fallback;} catch {return fallback;}
}
export function App() {
  const [lang,setLang] = useState<Language>(() => preference('gtt-language',['es','it','en'],'es'));
  const [theme,setTheme] = useState(() => preference('gtt-theme',['light','dark'],'light'));
  const t = useMemo(() => translator(lang),[lang]);
  const [routes,setRoutes] = useState<RouteSnapshot[]>([]), [visible,setVisible] = useState<string[]>([]), [selected,setSelected] = useState<string[]>([]), [activeId,setActive] = useState('');
  const [user,setUser] = useState<User | null>(null), [offline,setOffline] = useState(false), [loading,setLoading] = useState(true), [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [search,setSearch] = useState(''), [direction,setDirection] = useState<Direction | ''>(''), [showStops,setShowStops] = useState(true), [common,setCommon] = useState(false), [exchangeOnly,setExchangeOnly] = useState(false), [stopId,setStopId] = useState('');
  const [loginOpen,setLoginOpen] = useState(false), [authBusy,setAuthBusy] = useState(false), [email,setEmail] = useState(''), [password,setPassword] = useState('');
  const [editing,setEditing] = useState<RouteDocument | null>(null), [previous,setPrevious] = useState<RouteSnapshot | null>(null), [mode,setMode] = useState<'vertex' | 'stop' | null>(null);
  const [imports,setImports] = useState<RouteDocument[] | null>(null), [busy,setBusy] = useState(false), [trash,setTrash] = useState(false), [history,setHistory] = useState<{id:string;revision:number;status:string;created_at:string}[] | null>(null), [verified,setVerified] = useState(false);
  const [nav,setNav] = useState(false), [startOffset,setStartOffset] = useState(0), [progress,setProgress] = useState<Progress | null>(null), [position,setPosition] = useState<Coordinate | null>(null), [follow,setFollow] = useState(true), [voice,setVoice] = useState(false);
  const [tab,setTab] = useState<'routes' | 'references'>('routes');
  const progressRef = useRef<Progress | null>(null), spoken = useRef('');
  const active = routes.find(r => r.revisionId === activeId) ?? null;
  const editor = user?.role === 'editor' || user?.role === 'admin';
  const visibleRoutes = useMemo(() => routes.filter(r => visible.includes(r.revisionId)),[routes,visible]);
  const groups = useMemo(() => groupStops(visibleRoutes),[visibleRoutes]);
  const allGroups = useMemo(() => groupStops(routes),[routes]);
  const shownGroups = useMemo(() => groups.filter(g => (!common || g.lines.length > 1) && (!exchangeOnly || g.memberships.some(m => m.stop.exchange))),[groups,common,exchangeOnly]);
  const activeMeasure = useMemo(() => active ? measure(active.geometry.coordinates) : null,[active]);
  const filtered = useMemo(() => routes.filter(r => (!direction || r.direction === direction) && `${r.line} ${r.name} ${r.stops.map(s => s.name).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())),[routes,direction,search]);
  const shownStop = allGroups.find(g => g.stop.id === stopId);

  const refresh = useCallback(async (trashView = false, preferred?: string) => {
    const list = await api.request<RouteSnapshot[]>(`/routes${trashView ? '?trash=1' : ''}`);
    setRoutes(list);
    setVisible(old => old.length ? old.filter(id => list.some(r => r.revisionId === id)) : list.map(r => r.revisionId));
    setActive(old => preferred && list.some(r => r.revisionId === preferred) ? preferred : list.some(r => r.revisionId === old) ? old : list[0]?.revisionId ?? '');
    setOffline(false);
    if (!trashView) void cachePublished(list).catch(() => {});
  },[]);
  useEffect(() => {void (async () => {
    try {setUser(await api.session()); await refresh();}
    catch {const cached = await readPublished().catch(() => []); setRoutes(cached); setVisible(cached.map(r => r.revisionId)); setActive(cached[0]?.revisionId ?? ''); setOffline(true);}
    finally {setLoading(false);}
  })();},[refresh]);
  useEffect(() => {document.documentElement.lang = lang; document.documentElement.dataset.theme = theme; try {localStorage.setItem('gtt-language',lang); localStorage.setItem('gtt-theme',theme);} catch {}},[lang,theme]);
  useEffect(() => {if (!editing) return; const handler = (e: BeforeUnloadEvent) => {e.preventDefault();}; window.addEventListener('beforeunload',handler); return () => window.removeEventListener('beforeunload',handler);},[editing]);
  useEffect(() => {setStartOffset(0); setProgress(null); progressRef.current = null; setHistory(null); setVerified(false);},[activeId]);
  useEffect(() => {
    if (!nav || !activeMeasure) return;
    if (!navigator.geolocation) {setError(t('gpsError')); setNav(false); return;}
    const watcher = navigator.geolocation.watchPosition(fix => {
      const p: Coordinate = [fix.coords.longitude,fix.coords.latitude]; setPosition(p);
      const next = matchFix(activeMeasure,{coordinate:p,accuracy:fix.coords.accuracy,heading:fix.coords.heading,speed:fix.coords.speed,timestamp:fix.timestamp},progressRef.current,startOffset);
      progressRef.current = next; setProgress(next);
    },() => {setError(t('gpsError')); setNav(false);},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    return () => navigator.geolocation.clearWatch(watcher);
  },[nav,activeMeasure,startOffset,t]);
  const nextStep = active?.instructions.find(s => s.offsetM > (progress?.offsetM ?? startOffset) + 8);
  const nextStop = active?.stops.find(s => s.offsetM > (progress?.offsetM ?? startOffset) + 10);
  useEffect(() => {
    if (!nav || !voice || !progress || !('speechSynthesis' in window)) return;
    const key = progress.state !== 'tracking' ? progress.state : nextStep && nextStep.offsetM - progress.offsetM < 100 ? `${activeId}-${nextStep.offsetM}` : '';
    if (key && key !== spoken.current) {
      spoken.current = key;
      const utterance = new SpeechSynthesisUtterance(progress.state === 'tracking' ? nextStep!.text : t(progress.state));
      utterance.lang = {es:'es-ES',it:'it-IT',en:'en-GB'}[lang]; speechSynthesis.cancel(); speechSynthesis.speak(utterance);
    }
  },[nav,voice,progress,nextStep,activeId,lang,t]);
  useEffect(() => {if (!nav) {spoken.current = ''; if ('speechSynthesis' in window) speechSynthesis.cancel();}},[nav]);

  async function run(work: () => Promise<void>) {setError('');setNotice('');setBusy(true);try {await work();} catch(e) {setError(errorText(e,t));} finally {setBusy(false);}}
  function edit(route: RouteSnapshot | null) {if (nav) return; setPrevious(route);setEditing(route ? structuredClone(route) : emptyRoute());setMode(null);}
  function point(p: Coordinate) {
    if (!editing) return;
    if (mode === 'vertex') setEditing({...editing,geometry:{type:'LineString',coordinates:[...editing.geometry.coordinates,p]}});
    if (mode === 'stop') {
      const offsetM = Math.round(nearestOffset(measure(editing.geometry.coordinates),p));
      setEditing({...editing,stops:[...editing.stops,{id:crypto.randomUUID(),code:'',name:t('stops'),coordinates:p,offsetM,exchange:false,exchangeDirection:null,notes:''}].sort((a,b) => a.offsetM - b.offsetM)});setMode(null);
    }
  }
  async function save() {
    const result = await api.saveDocument(editing!,previous);
    await refresh(trash,result.revisionId);setVisible(old => [...new Set([...old,result.revisionId])]);setEditing(null);setPrevious(null);setMode(null);setNotice(t('saved'));
  }
  async function transition(action: string, revisionId = active?.revisionId) {
    if (!active) return;
    const result = await api.request<RouteSnapshot>(`/routes/${active.id}/${action}`,'POST',{expectedVersion:active.version,revisionId,verified});
    await refresh(trash,result.revisionId);setVisible(old => [...new Set([...old,result.revisionId])]);setHistory(null);setNotice(t('changed'));
  }
  return <div className="app">
    <header className="topbar"><a className="brand" href="#"><span className="brand-symbol">G</span><span>GTT <b>TRAINER</b><small>{t('study')}</small></span></a><div className="header-tools"><select aria-label="Language" value={lang} onChange={e => setLang(e.target.value as Language)}><option value="es">ES</option><option value="it">IT</option><option value="en">EN</option></select><button className="icon-button" aria-label={theme === 'light' ? 'Dark theme' : 'Light theme'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>◐</button>{user ? <button disabled={busy} onClick={() => void run(async () => {await api.logout();setUser(null);setEditing(null);setImports(null);setTrash(false);await refresh();})}>{t('logout')}</button> : <button disabled={offline} onClick={() => setLoginOpen(true)}>{t('login')}</button>}</div></header>
    <div className="workspace"><aside className="sidebar">
      <nav className="tabs"><button className={tab === 'routes' ? 'selected' : ''} onClick={() => setTab('routes')}>{t('routes')}</button><button className={tab === 'references' ? 'selected' : ''} onClick={() => setTab('references')}>{t('references')}</button></nav>
      {offline && <div className="alert">{t('offline')}<p className="muted">{t('offlineHelp')}</p></div>}
      {error && <div className="alert error" role="alert">{error}<button aria-label={t('close')} onClick={() => setError('')}>×</button></div>}
      {notice && <p className="alert success" role="status">{notice}</p>}
      {editing ? <Editor document={editing} setDocument={setEditing} previous={previous} knownStops={allGroups.map(g => g.stop)} mode={mode} setMode={setMode} save={save} close={() => {setEditing(null);setMode(null);}} t={t}/> : tab === 'references' ? <References t={t} onAuthor={editor && !offline ? (doc => {setPrevious(null);setEditing(doc);setTab('routes');}) : undefined}/> : <>
        <section className="route-browser"><div className="eyebrow">TORINO · GTT</div><h1>{t('heading')}</h1><div className="search"><span>⌕</span><input type="search" aria-label={t('search')} placeholder={t('search')} value={search} onChange={e => setSearch(e.target.value)}/></div>
          <div className="field-grid filters"><select aria-label={t('direction')} value={direction} onChange={e => setDirection(e.target.value as Direction | '')}><option value="">{t('any')}</option>{['andata','ritorno','circular'].map(v => <option key={v} value={v}>{t(v as TextKey)}</option>)}</select><button disabled={loading || busy || nav} onClick={() => void run(async () => {setUser(await api.session());await refresh(trash);})}>{t('reload')}</button></div>
          <div className="button-row visibility"><button onClick={() => setVisible(routes.map(r => r.revisionId))}>{t('all')}</button><button onClick={() => setVisible([])}>{t('none')}</button><button onClick={() => setVisible(selected)}>{t('selected')}</button></div>
          <div className="section-heading"><h2>{t('routes')} <span className="count">{filtered.length}</span></h2>{editor && <button className={trash ? 'selected' : ''} disabled={nav || busy || offline} onClick={() => void run(async () => {const next = !trash;await refresh(next);setTrash(next);})}>{t('trash')}</button>}</div>
          {loading ? <p aria-busy="true">…</p> : routes.length === 0 ? <p className="empty">{t('empty')}</p> : filtered.length === 0 ? <p>{t('noMatch')}</p> : <div className="route-list">{filtered.map(route => <article className={`route-card ${activeId === route.revisionId ? 'active' : ''}`} key={route.revisionId} style={{'--route-color':route.color} as React.CSSProperties}>
            <div className="route-card-main"><label className="route-visibility" title={t('map')}><input type="checkbox" aria-label={`${t('map')} ${route.line} ${route.name}`} checked={visible.includes(route.revisionId)} onChange={e => setVisible(old => e.target.checked ? [...new Set([...old,route.revisionId])] : old.filter(id => id !== route.revisionId))}/><span className="line-badge">{route.line}</span></label><button className="route-title" disabled={nav} onClick={() => {setActive(route.revisionId);setVisible(old => [...new Set([...old,route.revisionId])]);}}><strong>{route.name}</strong><small>{t(route.direction === 'none' ? 'unspecified' : route.direction)} · {t(route.kind)} · {t(route.status)}</small></button></div>
            <div className="route-card-bottom"><label className="check"><input type="checkbox" checked={selected.includes(route.revisionId)} onChange={e => setSelected(old => e.target.checked ? [...old,route.revisionId] : old.filter(id => id !== route.revisionId))}/>{t('selected')}</label><span>{route.stops.length} {t('stops').toLowerCase()} · r{route.revision}</span></div>
          </article>)}</div>}
          {editor && !trash && <div className="button-row author-tools"><button disabled={nav || offline} className="primary" onClick={() => edit(null)}>+ {t('new')}</button><label className="button upload">{t('import')}<input type="file" disabled={nav || offline} accept=".json,.geojson,.gpx" onChange={e => {const file = e.target.files?.[0];if(file) void run(async () => setImports(await importFile(file)));e.target.value='';}}/></label></div>}
        </section>
        {active && <section className="route-detail"><div className="section-heading"><h2>{t('active')}</h2><span className="status">{t(active.status)}</span></div><h3><span style={{color:active.color}}>{active.line}</span> · {active.name}</h3><div className="route-stats"><span><b>{((activeMeasure?.length ?? 0) / 1000).toFixed(2)}</b> km</span><span><b>{active.stops.length}</b> {t('stops')}</span><span><b>{active.instructions.length}</b> {t('instructions')}</span></div>
          <p className="route-notes">{active.notes}</p><div className="button-row"><a className="button" target="_blank" rel="noreferrer" href={api.reportUrl(active,lang,'pdf')} aria-disabled={offline}>{t('report')}</a><a className="button" target="_blank" rel="noreferrer" href={api.reportUrl(active,lang,'html')}>{t('print')}</a><button onClick={() => downloadDocument(active)}>{t('export')}</button></div>
          {editor && !nav && !offline && <div className="workflow"><div className="button-row">{!trash && <button onClick={() => edit(active)}>{t('edit')}</button>}<button disabled={busy} onClick={() => void run(async () => setHistory(await api.request(`/routes/${active.id}/history`)))}>{t('history')}</button>{trash ? <button disabled={busy} onClick={() => void run(async () => {await transition('restore');await refresh(true);})}>{t('restore')}</button> : <button className="danger-text" disabled={busy} onClick={() => void run(async () => {await api.request(`/routes/${active.id}`,'DELETE',{expectedVersion:active.version});await refresh();})}>{t('delete')}</button>}</div>
            {!trash && active.status === 'draft' && <button disabled={busy} onClick={() => void run(() => transition('review'))}>{t('submit')}</button>}
            {!trash && active.status === 'review' && user?.role === 'admin' && <><label className="check"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)}/>{t('verified')}</label><button className="primary" disabled={!verified || busy} onClick={() => void run(() => transition('publish'))}>{t('publish')}</button></>}
          </div>}
          {history && <div className="history"><h3>{t('history')}</h3>{history.map(r => <div key={r.id}><span>r{r.revision} · {t(r.status as TextKey)}</span><button disabled={busy || nav || trash} onClick={() => void run(() => transition('revert',r.id))}>{t('revert')}</button></div>)}</div>}
          {!trash && <section className="navigation-panel"><h3>{t('start')}</h3><p className="muted">{t('gpsLocal')}</p><label>{t('startAt')}<select disabled={nav} value={startOffset} onChange={e => {setStartOffset(Number(e.target.value));progressRef.current=null;setProgress(null);}}><option value={0}>{t('beginning')}</option>{active.stops.map((s,i) => <option key={i} value={s.offsetM}>{i+1} · {s.name}</option>)}</select></label><label className="check"><input type="checkbox" checked={voice} onChange={e => setVoice(e.target.checked)}/>{t('voice')}</label><label className="check"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)}/>{t('follow')}</label><button className={nav ? 'danger' : 'primary'} onClick={() => {setNav(!nav);setPosition(null);setError('');progressRef.current=null;setProgress(null);setVisible(old => [...new Set([...old,active.revisionId])]);}}>{t(nav ? 'stop' : 'start')}</button></section>}
          <details><summary>{t('instructions')} · {active.instructions.length}</summary><ol className="instructions">{active.instructions.map((s,i) => <li key={i}><span className="offset">{Math.round(s.offsetM)} m</span><strong>{s.text}</strong>{s.notes && <p>{s.notes}</p>}</li>)}</ol></details>
          <details><summary>{t('source')}</summary><p>{active.source.name}</p>{active.source.url && <a href={active.source.url} target="_blank" rel="noreferrer">{active.source.url}</a>}<p className="muted">{active.source.license} · {active.source.retrievedAt}</p></details>
        </section>}
        <section className="stops-panel"><h2>{t('stops')} <span className="count">{shownGroups.length}</span></h2><label className="check"><input type="checkbox" checked={showStops} onChange={e => setShowStops(e.target.checked)}/>{t('stops')}</label><label className="check"><input type="checkbox" checked={common} onChange={e => setCommon(e.target.checked)}/>{t('common')}</label><label className="check"><input type="checkbox" checked={exchangeOnly} onChange={e => setExchangeOnly(e.target.checked)}/>{t('exchangesOnly')}</label><ul className="stop-list">{shownGroups.map(g => <li key={g.stop.id}><button className={stopId === g.stop.id ? 'selected' : ''} onClick={() => setStopId(g.stop.id)}><span className={`stop-dot ${g.memberships.some(m => m.stop.exchange) ? 'exchange' : ''}`}/><span><strong>{g.stop.code} {g.stop.name}</strong><small>{g.lines.join(' · ')}</small></span></button></li>)}</ul>
          {shownStop && <div className="stop-detail"><h3>{shownStop.stop.name}</h3>{shownStop.memberships.map((m,i) => <p key={i}>{m.route.line} · {t(m.route.direction === 'none' ? 'unspecified' : m.route.direction)}{m.stop.exchange && <> · <b>{t('exchange')} · {t(m.stop.exchangeDirection as TextKey)}</b></>}{m.stop.notes && <small>{m.stop.notes}</small>}</p>)}</div>}
        </section>
      </>}
      <footer>GTT Trainer · <span>© OpenStreetMap contributors</span><p className="muted">{user?.email}</p></footer>
    </aside>
    <main className="map-panel"><RouteMap routes={visibleRoutes} active={activeId} groups={shownGroups} showStops={showStops} edit={editing} drawMode={mode} onPoint={point} onStop={setStopId} position={position} follow={nav && follow} t={t}/><div className="map-label"><span className="live-dot"/>{t('study')}</div>
      {mode && <div className="draw-hint">{t(mode === 'vertex' ? 'vertexHint' : 'stopHint')}<button onClick={() => setMode(null)}>{t('stopDrawing')}</button></div>}
      {nav && <div className="navigation-hud" aria-live="polite"><div className={`nav-state ${progress?.state ?? 'waiting'}`}>{t(progress?.state ?? 'waiting')}</div><h2>{nextStep?.text ?? t('arrive')}</h2>{nextStep && <p>{Math.max(0,Math.round(nextStep.offsetM-(progress?.offsetM ?? startOffset)))} m</p>}{nextStop && <p>{t('nextStop')}: <b>{nextStop.name}</b>{nextStop.exchange && <> · {t('exchange')}</>}</p>}<progress max={activeMeasure?.length || 1} value={progress?.offsetM ?? startOffset}/><small>{t('remaining')}: {(((activeMeasure?.length ?? 0)-(progress?.offsetM ?? startOffset))/1000).toFixed(2)} km</small></div>}
    </main></div>
    {loginOpen && <div className="modal-backdrop"><form className="modal" onSubmit={e => {e.preventDefault();setAuthBusy(true);void run(async () => {setUser(await api.login(email,password));setPassword('');setLoginOpen(false);await refresh();}).finally(() => setAuthBusy(false));}}><h2>{t('login')}</h2>{error && <p className="alert error" role="alert">{error}</p>}<label>{t('email')}<input autoFocus type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label><label>{t('password')}<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label><div className="button-row"><button type="submit" className="primary" disabled={authBusy}>{t('login')}</button><button type="button" onClick={() => {setLoginOpen(false);setPassword('');}}>{t('cancel')}</button></div></form></div>}
    {imports && <div className="modal-backdrop"><section className="modal"><h2>{t('importPreview')}</h2><p>{t('importHelp')}</p><ul>{imports.map((doc,i) => <li key={i}>{doc.line} · {doc.name} · {doc.geometry.coordinates.length} · {t(doc.direction === 'none' ? 'unspecified' : doc.direction)}</li>)}</ul><div className="button-row"><button disabled={busy} className="primary" onClick={() => void run(async () => {const result = await api.request<RouteSnapshot[]>('/imports','POST',{documents:imports});setImports(null);await refresh(false,result[0]?.revisionId);setVisible(old => [...new Set([...old,...result.map(r => r.revisionId)])]);setNotice(t('saved'));})}>{t('save')}</button><button disabled={busy} onClick={() => setImports(null)}>{t('cancel')}</button></div></section></div>}
  </div>;
}
const rootNode = document.getElementById('root');
if (rootNode) createRoot(rootNode).render(<React.StrictMode><App/></React.StrictMode>);
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load',() => {void navigator.serviceWorker.register('/sw.js').catch(() => {});});
