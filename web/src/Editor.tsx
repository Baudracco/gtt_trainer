import {useState} from 'react';
import {generateInstructions, measure} from './geometry';
import {coordinate, downloadDocument, validateDocument} from './importers';
import type {RouteDocument, RouteSnapshot, RouteStop} from './model';
import type {Translate, TextKey} from './i18n';
import {MediaUpload} from './MediaUpload';
import {MediaGallery} from './MediaGallery';
import {mediaUrl} from './api';

type Props = {document: RouteDocument; setDocument: (d: RouteDocument) => void; previous: RouteSnapshot | null; knownStops: RouteStop[]; mode: 'vertex' | 'stop' | null; setMode: (m: 'vertex' | 'stop' | null) => void; save: () => Promise<void>; close: () => void; t: Translate};
export function Editor({document: doc, setDocument: set, previous, knownStops, mode, setMode, save, close, t}: Props) {
  const [busy, setBusy] = useState(false), [geometryText, setGeometryText] = useState<string | null>(null), [error, setError] = useState('');
  const [uploading,setUploading] = useState(false);
  const update = <K extends keyof RouteDocument>(key: K, value: RouteDocument[K]) => set({...doc, [key]: value});
  const stop = (index: number, patch: Partial<RouteStop>) => update('stops', doc.stops.map((s, i) => i === index ? {...s, ...patch} : s));
  const source = (key: keyof RouteDocument['source'], value: string) => update('source', {...doc.source, [key]: value});
  const measured = measure(doc.geometry.coordinates);
  async function submit() {
    setError('');
    try {validateDocument(doc); setBusy(true); await save();} catch (e) {setError(e instanceof Error ? e.message : t('error'));} finally {setBusy(false);}
  }
  return <section className="editor" aria-label={t('edit')}>
    <div className="section-heading"><h2>{previous ? t('edit') : t('new')}</h2><button className="icon-button" aria-label={t('close')} onClick={close}>×</button></div>
    <p className="muted">{t('unsaved')}</p>
    <fieldset className="editor-fields" disabled={busy || uploading}>
    <div className="field-grid"><label>{t('line')}<input value={doc.line} maxLength={40} onChange={e => update('line',e.target.value)}/></label><label>{t('color')}<input type="color" value={doc.color} onChange={e => update('color',e.target.value)}/></label></div>
    <label>{t('name')}<input value={doc.name} maxLength={200} onChange={e => update('name',e.target.value)}/></label>
    <div className="field-grid"><label>{t('direction')}<select value={doc.direction} onChange={e => update('direction',e.target.value as RouteDocument['direction'])}>{['andata','ritorno','circular','none'].map(v => <option value={v} key={v}>{t(v === 'none' ? 'unspecified' : v as TextKey)}</option>)}</select></label><label>{t('kind')}<select value={doc.kind} onChange={e => update('kind',e.target.value as RouteDocument['kind'])}>{['service','depot_out','depot_in','deadhead','partial','circular'].map(v => <option value={v} key={v}>{t(v as TextKey)}</option>)}</select></label></div>
    <label>{t('notes')}<textarea value={doc.notes} maxLength={12000} rows={3} onChange={e => update('notes',e.target.value)}/></label>
    <details><summary>{t('routeVideo')}</summary>{doc.video ? <><video controls playsInline preload="metadata" src={mediaUrl(doc.video.id)}/><label>{t('caption')}<input value={doc.video.caption} maxLength={500} onChange={e=>update('video',{...doc.video!,caption:e.target.value})}/></label><label>{t('credit')}<input value={doc.video.credit} maxLength={500} onChange={e=>update('video',{...doc.video!,credit:e.target.value})}/></label><button onClick={()=>update('video',null)}>{t('remove')}</button></> : <MediaUpload kind="video" onUpload={video=>update('video',video)} onBusy={setUploading} t={t}/>}</details>
    <details open={!doc.geometry.coordinates.length}><summary>{t('geometry')} · {doc.geometry.coordinates.length} · {(measured.length / 1000).toFixed(2)} km</summary>
      <p className="muted">{t('vertexHint')}</p><div className="button-row"><button aria-pressed={mode === 'vertex'} onClick={() => setMode(mode === 'vertex' ? null : 'vertex')}>{t(mode === 'vertex' ? 'stopDrawing' : 'addVertex')}</button><button disabled={!doc.geometry.coordinates.length} onClick={() => update('geometry',{type: 'LineString',coordinates: doc.geometry.coordinates.slice(0,-1)})}>{t('undo')}</button></div>
      <button onClick={() => setGeometryText(JSON.stringify(doc.geometry.coordinates, null, 1))}>{t('coordinates')}</button>
      {geometryText !== null && <><textarea aria-label={t('coordinates')} className="code-input" rows={8} value={geometryText} onChange={e => setGeometryText(e.target.value)}/><button onClick={() => {try {const values = JSON.parse(geometryText); if (!Array.isArray(values) || values.length > 50000) throw Error('Invalid coordinates.'); update('geometry',{type:'LineString',coordinates:values.map(coordinate)}); setGeometryText(null); setError('');} catch(e) {setError(String(e));}}}>{t('apply')}</button></>}
    </details>
    <details><summary>{t('stops')} · {doc.stops.length}</summary>
      <div className="button-row"><button disabled={doc.geometry.coordinates.length < 2} onClick={() => setMode(mode === 'stop' ? null : 'stop')}>{t(mode === 'stop' ? 'cancel' : 'addStop')}</button><button onClick={() => update('stops',[...doc.stops].sort((a,b) => a.offsetM - b.offsetM))}>{t('sort')}</button></div>
      {mode === 'stop' && <p>{t('stopHint')}</p>}
      {knownStops.length > 0 && <label>{t('reuseStop')}<select value="" onChange={e => {const s = knownStops.find(s => s.id === e.target.value); if(s) update('stops',[...doc.stops,{...s, exchange: false, exchangeDirection: null, notes:'', offsetM: Math.round(Math.min(measured.length, (doc.stops.at(-1)?.offsetM ?? 0) + 1))}]);}}><option value="">—</option>{knownStops.map(s => <option value={s.id} key={s.id}>{s.code} · {s.name}</option>)}</select></label>}
      {doc.stops.map((s,i) => <fieldset key={`${s.id}-${i}`}><legend>{i + 1} · {s.code || t('stops')}</legend>
        <label>{t('name')}<input value={s.name} onChange={e => stop(i,{name:e.target.value})}/></label>
        <div className="field-grid"><label>{t('code')}<input value={s.code} onChange={e => stop(i,{code:e.target.value})}/></label><label>{t('metres')}<input type="number" min={0} step={1} value={s.offsetM} onChange={e => stop(i,{offsetM:Number(e.target.value)})}/></label></div>
        <label className="check"><input type="checkbox" checked={s.exchange} onChange={e => stop(i,{exchange:e.target.checked,exchangeDirection:e.target.checked && doc.direction !== 'none' ? doc.direction : null})}/>{t('exchange')}</label>
        {s.exchange && <label>{t('exchangeDirection')}<select value={s.exchangeDirection ?? ''} onChange={e => stop(i,{exchangeDirection:e.target.value ? e.target.value as RouteStop['exchangeDirection'] : null})}><option value="">{t('unspecified')}</option>{['andata','ritorno','circular'].map(v => <option key={v} value={v}>{t(v as TextKey)}</option>)}</select></label>}
        <label>{t('notes')}<textarea rows={2} value={s.notes} onChange={e => stop(i,{notes:e.target.value})}/></label><button className="danger-text" onClick={() => update('stops',doc.stops.filter((_,j) => j !== i))}>{t('remove')}</button>
      </fieldset>)}
    </details>
    <details open><summary>{t('instructions')} · {doc.instructions.length}</summary>
      <p className="muted">{t('generatedHint')}</p><div className="button-row"><button disabled={doc.geometry.coordinates.length < 2 || doc.instructions.length > 0} onClick={() => update('instructions', generateInstructions(measured,{depart:t('depart'),left:t('left'),right:t('right'),arrive:t('arrive')}))}>{t('generate')}</button><button onClick={() => update('instructions',[...doc.instructions,{offsetM:doc.instructions.at(-1)?.offsetM ?? 0,kind:'note',text:'',notes:''}])}>{t('addInstruction')}</button></div>
      <button onClick={() => update('instructions',[...doc.instructions].sort((a,b) => a.offsetM - b.offsetM))}>{t('sort')}</button>
      {doc.instructions.map((step,i) => <fieldset key={i}><legend>{i + 1}</legend><div className="field-grid"><label>{t('metres')}<input type="number" value={step.offsetM} min={0} step={1} onChange={e => update('instructions',doc.instructions.map((s,j) => j === i ? {...s,offsetM:Number(e.target.value)} : s))}/></label><label>{t('kind')}<select value={step.kind} onChange={e => update('instructions',doc.instructions.map((s,j) => j === i ? {...s,kind:e.target.value as typeof step.kind} : s))}>{['depart','straight','left','right','roundabout','arrive','note'].map(v => <option value={v} key={v}>{t(v as TextKey)}</option>)}</select></label></div>
        <label>{t('instructions')}<textarea rows={2} value={step.text} onChange={e => update('instructions',doc.instructions.map((s,j) => j === i ? {...s,text:e.target.value} : s))}/></label>
        <label>{t('landmark')}<textarea rows={2} value={step.notes} onChange={e => update('instructions',doc.instructions.map((s,j) => j === i ? {...s,notes:e.target.value} : s))}/></label>
        <MediaGallery photos={step.photos??[]} fallback={step.text}/>
        {(step.photos??[]).map((photo,k)=><div className="photo-fields" key={photo.id}><label>{t('caption')}<input value={photo.caption} maxLength={500} onChange={e=>update('instructions',doc.instructions.map((s,j)=>j===i?{...s,photos:s.photos!.map((p,n)=>n===k?{...p,caption:e.target.value}:p)}:s))}/></label><label>{t('credit')}<input value={photo.credit} maxLength={500} onChange={e=>update('instructions',doc.instructions.map((s,j)=>j===i?{...s,photos:s.photos!.map((p,n)=>n===k?{...p,credit:e.target.value}:p)}:s))}/></label><button onClick={()=>update('instructions',doc.instructions.map((s,j)=>j===i?{...s,photos:s.photos!.filter((_,n)=>n!==k)}:s))}>{t('removePhoto')}</button></div>)}
        {(step.photos?.length??0)<3&&<MediaUpload kind="photo" onBusy={setUploading} t={t} onUpload={photo=>update('instructions',doc.instructions.map((s,j)=>j===i?{...s,photos:[...(s.photos??[]),photo]}:s))}/>}
        <button className="danger-text" onClick={() => update('instructions',doc.instructions.filter((_,j) => i !== j))}>{t('remove')}</button>
      </fieldset>)}
    </details>
    <details><summary>{t('source')}</summary><label>{t('source')}<input value={doc.source.name} onChange={e => source('name',e.target.value)}/></label><label>{t('sourceUrl')}<input type="url" value={doc.source.url} onChange={e => source('url',e.target.value)}/></label><label>{t('license')}<textarea value={doc.source.license} onChange={e => source('license',e.target.value)}/></label></details>
    </fieldset>
    {error && <p className="alert error" role="alert">{error}</p>}
    <div className="editor-actions"><button className="primary" disabled={busy || uploading} onClick={() => void submit()}>{t(busy ? 'saving' : 'save')}</button><button onClick={() => downloadDocument(doc)}>{t('export')}</button></div>
  </section>;
}
